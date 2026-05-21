# Deploy Railway + Supabase

Este caminho mantem o backend Python no Railway e usa o Supabase como banco Postgres.

## Por que este caminho

- O sistema atual ja esta pronto em Python.
- O Railway hospeda o `server.py` como app web.
- O Supabase fica responsavel pelo banco Postgres e backups.
- Localmente o sistema continua funcionando com `bortolini.db`.

## 1. Supabase

1. Crie um projeto no Supabase.
2. Va em **Project Settings > Database > Connection string**.
3. Copie a connection string do **Session pooler**.
4. Troque `[YOUR-PASSWORD]` pela senha do banco.
5. Guarde essa URL para usar como `DATABASE_URL` no Railway.

Exemplo:

```text
postgresql://postgres.xxxxx:SENHA@aws-0-us-east-1.pooler.supabase.com:5432/postgres
```

## 2. Railway

1. Crie um projeto no Railway.
2. Conecte o repositorio do GitHub.
3. Configure as variaveis:

```text
APP_ENV=production
APP_SECRET=gere-uma-chave-grande
ADMIN_MASTER_KEY=gere-outra-chave-grande
HOST=0.0.0.0
PORT=8000
DATABASE_URL=postgresql://...
UPLOADS_PATH=/data/uploads
PAYMENT_TOKEN=
WHATSAPP_TOKEN=
PIX_KEY=
```

4. Adicione um **Volume** no Railway.
5. Monte o volume em:

```text
/data
```

Assim fotos e comprovantes salvos em `/data/uploads` nao somem a cada deploy.

## 3. Primeiro deploy

O Railway deve executar:

```text
pip install -r requirements.txt
python server.py
```

O `Procfile` ja contem:

```text
web: python server.py
```

Na primeira subida, o backend cria as tabelas no Postgres automaticamente.

## 4. Migrar dados locais

Depois que o Railway estiver com `DATABASE_URL` funcionando, voce pode rodar localmente:

```powershell
$env:DATABASE_URL="postgresql://..."
python scripts\migrate_sqlite_to_postgres.py
```

Esse script copia os dados do `bortolini.db` para o Postgres.

## 5. Observacoes importantes

- Nao suba `bortolini.db` para o GitHub.
- Nao coloque senha do Supabase em arquivo.
- Use sempre HTTPS no dominio final.
- O banco fica no Supabase; uploads ficam no volume do Railway.
- Se no futuro quiser, os uploads podem ir para Supabase Storage.
