# Reconectar Render ao GitHub (Deploy Automático)

## Problema identificado
O Render NÃO está recebendo os eventos de push do GitHub.
O webhook do GitHub pode estar conectado à Vercel (deploy antigo) e não ao Render.

## Como verificar

1. Acesse o repositório no GitHub:
   https://github.com/luanamatiello12-cloud/bortolini-pizzaria/settings/hooks

2. Veja a lista de webhooks configurados
3. Se houver um webhook da Vercel mas NÃO da Render, o deploy automático do Render não funciona

## Como reconectar o Render ao GitHub

### Opção 1: Pelo dashboard do Render (recomendado)

1. Acesse https://dashboard.render.com/
2. Vá no serviço **bortolini-delivery**
3. Clique em **Settings**
4. Vá em **Git Repository**
5. Clique em **Disconnect** (se estiver conectado a algo)
6. Clique em **Connect Account** e escolha **GitHub**
7. Selecione o repositório `luanamatiello12-cloud/bortolini-pizzaria`
8. Certifique-se de que a branch é `main`
9. Salve as alterações

### Opção 2: Pelo GitHub (manual)

1. Acesse https://github.com/luanamatiello12-cloud/bortolini-pizzaria/settings/hooks
2. Clique em **Add webhook**
3. Em **Payload URL**, cole a URL de deploy do Render:
   - Você encontra essa URL no dashboard do Render em **Settings → Deploy Hook**
4. Em **Content type**, selecione `application/json`
5. Em **Which events would you like to trigger this webhook?**, selecione **Just the push event**
6. Clique em **Add webhook**

## Após reconectar

1. Faça qualquer commit no repositório (ou use "Manual Deploy" no Render)
2. Aguarde 1-3 minutos
3. Verifique em https://bortolini-pizzaria.onrender.com/api/version
   - Se retornar `{"version": "3390796"}`, o deploy funcionou!
