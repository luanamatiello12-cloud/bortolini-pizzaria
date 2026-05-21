# Segurança para publicar o sistema

Este projeto foi organizado para rodar localmente e para ter um caminho seguro de publicação.

## O que já foi organizado

- `.env.example` para separar configurações do código.
- `.env` ignorado pelo Git.
- Banco local `*.db` ignorado pelo Git para não subir clientes/pedidos.
- `APP_SECRET` para hash de PIN/senha.
- PINs migrados para hash no banco.
- `HOST`, `PORT` e `DATABASE_PATH` configuráveis por ambiente.
- Headers básicos de segurança no servidor.
- Tokens sensíveis mascarados em produção na rota de configurações.
- Tokens sensíveis lidos de variáveis de ambiente em produção.
- Ações administrativas de menu, promoções, configurações, pedidos e entregas validam permissão no backend.
- Fotos enviadas são gravadas em `uploads/`, não diretamente no banco.
- Pedidos possuem itens estruturados em `order_items`, facilitando auditoria e relatórios.
- Existe rota pública limitada para status do pedido, sem expor telefone, endereço ou observações.
- `render.yaml` e `Procfile` para deploy.

## Antes de colocar cliente real

1. Defina `APP_ENV=production`.
2. Defina `APP_SECRET` forte e único.
3. Use HTTPS.
4. Não salve dados de cartão.
5. Use gateway de pagamento, como Mercado Pago ou Pagar.me.
6. Guarde token de pagamento e WhatsApp em variáveis de ambiente.
7. Faça backup do banco.
8. Restrinja acesso administrativo.
9. Avise entregadores sobre compartilhamento de localização.
10. Tenha política de privacidade para clientes.

## Pagamentos

O sistema deve receber apenas:

- status do pagamento
- id da transação
- valor
- método

Dados de cartão devem ficar no gateway de pagamento.

## Variáveis sensíveis

Em produção, use:

```text
PAYMENT_TOKEN=token-do-gateway
WHATSAPP_TOKEN=token-da-api-whatsapp
PIX_KEY=sua-chave-pix
```

Esses valores não devem ficar no GitHub nem em prints.

## Banco de dados

Para começar pequeno, SQLite com backup pode funcionar. Para produção mais séria:

- PostgreSQL gerenciado
- backup automático
- logs sem dados sensíveis
- retenção de dados definida

## Uploads

Em produção, configure armazenamento persistente para `uploads/`.
Se o provedor recriar o container a cada deploy, use storage externo como S3, Cloudflare R2 ou disco persistente do provedor.

## GitHub

Não suba:

- `.env`
- bancos `.db`
- tokens
- senhas
- dumps de clientes

Suba apenas código, assets públicos e documentação.
