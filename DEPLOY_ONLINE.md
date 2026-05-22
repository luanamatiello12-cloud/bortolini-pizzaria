# Deploy online - Bortolini Pizzaria e delivery

O projeto está pronto para rodar localmente com Python e SQLite. Para publicar online:

1. Suba o projeto para o GitHub.
2. Hospede em Render, Railway, VPS ou serviço equivalente com Python.
3. Configure domínio, por exemplo `pedido.bortolini.com.br`.
4. Ative HTTPS.
5. Em produção, troque PIN por senha criptografada.
6. Mova tokens de PIX, gateway e WhatsApp para variáveis de ambiente.
7. Use backup automático do banco.
8. Avalie trocar SQLite por PostgreSQL se o volume crescer.
9. Revise LGPD para dados de cliente e localização do entregador.

O projeto já contém:

- `.env.example`
- `requirements.txt`
- `Procfile`
- `render.yaml`
- `SEGURANCA_PRODUCAO.md`

Não envie `.env` nem `*.db` ao GitHub.

Comando local:

```powershell
python server.py
```

URL local:

```text
http://127.0.0.1:8000
```

Checklist dentro do sistema:

- Configurações
- Integrações
- Pagamento online
- WhatsApp
- GPS
- Deploy online

## Exemplo de variáveis de produção

```text
APP_ENV=production
APP_SECRET=troque-por-chave-forte
HOST=0.0.0.0
PORT=10000
DATABASE_PATH=/var/data/bortolini.db
```

## Persistência

O `render.yaml` monta um disco em `/var/data` para o banco SQLite.
Para fotos de produtos, configure também persistência para a pasta `uploads/` ou use storage externo.

## Variáveis sensíveis

Em produção, defina no provedor e não salve no Git:

```text
PAYMENT_TOKEN=token-do-gateway
WHATSAPP_TOKEN=token-da-api-whatsapp
PIX_KEY=sua-chave-pix
```
