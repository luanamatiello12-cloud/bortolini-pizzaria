# Contexto Completo — Pizzaria Bortolini Delivery

## Stack
- Frontend: HTML/CSS/Vanilla JS (SPA single-file)
- Backend: Python `http.server.SimpleHTTPRequestHandler` + SQLite3
- Porta: 8000
- Assets: `assets/bortolini-logo.svg`

## Arquivos Principais
| Arquivo | Função |
|---------|--------|
| `server.py` | Handler HTTP customizado, rotas API, lógica DB |
| `index.html` | SPA única: login, dashboard, cardápio público, rastreamento, app entregador |
| `app.js` | Frontend: rotas, renderização, chamadas API, mapa, checkout |
| `styles.css` | Estilos completos |
| `bortolini.db` | SQLite (auto-criado por `init_db()`) |

---

## Perfis de Acesso (EXATAMENTE 3)

```python
ROLE_PERMISSIONS = {
    "admin":      {"menu","promotions","orders","settings","delivery","customers","drivers","inventory","finance"},
    "entregador": {"delivery","orders"},
    "financeiro": {"customers","finance","orders"},
}
```

| Perfil | Login | PIN | Origem |
|--------|-------|-----|--------|
| admin | CPF `00000000000` | `3725` | seed fixo |
| financeiro | CPF `44444444444` | `3702` | seed fixo |
| entregador | CPF cadastrado | primeiros 4 dígitos do CPF | criado via `create_driver()` |

**Regra do entregador:** `must_change_pin = 1` no primeiro login. PIN temporário = primeiros 4 dígitos do CPF. Após trocar, `must_change_pin = 0`.

**Roles REMOVIDAS:** `atendente`, `cozinha`, `gerente` — limpas do DB e do código.

---

## Seed do Banco (`init_db()`)

Cria tabelas e insere:
- 2 usuários (admin, financeiro)
- 1 registro `settings` com valores padrão
- **ZERO** pedidos, produtos, entregadores, conversas (banco limpo no start)

```python
seed_settings = {
    "restaurant_name": "Bortolini Pizzaria e delivery",
    "opening_hours": "18:00 às 23:30",
    "delivery_fee": "7.90",
    "delivery_areas": "Centro, Jardins, Vila Nova, Bela Vista",
    "prep_time": "35 a 45 minutos",
    "stock_whatsapp": "",
    "phone_number_id": "",
    "whatsapp_token": "",
    "pix_key": "66.686.680/0001-57",
    "payment_provider": "PIX manual",
}
```

---

## Tabelas SQLite

```sql
users           (id, cpf, pin, role, name, email, must_change_pin)
drivers         (id, name, phone, area, cpf, vehicle, user_id, created_at)
orders          (id, customer_name, phone, address, status, items_json, total,
                 payment_method, change_for, driver_id, driver_lat, driver_lng,
                 last_location_at, created_at, pix_receipt_path, notes)
menu_items      (id, name, description, price, category, image_url, active)
inventory       (id, name, code, stock_qty, min_qty, unit, category, alert_sent)
customers       (id, name, phone, address, created_at, orders_count, total_spent)
settings        (key, value)
conversations   (id, phone, messages_json, last_message_at, status, assigned_to)
payments        (id, order_id, method, amount, status, receipt_url, created_at)
promotions      (id, title, description, discount_type, discount_value, active)
```

---

## Rotas Públicas (sem auth)

```
GET    /#customer                        → cardápio para clientes
GET    /?pedido=<id>  /?order_id=<id>   → rastreamento de pedido
GET    /entregador/<id>                  → app do entregador (compartilha GPS)
GET    /api/public/orders/<id>           → dados do pedido (JSON)
POST   /api/public/orders/<id>/comprovante → upload de comprovante PIX
POST   /api/public/drivers/<id>/location   → entregador envia localização
```

---

## Rotas API Autenticadas (requer session/user)

```
POST   /api/login
POST   /api/logout
GET    /api/session
GET    /api/orders
POST   /api/orders                    → criar pedido
POST   /api/orders/<id>/status        → atualizar status
POST   /api/orders/<id>/assign        → designar entregador
POST   /api/orders/<id>/location      → admin atualiza localização do entregador
GET    /api/menu
POST   /api/menu                      → criar/editar item
DELETE /api/menu/<id>
GET    /api/inventory
POST   /api/inventory                 → criar/editar ingrediente
DELETE /api/inventory/<id>
GET    /api/drivers
POST   /api/drivers                   → criar entregador (admin)
DELETE /api/drivers/<id>
GET    /api/customers
GET    /api/payments
POST   /api/payments                  → registrar pagamento
GET    /api/settings
POST   /api/settings                  → salvar config
GET    /api/reports/sales
GET    /api/reports/inventory
GET    /api/conversations
POST   /api/conversations/<id>/reply
POST   /api/conversations/<id>/assign
POST   /api/conversations/<id>/resolve
GET    /api/public/drivers            → lista entregadores ativos (para mapa)
```

---

## Fluxos Principais

