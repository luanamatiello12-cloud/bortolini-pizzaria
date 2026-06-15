// Auth state do Baileys persistido no PostgreSQL (Supabase).
// Guarda as credenciais e chaves de sessão numa tabela `whatsapp_auth`,
// para a conexão sobreviver a reinícios/hibernação do Render.
const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys')

async function usePostgresAuthState(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_auth (
      id   TEXT PRIMARY KEY,
      data JSONB NOT NULL
    )
  `)

  async function read(id) {
    const r = await pool.query('SELECT data FROM whatsapp_auth WHERE id = $1', [id])
    if (!r.rows.length) return null
    // pg já devolve o JSONB como objeto; reidrata Buffers via BufferJSON.reviver
    return JSON.parse(JSON.stringify(r.rows[0].data), BufferJSON.reviver)
  }

  async function write(id, value) {
    const data = JSON.stringify(value, BufferJSON.replacer)
    await pool.query(
      `INSERT INTO whatsapp_auth (id, data) VALUES ($1, $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [id, data]
    )
  }

  async function remove(id) {
    await pool.query('DELETE FROM whatsapp_auth WHERE id = $1', [id])
  }

  const creds = (await read('creds')) || initAuthCreds()

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const result = {}
          await Promise.all(
            ids.map(async (id) => {
              let value = await read(`${type}-${id}`)
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value)
              }
              result[id] = value
            })
          )
          return result
        },
        set: async (data) => {
          const tasks = []
          for (const type in data) {
            for (const id in data[type]) {
              const value = data[type][id]
              const key = `${type}-${id}`
              tasks.push(value ? write(key, value) : remove(key))
            }
          }
          await Promise.all(tasks)
        }
      }
    },
    saveCreds: () => write('creds', creds),
    // Apaga toda a sessão (usar no logout/desconectar)
    clearAll: async () => {
      await pool.query('DELETE FROM whatsapp_auth')
    }
  }
}

module.exports = usePostgresAuthState
