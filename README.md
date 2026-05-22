# 🍕 Pizzaria Bortolini — Sistema de Delivery

Sistema completo de gestão de delivery com rastreamento de entregas em tempo real, controle de estoque, PIX e painel financeiro.

---

## 🚀 Como iniciar

```bash
cd "Pizzaria bortolini2"
py server.py
```
Acesse: **http://localhost:8000**

> ⚠️ Execute no terminal diretamente. Não use background task — o monitoramento encerra após 60s.

---

## 👤 Perfis de Acesso (apenas 3)

| Perfil | CPF | PIN | Acesso |
|--------|-----|-----|--------|
| **Admin** | `00000000000` | `3725` | Todas as abas |
| **Financeiro** | `44444444444` | `3702` | Pedidos, clientes, financeiro, relatórios |
| **Entregador** | CPF cadastrado pelo admin | Primeiros 4 dígitos do CPF (trocar no 1º login) | Entregas e pedidos |

---

## 🔗 Links Públicos (sem login)

| URL | Função |
|-----|--------|
| `http://localhost:8000/#customer` | Cardápio público para clientes |
| `http://localhost:8000/?pedido=ID` | Rastrear pedido (status + local do entregador) |
| `http://localhost:8000/entregador/<id>` | App do entregador (GPS + pedidos) |

---

## 📋 Fluxos Principais

### Cliente faz pedido
1. Acessa `/#customer`
2. Escolhe itens do cardápio e adiciona ao carrinho
3. Faz checkout (PIX: anexa comprovante)
4. Recebe link de rastreamento: `/?pedido=ID`

### Admin gerencia
1. Login → aba **Pedidos** (visualiza/muda status)
2. Aba **Entregas** (mapa com entregadores + designa entregador)
3. Aba **Estoque** (cadastra ingredientes, vê alertas)
4. Aba **Configurações** (PIX, WhatsApp, taxa de entrega)

### Entregador trabalha
1. Admin cadastra entregador (nome, bairro, CPF)
2. Sistema gera link: `/entregador/<id>`
3. Entregador abre no celular → compartilha GPS
4. Vê pedido designado → marca como entregue
5. Cliente vê localização ao vivo no rastreamento

---

## ⚙️ Configurações

Acesse a aba **Configurações** no painel admin:

| Chave | Padrão | Descrição |
|-------|--------|-----------|
| `pix_key` | `66.686.680/0001-57` | Chave PIX (CNPJ) |
| `stock_whatsapp` | *(vazio)* | Número para alertas de estoque baixo |
| `delivery_fee` | `7.90` | Taxa de entrega |
| `delivery_areas` | `Centro, Jardins...` | Bairros atendidos |
| `opening_hours` | `18:00 às 23:30` | Horário de funcionamento |

---

## 🗄️ Banco de Dados

SQLite — arquivo `bortolini.db` (criado automaticamente).

Tabelas: `users`, `drivers`, `orders`, `menu_items`, `inventory`, `customers`, `settings`, `payments`, `promotions`.

**Inicialização limpa:** apenas 2 usuários (admin, financeiro) + configurações. Sem pedidos, produtos ou entregadores de demo.

---

## 🛠️ Stack Técnico

- **Frontend:** HTML5 + CSS3 + Vanilla JS (SPA)
- **Backend:** Python `http.server.SimpleHTTPRequestHandler`
- **Banco:** SQLite3
- **Mapa:** CSS puro (pins com lat/lng)

---

## 📁 Arquivos do Projeto

| Arquivo | Descrição |
|---------|-----------|
| `server.py` | Backend + API + banco |
| `index.html` | SPA frontend |
| `app.js` | Lógica frontend |
| `styles.css` | Estilos |
| `bortolini.db` | Banco SQLite |
| `assets/bortolini-logo.svg` | Logo da pizzaria |
| `CONTEXT.md` | **Contexto técnico completo** para IA/Claude |

---

## 🔄 Resetar tudo

Apague `bortolini.db` e reinicie `server.py`. O sistema recria o banco limpo.

---

*Última atualização: 20/05/2026*