### 1. Cliente faz pedido
1. Acessa `/#customer`
2. Navega cardápio → adiciona ao carrinho
3. Checkout (`checkoutCart()`):
   - preenche nome, telefone, endereço
   - escolhe pagamento (PIX, dinheiro, cartão)
   - se PIX: exibe chave + pode anexar comprovante (multipart upload para `/api/public/orders/<id>/comprovante`)
   - se dinheiro: informa troco
4. Recebe link de rastreamento: `/?pedido=<id>`

### 2. Rastreamento de pedido (`trackOrderV2()`)
- Timeline de status: recebido → preparo → pronto → saiu para entrega → entregue
- Lista de itens + total + forma de pagamento
- Se status = "saiu" ou "entregue":
  - mostra localização do entregador (`driver_lat`, `driver_lng`)
  - link Google Maps com as coordenadas
  - atualiza a cada 10s via polling `/api/public/orders/<id>`

### 3. Admin gerencia entregas
1. Aba **Pedidos**: lista todos, muda status, abre detalhes
2. Aba **Entregas**:
   - Mapa mostra todos entregadores ativos
   - Cinza = disponível, Azul = em entrega
   - Mostra também pins dos destinos de entrega
   - Pode designar entregador a um pedido (`POST /api/orders/<id>/assign`)

### 4. Entregador trabalha
1. Admin cria entregador: **Configurações → Motoristas → Novo**
   - campos: nome, bairro, CPF
   - `create_driver()`:
     - insere em `drivers`
     - cria usuário em `users` com `role="entregador"`, PIN = primeiros 4 dígitos do CPF, `must_change_pin=1`
     - retorna link público `/entregador/<driver_id>`
2. Entregador abre link no celular
3. Página pública (`initDriverPublicPage()`):
   - Solicita permissão de GPS (`navigator.geolocation.watchPosition`)
   - Envia localização para `POST /api/public/drivers/<user_id>/location` (a cada 10s)
   - Se houver pedido designado, envia também para `POST /api/deliveries/<order_id>/location`
   - Mostra pedido ativo com botão "Marcar como entregue"

### 5. Controle de Estoque
- Aba **Estoque** (`renderInventory()`)
- Formulário obrigatório: **nome, código, quantidade, quantidade mínima**
- Backend `create_ingredient()` rejeita se faltar qualquer campo obrigatório
- Alerta automático: quando `stock_qty <= min_qty`, chama `send_whatsapp_low_stock_alert()`
  - envia mensagem para `settings.stock_whatsapp` (número configurado em Configurações)
  - usa `requests` para API WhatsApp (se token/phone_number_id configurados) ou simula log

### 6. PIX
- Chave padrão: `66.686.680/0001-57` (CNPJ)
- Cliente pode anexar comprovante:
  - no checkout (imediatamente)
  - depois, via link de rastreamento
- Arquivo salvo em disco, path guardado em `orders.pix_receipt_path`
- Admin vê status do pagamento na aba Pagamentos/Financeiro

### 7. Atendimento WhatsApp
- Aba **Atendimento IA** (`renderInboxQrPanel()`)
- **NÃO tem mais chat/conversas** — foi removido
- Apenas painel com QR Code que direciona para `https://wa.me/<numero_configurado>`
- Número vem de `settings.phone_number_id` ou `settings.stock_whatsapp`

---

## Decisões Arquiteturais Importantes

1. **Apenas 3 roles:** admin, entregador, financeiro. Outros removidos completamente.
2. **App do entregador NÃO é uma aba no dashboard** — acesso apenas via link público `/entregador/<id>` (removido botão "App entregador" da sidebar).
3. **Sem dados de demo:** `loadData()` retorna arrays vazios se API falhar. Banco inicia limpo.
4. **Servidor:** `py server.py` no terminal direto. NÃO usar background task (timeout em 60s mata o processo).
5. **Mapa:** implementado com CSS puro (pins absolutamente posicionados em container), não usa biblioteca de mapa externa.
6. **GPS:** `navigator.geolocation.watchPosition` com fallback para `getCurrentPosition`.
7. **PIN do entregador:** derivado do CPF, força troca no primeiro login por segurança.

---

## Problemas / Limitações Conhecidas

- Background task (Kimi) timeout após 60s — usar terminal direto
- Mapa é esquemático (CSS), não é Google Maps embed
- WhatsApp alerts dependem de configuração manual de token/phone_number_id
- Não há autenticação por JWT — sessão simples via `self.get_current_user()` lendo cookie/session

---

## Como Reiniciar do Zero

```bash
# 1. Matar servidor
pkill -f server.py

# 2. Apagar banco (dados limpos)
rm bortolini.db

# 3. Reabrir e subir servidor
cd "C:\Users\04254966008\Desktop\Pizzaria bortolini2"
py server.py
```

---

## Credenciais para Teste

```
Admin:       CPF=00000000000  PIN=3725
Financeiro:  CPF=44444444444  PIN=3702
Entregador:  CPF=<cadastrado> PIN=<primeiros 4 dígitos do CPF>
```

---

Última atualização: 2026-05-20
