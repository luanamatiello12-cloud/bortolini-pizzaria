# 🍕 Pizzaria Bortolini — Sistema Completo

## O que foi construído
Sistema de gestão de delivery com 3 perfis de acesso, rastreamento de entregas em tempo real, controle de estoque, PIX e painel financeiro.

---

## 📂 Estrutura do Projeto

```
Pizzaria bortolini2/
├── server.py              # Backend Python (SimpleHTTPRequestHandler + SQLite)
├── index.html             # SPA frontend (painel + cardápio público)
├── app.js                 # Lógica frontend completa
├── styles.css             # Estilos
├── bortolini.db           # Banco SQLite (criado automaticamente)
├── assets/
│   └── bortolini-logo.svg # Logo
```

---

## 🚀 Como iniciar o sistema

```bash
cd "C:\Users\04254966008\Desktop\Pizzaria bortolini2"
py server.py
```
Acesse: **http://localhost:8000**

> ⚠️ **NÃO use background task** — a ferramenta de monitoramento encerra o servidor após 60s. Rode direto no terminal e deixe aberto.

---

## 👤 Perfis de Acesso (apenas 3)

| Perfil | CPF | PIN | Permissões |
|--------|-----|-----|-----------|
| **Admin** | `00000000000` | `3725` | Tudo: pedidos, cardápio, entregas, estoque, motoristas, financeiro, clientes, configurações |
| **Financeiro** | `44444444444` | `3702` | Pedidos, clientes, financeiro, relatórios, exportação |
| **Entregador** | Cadastrado pelo admin | Primeiros 4 dígitos do CPF (obrigatório trocar no 1º login) | Entregas, visualizar pedidos |

---

## 🔗 Links Públicos (sem login)

| URL | Descrição |
|-----|-----------|
| `http://localhost:8000/#customer` | Cardápio público para clientes fazerem pedidos |
| `http://localhost:8000/?pedido=ID` | Rastrear pedido (status, timeline, local do entregador) |
| `http://localhost:8000/entregador/<id>` | App do entregador (compartilhar GPS, marcar entregue) |

---

## 📋 Fluxos Principais

### 1. Cliente faz pedido
1. Acessa `/#customer`
2. Escolhe pizzas, adiciona ao carrinho
3. Faz checkout (PIX = envia comprovante)
4. Recebe link de rastreamento: `/?pedido=ID`

### 2. Admin gerencia pedidos
1. Login como admin
2. Aba **Pedidos**: visualiza, muda status (recebido → preparo → pronto → saiu → entregue)
3. Aba **Entregas**: vê mapa com entregadores ativos (cinza=disponível, azul=em entrega) + destinos
4. Aba **Entregas**: designa entregador para o pedido

### 3. Entregador trabalha
1. Admin cadastra entregador: nome + bairro + CPF
2. Sistema gera link: `/entregador/<id>`
3. Entregador abre link no celular
4. Compartilha GPS (posição em tempo real)
5. Vê pedidos designados e marca como entregue
6. Cliente vê localização ao vivo em `/?pedido=ID`

### 4. Controle de estoque
1. Aba **Estoque**: cadastrar ingredientes (nome, código, quantidade, mínimo)
2. Campos obrigatórios: nome, código, qtd, qtd mínima
3. Alerta automático no WhatsApp quando estoque ≤ mínimo (configurar número em Configurações)

### 5. Financeiro
- Aba **Financeiro**: visão de vendas, pagamentos
- Aba **Clientes**: histórico por cliente
- Aba **Relatórios**: exportação

### 6. PIX
- Chave PIX padrão: `66.686.680/0001-57`
- Cliente pode anexar comprovante no checkout ou depois
- Admin vê status de pagamento

### 7. Atendimento WhatsApp
- Aba **Atendimento IA**: QR Code para conectar WhatsApp (`wa.me/<número configurado>`)

---

## 🗄️ Banco de Dados (SQLite)

Tabelas principais:
- `users` — usuários (admin, financeiro, entregador)
- `drivers` — entregadores + link público
- `orders` — pedidos + localização do entregador (lat/lng)
- `menu_items` — cardápio
- `inventory` — estoque
- `customers` — clientes
- `settings` — configurações (PIX, WhatsApp, taxa entrega, etc.)

Seed inicial:
- 2 usuários fixos (admin, financeiro)
- Nenhum pedido, produto, entregador ou conversa (limpo)

---

## ⚙️ Configurações Importantes

Editar em **Configurações** (aba no admin):
- `pix_key` — Chave PIX
- `stock_whatsapp` — Número para alertas de estoque baixo
- `delivery_fee` — Taxa de entrega
- `delivery_areas` — Bairros atendidos
- `opening_hours` — Horário de funcionamento

---

## 🛠️ Tecnologias

- **Frontend**: HTML5 + CSS3 + Vanilla JS
- **Backend**: Python 3 + `http.server.SimpleHTTPRequestHandler`
- **Banco**: SQLite3 (biblioteca nativa Python)
- **Mapa**: CSS puro (pins posicionados com lat/lng)
- **Ícones**: FontAwesome CDN

---

## ✅ Funcionalidades Entregues

- [x] Sistema de login com 3 perfis
- [x] Cardápio público (`/#customer`)
- [x] Pedidos com status e timeline
- [x] Rastreamento de pedidos (`/?pedido=ID`)
- [x] Cadastro e gestão de entregadores
- [x] App do entregador (link público)
- [x] GPS em tempo real (entregador + mapa admin)
- [x] Mapa com entregadores ativos
- [x] Controle de estoque com alertas WhatsApp
- [x] Checkout PIX com comprovante
- [x] Painel financeiro
- [x] QR Code WhatsApp
- [x] Sem dados de demo (limpo ao iniciar)
- [x] Logo da pizzaria

---

## 📌 Dicas Rápidas

- Sempre rode `py server.py` direto no terminal (não em background)
- O banco `bortolini.db` é criado automaticamente se não existir
- Para resetar dados: apague `bortolini.db` e reinicie o server
- Entregador troca PIN no primeiro login (senha temporária = 4 primeiros dígitos do CPF)

---

*Última atualização: 20/05/2026*
