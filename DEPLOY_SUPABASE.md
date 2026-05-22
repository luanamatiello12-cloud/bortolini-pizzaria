# Deploy: Supabase + Vercel

## Pré-requisitos
- Conta no [supabase.com](https://supabase.com) com projeto criado
- Conta na [vercel.com](https://vercel.com)
- [Supabase CLI](https://supabase.com/docs/guides/cli) instalado: `npm i -g supabase`
- Node.js instalado (para Vercel CLI)

---

## Passo 1 — Banco de dados no Supabase

1. Acesse **supabase.com → seu projeto → SQL Editor**
2. Cole e execute o conteúdo de `supabase/migrations/001_schema.sql`
3. Cole e execute o conteúdo de `supabase/migrations/002_rpc_stock.sql`
4. Verifique em **Table Editor** que as tabelas foram criadas

---

## Passo 2 — Bucket de Storage (fotos de produtos)

1. No painel do Supabase, vá em **Storage → New bucket**
2. Nome: `uploads`
3. Marque **Public bucket** (para que as URLs das fotos sejam acessíveis)
4. Clique em **Save**

---

## Passo 3 — Variáveis de ambiente do Supabase

No painel do Supabase vá em **Project Settings → API** e copie:
- `Project URL` → será o `SUPABASE_URL`
- `service_role` secret → será o `SUPABASE_SERVICE_ROLE_KEY`

Crie um arquivo `.env.local` (nunca suba para o GitHub):
```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
JWT_SECRET=coloque-uma-chave-longa-e-aleatoria-aqui
ADMIN_MASTER_KEY=BORTOLINI-2026
```

---

## Passo 4 — Deploy da Edge Function

```powershell
# Na pasta do projeto
supabase login
supabase link --project-ref SEU_PROJECT_ID

# Definir secrets na Edge Function
supabase secrets set SUPABASE_URL=https://xxxx.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
supabase secrets set JWT_SECRET=sua-chave-secreta-longa
supabase secrets set ADMIN_MASTER_KEY=BORTOLINI-2026

# Deploy da função
supabase functions deploy api --no-verify-jwt
```

A URL da função ficará em:
```
https://SEU_PROJECT_ID.supabase.co/functions/v1/api
```

---

## Passo 5 — Atualizar vercel.json com a URL real

Abra `vercel.json` e substitua `SEU_PROJETO` pelo ID real do seu projeto Supabase:

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://SEU_PROJECT_ID.supabase.co/functions/v1/api/:path*"
    }
  ]
}
```

---

## Passo 6 — Deploy do frontend na Vercel

```powershell
# Instalar Vercel CLI
npm i -g vercel

# Na pasta do projeto
vercel

# Siga as instruções:
# - Link to existing project? N
# - Project name: bortolini (ou outro)
# - Root directory: ./
# - Build command: (deixe vazio, é site estático)
# - Output directory: ./
```

A Vercel vai publicar o site e dar uma URL tipo:
```
https://bortolini.vercel.app
```

---

## Passo 7 — Migrar dados do banco atual (opcional)

Execute o script `migrate_db.py` para exportar os dados do SQLite:

```powershell
python migrate_db.py
```

Isso gera um arquivo `migration_data.sql` que você cola no SQL Editor do Supabase.

---

## Passo 8 — Atualizar supabase/config.toml

Substitua `SEU_PROJECT_ID_AQUI` pelo ID real do projeto:

```toml
project_id = "abcdefghijklmnop"
```

---

## Logins (mesmos de antes)

| CPF          | PIN  | Perfil     |
|--------------|------|------------|
| 00000000000  | 0000 | Admin      |
| 11111111111  | 1111 | Atendente  |
| 22222222222  | 2222 | Cozinha    |
| 33333333333  | 3333 | Entregador |
| 44444444444  | 4444 | Financeiro |

> No primeiro acesso cada usuário será solicitado a trocar o PIN.

---

## Checklist final

- [ ] Tabelas criadas no Supabase
- [ ] Funções RPC `decrement_stock` / `increment_stock` criadas
- [ ] Bucket `uploads` criado como público
- [ ] Secrets configurados na Edge Function
- [ ] Edge Function `api` deployada (`--no-verify-jwt`)
- [ ] `vercel.json` atualizado com a URL real
- [ ] Frontend deployado na Vercel
- [ ] Login testado com cada perfil
- [ ] Pedido criado pelo Cliente QR aparece em Pedidos
- [ ] Upload de foto de produto funciona
