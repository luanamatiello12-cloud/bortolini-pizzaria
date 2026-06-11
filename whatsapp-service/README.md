# Serviço WhatsApp (Baileys) — Pizzaria Bortolini

Serviço **Node.js separado** que conecta o WhatsApp via Baileys e conversa com o
sistema principal (Python) por HTTP. A sessão é persistida no **Postgres do
Supabase** (tabela `whatsapp_auth`), então sobrevive a reinícios/hibernação.

## Arquitetura
```
WhatsApp  ⇄  [este serviço Node + Baileys]  ⇄ HTTP ⇄  [server.py Python]  ⇄  Inbox
                  (2º Web Service no Render)            (proxy + webhook)
```
- O painel admin chama o `server.py` (mesmo domínio), que faz **proxy** para este serviço.
- Mensagens **recebidas** → este serviço faz `POST` no **webhook** do `server.py` (`/api/whatsapp/inbound`), que grava no Inbox.

## Endpoints
- `GET  /api/whatsapp/status`      → `{ status, connected, number }`
- `GET  /api/whatsapp/qrcode`      → `{ status, qr }` (QR em data URL quando desconectado)
- `POST /api/whatsapp/connect`     → inicia a conexão (gera QR)        *(precisa X-API-Key)*
- `POST /api/whatsapp/send`        → `{ number, message }`             *(precisa X-API-Key)*
- `POST /api/whatsapp/disconnect`  → encerra e limpa a sessão          *(precisa X-API-Key)*

## Variáveis de ambiente
| Variável | Descrição |
|---|---|
| `DATABASE_URL` | **Mesma** connection string do Supabase usada pelo app Python (Session pooler, `?sslmode=require`). |
| `WHATSAPP_API_KEY` | Segredo compartilhado. O `server.py` envia no header `X-API-Key`. Gere um valor aleatório. |
| `WEBHOOK_URL` | URL do app Python: `https://bortolini-pizzaria.onrender.com/api/webhook/evolution` |
| `WEBHOOK_SECRET` | **Mesmo** valor do `WEBHOOK_SECRET` do `server.py` (validado no header `X-Webhook-Secret`). |
| `PORT` | O Render define automaticamente. |

## Deploy no Render (2º serviço, a partir do MESMO repositório)
1. Render → **New** → **Web Service** → conecte o repositório `bortolini-pizzaria`.
2. **Root Directory:** `whatsapp-service`
3. **Runtime:** Node · **Build Command:** `npm install` · **Start Command:** `npm start`
4. **Environment:** adicione as variáveis da tabela acima (o `DATABASE_URL` é o mesmo do Supabase).
5. Crie o serviço. Anote a URL gerada (ex: `https://bortolini-whatsapp.onrender.com`).
6. No serviço **Python** (bortolini-delivery), adicione as envs:
   - `WHATSAPP_SERVICE_URL` = a URL do passo 5
   - `WHATSAPP_API_KEY` = o mesmo valor do serviço Node
   - `WHATSAPP_WEBHOOK_SECRET` = o mesmo valor do serviço Node
7. No painel admin → **Integrações → WhatsApp** → **Conectar** → escaneie o QR.

> ⚠️ Baileys é uma biblioteca **não-oficial**. Use com um número dedicado; há risco
> de bloqueio pelo WhatsApp se houver uso abusivo (spam/envios em massa).

## Rodar localmente (teste)
```bash
cd whatsapp-service
npm install
# crie um .env com DATABASE_URL, WHATSAPP_API_KEY, WEBHOOK_URL, WHATSAPP_WEBHOOK_SECRET
npm start
# abra GET http://localhost:3001/api/whatsapp/qrcode para pegar o QR
```
