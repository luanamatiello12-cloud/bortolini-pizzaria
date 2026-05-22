# Instruções de Deploy Manual no Render

## Status atual
O código no GitHub está 100% corrigido, mas o Render NÃO está fazendo deploy automático.
O servidor no Render (`bortolini-pizzaria.onrender.com`) está rodando uma versão antiga do código.

## O que foi corrigido no código
1. **Sessões persistidas no PostgreSQL** — tokens de login agora sobrevivem a reinícios do servidor
2. **Problema do 502 corrigido** — todas as operações de criação (bairros, produtos, entregadores, etc.) agora usam `RETURNING *` no SQL, compatível com PostgreSQL
3. **Botão X dos modais** — adicionados event listeners explícitos para garantir fechamento

## Como fazer deploy manual no Render

1. Acesse o dashboard do Render: https://dashboard.render.com/
2. Faça login com sua conta
3. Encontre o serviço **bortolini-delivery** (ou similar)
4. Clique no serviço para abrir os detalhes
5. Clique em **"Manual Deploy"** (canto superior direito)
6. Selecione **"Deploy latest commit"**
7. Aguarde o build terminar (1–3 minutos)
8. Verifique os logs de build se houver erro

## Após o deploy

1. No navegador, acesse: https://bortolini-pizzaria.onrender.com/
2. Pressione **Ctrl + F5** para limpar o cache
3. Faça login com `adm` / `3725`
4. Teste:
   - Criar um bairro em **Configurações → Bairros e taxas**
   - Criar um produto em **Cardápio**
   - Verificar se o X dos modais fecha

## Se o build falhar no Render

Verifique se a variável de ambiente `DATABASE_URL` está configurada corretamente:
- Vá em **Environment** no dashboard do Render
- Confirme que `DATABASE_URL` aponta para o PostgreSQL do Render

## Se o deploy automático não funcionar no futuro

O Render pode ter perdido a conexão com o GitHub. Para reconectar:
1. No dashboard do Render, vá em **Settings → Git Repository**
2. Clique em **Connect** e selecione o repositório `luanamatiello12-cloud/bortolini-pizzaria`
3. Certifique-se de que a branch é `main`
