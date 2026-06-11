require('dotenv').config()
const express = require('express')
const { Pool } = require('pg')
const QRCode = require('qrcode')
const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const usePostgresAuthState = require('./db-auth-state')

// ----------------- Configuração (Environment Variables) -----------------
const PORT = process.env.PORT || 3001
const DATABASE_URL = process.env.DATABASE_URL                 // mesmo Postgres do Supabase
const API_KEY = process.env.WHATSAPP_API_KEY || ''            // protege send/connect/disconnect
const WEBHOOK_URL = process.env.WEBHOOK_URL || ''             // ex: https://bortolini-pizzaria.onrender.com/api/webhook/evolution
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || ''       // DEVE ser igual ao WEBHOOK_SECRET do server.py

if (!DATABASE_URL) {
  console.error('FALTA DATABASE_URL (mesmo Postgres do Supabase).')
  process.exit(1)
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

// ----------------- Estado da conexão -----------------
let sock = null
let authStore = null
let connectionStatus = 'disconnected' // disconnected | connecting | qr | connected
let lastQR = null
let connectedNumber = null
let starting = false

async function startSock() {
  if (starting || connectionStatus === 'connected') return
  starting = true
  try {
    connectionStatus = connectionStatus === 'qr' ? 'qr' : 'connecting'
    authStore = await usePostgresAuthState(pool)
    const { version } = await fetchLatestBaileysVersion()

    sock = makeWASocket({
      version,
      auth: authStore.state,
      printQRInTerminal: false,
      browser: ['Bortolini Pizzaria', 'Chrome', '1.0.0'],
      syncFullHistory: false
    })

    sock.ev.on('creds.update', authStore.saveCreds)

    sock.ev.on('connection.update', async (u) => {
      const { connection, lastDisconnect, qr } = u
      if (qr) {
        lastQR = qr
        connectionStatus = 'qr'
      }
      if (connection === 'open') {
        connectionStatus = 'connected'
        lastQR = null
        connectedNumber = (sock.user && sock.user.id ? sock.user.id.split(':')[0] : null)
        console.log('WhatsApp conectado:', connectedNumber)
      }
      if (connection === 'close') {
        connectedNumber = null
        const code = (lastDisconnect && lastDisconnect.error instanceof Boom)
          ? lastDisconnect.error.output && lastDisconnect.error.output.statusCode
          : null
        if (code === DisconnectReason.loggedOut) {
          // sessão encerrada de propósito (ou expulsa): limpa e fica desconectado
          console.log('Sessão encerrada (loggedOut). Limpando.')
          connectionStatus = 'disconnected'
          lastQR = null
          sock = null
          try { await authStore.clearAll() } catch (e) {}
        } else {
          // queda de rede / reinício: reconecta automaticamente
          console.log('Conexão caiu, reconectando em 5s. code =', code)
          connectionStatus = 'connecting'
          sock = null
          setTimeout(() => { starting = false; startSock().catch(console.error) }, 5000)
          return
        }
      }
    })

    // Mensagens recebidas -> webhook para o sistema (Inbox)
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return
      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue
        const jid = msg.key.remoteJid || ''
        if (jid.endsWith('@g.us')) continue // ignora grupos
        const from = jid.replace('@s.whatsapp.net', '')
        const m = msg.message
        const text =
          m.conversation ||
          (m.extendedTextMessage && m.extendedTextMessage.text) ||
          (m.imageMessage && m.imageMessage.caption) ||
          (m.videoMessage && m.videoMessage.caption) ||
          ''
        await forwardToWebhook({
          from,
          name: msg.pushName || '',
          text,
          message_id: msg.key.id,
          timestamp: Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000)
        }).catch((e) => console.error('webhook erro:', e.message))
      }
    })
  } finally {
    starting = false
  }
}

async function forwardToWebhook(payload) {
  if (!WEBHOOK_URL) return
  // Envia no formato que o /api/webhook/evolution do server.py ja entende,
  // reaproveitando toda a logica de Inbox + IA existente.
  const evolutionShaped = {
    data: {
      key: { fromMe: false, remoteJid: `${payload.from}@s.whatsapp.net` },
      message: { conversation: payload.text },
      pushName: payload.name || ''
    }
  }
  await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': WEBHOOK_SECRET
    },
    body: JSON.stringify(evolutionShaped)
  })
}

// ----------------- API REST -----------------
const app = express()
app.use(express.json())

function requireApiKey(req, res, next) {
  if (!API_KEY) return next() // sem chave configurada => libera (apenas dev)
  if (req.get('X-API-Key') !== API_KEY) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  next()
}

// Status da conexão
app.get('/api/whatsapp/status', (req, res) => {
  res.json({
    status: connectionStatus,
    connected: connectionStatus === 'connected',
    number: connectedNumber
  })
})

// QR Code (imagem em data URL) quando desconectado
app.get('/api/whatsapp/qrcode', async (req, res) => {
  try {
    if (connectionStatus === 'connected') {
      return res.json({ status: 'connected', qr: null, number: connectedNumber })
    }
    if (!lastQR) {
      startSock().catch(console.error)
      return res.json({ status: connectionStatus, qr: null })
    }
    const dataUrl = await QRCode.toDataURL(lastQR, { margin: 1, width: 280 })
    res.json({ status: 'qr', qr: dataUrl })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Iniciar/forçar conexão (gera QR se precisar)
app.post('/api/whatsapp/connect', requireApiKey, async (req, res) => {
  startSock().catch(console.error)
  res.json({ ok: true, status: connectionStatus })
})

// Enviar mensagem de texto
app.post('/api/whatsapp/send', requireApiKey, async (req, res) => {
  try {
    const { number, message } = req.body || {}
    if (!number || !message) {
      return res.status(400).json({ error: 'number e message são obrigatórios' })
    }
    if (connectionStatus !== 'connected' || !sock) {
      return res.status(409).json({ error: 'WhatsApp não conectado' })
    }
    const jid = `${String(number).replace(/\D/g, '')}@s.whatsapp.net`
    await sock.sendMessage(jid, { text: String(message) })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Desconectar (logout) e limpar sessão
app.post('/api/whatsapp/disconnect', requireApiKey, async (req, res) => {
  try {
    if (sock) {
      try { await sock.logout() } catch (e) {}
      try { sock.end() } catch (e) {}
      sock = null
    }
    if (authStore) { try { await authStore.clearAll() } catch (e) {} }
    connectionStatus = 'disconnected'
    lastQR = null
    connectedNumber = null
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/', (req, res) => res.json({ service: 'bortolini-whatsapp', status: connectionStatus }))

app.listen(PORT, () => {
  console.log(`Serviço WhatsApp ouvindo na porta ${PORT}`)
  // Reusa a sessão do Postgres e reconecta sozinho ao subir
  startSock().catch(console.error)
})
