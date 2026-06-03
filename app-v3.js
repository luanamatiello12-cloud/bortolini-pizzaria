const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

let menuItems = [];
let orders = [];
let demoUsers = [];
let deliveries = [];
let promotions = [];
let productPhotoData = "";
let pixReceiptData = "";
let customers = [];
let settings = {};
let cart = [];
let editingProductId = null;
let editingPromotionId = null;
let editingZoneId = null;
let cancelOrderId = null;
let closeout = null;
let ingredients = [];
let recipes = [];
let stockMovements = [];
let deliveryZones = [];
let profitReport = [];
let internalOrderItems = [];
let notifiedLowStockIds = new Set();

let conversations = [];

let drivers = [];

const PIZZA_SIZES = [
  { key: "broto", label: "Pizza Broto", cm: "20 cm", slices: "4 fatias", flavors: 1, price: 35 },
  { key: "p", label: "Pizza P", cm: "25 cm", slices: "6 fatias", flavors: 2, price: 45 },
  { key: "m", label: "Pizza M", cm: "30 cm", slices: "8 fatias", flavors: 2, price: 55 },
  { key: "g", label: "Pizza G", cm: "35 cm", slices: "12 fatias", flavors: 3, price: 70 },
  { key: "gg", label: "Pizza GG", cm: "40 cm", slices: "16 fatias", flavors: 4, price: 85 },
];

function updatePizzaSizesFromSettings() {
  try {
    const stored = JSON.parse(settings.pizza_sizes || "[]");
    if (Array.isArray(stored)) {
      stored.forEach((s) => {
        const size = PIZZA_SIZES.find((ps) => ps.key === s.key);
        if (size && s.price !== undefined) {
          size.price = Number(s.price);
        }
      });
    }
  } catch (e) {
    // manter padrões
  }
}

const CRUST_PRICES = {
  "": 0,
  "Borda recheada catupiry": 10,
  "Borda recheada cheddar": 10,
  "Borda recheada chocolate": 8,
  "Borda de cream cheese": 8,
};

const fallbackMenu = [];

function getItemImage(itemName) {
  return menuItems.find((item) => item.name === itemName)?.image_url || "";
}

function renderPhoto(src, className, label) {
  if (src) {
    return `<img class="${className}" src="${src}" alt="${label}" />`;
  }
  return `<div class="${className} photo-placeholder" aria-label="${label}">Foto</div>`;
}

const fallbackOrders = [];

const fallbackPromotions = [];

const state = {
  filter: "Todos",
  financeFilter: "day",
  search: "",
  customerNameFilter: "",
  customerPhoneFilter: "",
  customerAddressFilter: "",
  customerMinOrders: 5,
  menuCategory: "Todos",
  orderCategory: "Todos",
  conversation: 0,
  apiOnline: false,
  currentUser: null,
};

const permissions = {
  admin: ["dashboard", "orders", "customer", "menu", "inventory", "inbox", "delivery", "payments", "customers", "reports", "settings", "integrations", "createOrder", "updateOrder", "exportOrders", "drivers", "finance"],
  entregador: ["delivery", "orders", "updateOrder"],
  financeiro: ["dashboard", "payments", "customers", "reports", "orders", "finance", "exportOrders"],
};

const roleLabels = {
  admin: "adm",
  entregador: "Entregador",
  financeiro: "Financeiro",
};

const statusFlow = {
  Novo: "Cozinha",
  Cozinha: "Entrega",
  Entrega: "Finalizado",
  Finalizado: "Finalizado",
  Cancelado: "Cancelado",
};

function byId(id) {
  return document.getElementById(id);
}

function can(permission) {
  if (!state.currentUser) return false;
  return permissions[state.currentUser.role]?.includes(permission) || false;
}

function canAdvanceOrder(order) {
  const role = state.currentUser?.role;
  if (!order || order.status === "Finalizado" || order.status === "Cancelado") return false;
  if (role === "admin") return true;
  if (role === "entregador") return order.status === "Entrega";
  return false;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.currentUser?.token ? { "X-Session-Token": state.currentUser.token } : {}),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    let message = `Erro na API: ${response.status}`;
    try {
      const text = await response.text();
      const match = text.match(/Message: ([^<]+)/);
      message = match ? match[1].trim() : text || message;
    } catch (error) {
      message = `Erro na API: ${response.status}`;
    }
    const apiError = new Error(message);
    apiError.status = response.status;
    throw apiError;
  }
  return response.json();
}

async function loadData() {
  const endpoints = [
    ["/api/menu",           (v) => { menuItems = v; }],
    ["/api/orders",         (v) => { orders = v; }],
    ["/api/users",          (v) => { demoUsers = v; }],
    ["/api/deliveries",     (v) => { deliveries = v; }],
    ["/api/promotions",     (v) => { promotions = v; }],
    ["/api/customers",      (v) => { customers = v; }],
    ["/api/settings",       (v) => { settings = v; }],
    ["/api/public/settings",(v) => { if (!settings.restaurant_name) settings = v; }],
    ["/api/inbox",          (v) => { conversations = v; }],
    ["/api/drivers",        (v) => { drivers = v; }],
    ["/api/closeout",       (v) => { closeout = v; }],
    ["/api/ingredients",    (v) => { ingredients = v; }],
    ["/api/recipes",        (v) => { recipes = v; }],
    ["/api/stock-movements",(v) => { stockMovements = v; }],
    ["/api/delivery-zones", (v) => { deliveryZones = v; }],
    ["/api/profit-report",  (v) => { profitReport = v; }],
  ];

  const results = await Promise.allSettled(endpoints.map(([path]) => api(path)));
  let anySuccess = false;
  const failed = [];

  results.forEach((result, index) => {
    const [path, setter] = endpoints[index];
    if (result.status === "fulfilled") {
      setter(result.value);
      anySuccess = true;
    } else {
      failed.push(path);
    }
  });

  if (anySuccess) {
    state.apiOnline = true;
    if (failed.length) {
      console.warn("APIs com falha:", failed);
    }
  } else {
    // Fallback completo (modo offline limpo)
    menuItems = fallbackMenu;
    orders = fallbackOrders;
    promotions = fallbackPromotions;
    customers = [];
    ingredients = [];
    recipes = [];
    stockMovements = [];
    deliveryZones = [];
    profitReport = [];
    settings = {
      restaurant_name: "Minha Pizzaria",
      opening_hours: "",
      delivery_fee: "",
      delivery_areas: "",
      prep_time: "",
      pizza_sizes: JSON.stringify(PIZZA_SIZES.map((s) => ({ key: s.key, price: s.price }))),
    };
    deliveries = [];
    demoUsers = [
      { username: "admin", email: "admin@bortolini.com", name: "adm", role: "admin", must_change_pin: 1 },
      { username: "entregador", email: "entregador@bortolini.com", name: "Entregador", role: "entregador", must_change_pin: 1 },
      { username: "financeiro", email: "financeiro@bortolini.com", name: "Financeiro", role: "financeiro", must_change_pin: 1 },
    ];
    state.apiOnline = false;
  }
  rememberCurrentLowStock();
  loadCart();
  updatePizzaSizesFromSettings();
}

function filteredOrders() {
  const query = state.search.trim().toLowerCase();
  return orders.filter((order) => {
    const matchesFilter = state.filter === "Todos" || order.status === state.filter;
    const text = `${order.id} ${order.customer} ${order.channel} ${order.item}`.toLowerCase();
    return matchesFilter && (!query || text.includes(query));
  });
}

function renderMetrics() {
  const validOrders = orders.filter((order) => order.status !== "Cancelado");
  const revenue = validOrders.reduce((sum, order) => sum + Number(order.total), 0);
  const openOrders = orders.filter((order) => !["Finalizado", "Cancelado"].includes(order.status)).length;
  const average = validOrders.length ? revenue / validOrders.length : 0;
  const lowStock = ingredients.filter((ingredient) => ingredient.low_stock || Number(ingredient.stock_qty) <= Number(ingredient.min_qty)).length;
  const pendingPix = orders.filter((order) => order.payment === "PIX" && !["Pago", "Comprovante aprovado"].includes(order.payment_status || "")).length;
  const metrics = [
    ["Vendas de hoje", currency.format(revenue), state.apiOnline ? "Banco SQLite ativo" : "Modo demonstração"],
    ["Pedidos ativos", openOrders, "Atualização em tempo real"],
    ["Ticket médio", currency.format(average), "+7% na semana"],
    ["Estoque baixo", lowStock, lowStock ? "Comprar antes do próximo turno" : "Sem item no mínimo"],
    ["PIX pendente", pendingPix, pendingPix ? "Conferir comprovantes" : "Tudo conferido"],
  ];

  byId("metrics").innerHTML = metrics
    .map(
      ([label, value, hint]) => `
        <article class="metric-card">
          <small>${label}</small>
          <strong>${value}</strong>
          <span>${hint}</span>
        </article>
      `,
    )
    .join("");
  renderOwnerAlerts();
}

function renderOwnerAlerts() {
  const box = byId("owner-alerts");
  if (!box) return;
  const open = orders.filter((order) => !["Finalizado", "Cancelado"].includes(order.status));
  const late = open.filter((order) => orderAge(order) > 30 && order.status !== "Entrega");
  const pendingPix = orders.filter((order) => order.payment === "PIX" && !["Pago", "Comprovante aprovado"].includes(order.payment_status || ""));
  const lowStock = ingredients.filter((ingredient) => ingredient.low_stock || Number(ingredient.stock_qty) <= Number(ingredient.min_qty));
  const alerts = [
    ...late.map((order) => [`Pedido atrasado`, `#${order.id} - ${escapeHtml(order.item)} - ${orderAge(order)} min`]),
    ...pendingPix.map((order) => [`PIX pendente`, `#${order.id} - ${escapeHtml(order.customer)} - ${currency.format(order.total)}`]),
    ...lowStock.map((ingredient) => [`Estoque no mínimo`, `${escapeHtml(ingredient.name)}: ${Number(ingredient.stock_qty).toLocaleString("pt-BR")} ${escapeHtml(ingredient.unit)}`]),
  ];
  box.innerHTML = alerts.length
    ? alerts.slice(0, 8).map(([title, detail]) => `<article class="best-item"><strong>${escapeHtml(title)}</strong><span>${detail}</span></article>`).join("")
    : `<article class="best-item"><strong>Operação tranquila</strong><span>Sem alertas críticos agora.</span></article>`;
}

function renderOrders() {
  const rows = filteredOrders();
  renderOrderInsights();
  byId("orders-table").innerHTML = rows
    .map(
      (order) => `
        <tr>
          <td>#${order.id}</td>
          <td>
            <div class="order-cell">
              ${renderPhoto(getItemImage(order.item), "order-photo", escapeHtml(order.item))}
              <div>${escapeHtml(order.customer)}<br><small>${escapeHtml(order.item)}${order.driver_name ? ` · ${escapeHtml(order.driver_name)} em rota` : ""}${order.payment_receipt_url ? " · comprovante anexado" : ""}</small></div>
            </div>
          </td>
          <td>${escapeHtml(order.channel)}<br><small>${escapeHtml(order.delivery_type) || "Entrega"}</small></td>
          <td><span class="status-pill">${escapeHtml(order.status)}</span></td>
          <td>${currency.format(order.total)}</td>
          <td><span class="status-pill">${order.payment || "Não informado"}</span></td>
          <td>
            <span class="status-pill">${order.payment_status || "Aguardando pagamento"}</span>
            ${order.payment_receipt_url && can("finance") ? `<button class="ghost" data-approve-payment="${order.id}">Aprovar PIX</button><button class="ghost danger-link" data-reject-payment="${order.id}">Recusar PIX</button>` : ""}
            <button class="secondary" data-advance="${order.id}" ${!canAdvanceOrder(order) ? "disabled" : ""}>
              ${order.status === "Finalizado" ? "Concluído" : "Avançar"}
            </button>
            ${canCancelOrder(order) ? `<button class="ghost danger-link" data-cancel-order="${order.id}">Cancelar</button>` : ""}
            <button class="ghost" data-whatsapp="${order.id}">WhatsApp</button>
            <button class="ghost" data-print-order="${order.id}">Imprimir</button>
            ${order.cancel_reason ? `<small class="cancel-note">Motivo: ${order.cancel_reason}</small>` : ""}
          </td>
        </tr>
      `,
    )
    .join("");

  document.querySelectorAll("[data-advance]").forEach((button) => {
    button.addEventListener("click", () => advanceOrder(Number(button.dataset.advance)));
  });
  document.querySelectorAll("[data-whatsapp]").forEach((button) => {
    button.addEventListener("click", () => copyWhatsAppMessage(Number(button.dataset.whatsapp)));
  });
  document.querySelectorAll("[data-print-order]").forEach((button) => {
    button.addEventListener("click", () => printOrder(Number(button.dataset.printOrder)));
  });
  document.querySelectorAll("[data-cancel-order]").forEach((button) => {
    button.addEventListener("click", () => openCancelDialog(Number(button.dataset.cancelOrder)));
  });
  document.querySelectorAll("[data-approve-payment]").forEach((button) => {
    button.addEventListener("click", () => updatePaymentStatus(Number(button.dataset.approvePayment), "Pago", "Aprovado"));
  });
  document.querySelectorAll("[data-reject-payment]").forEach((button) => {
    button.addEventListener("click", () => updatePaymentStatus(Number(button.dataset.rejectPayment), "Pagamento recusado", "Recusado"));
  });
}

function canCancelOrder(order) {
  const role = state.currentUser?.role;
  return role === "admin" && !["Finalizado", "Cancelado"].includes(order.status);
}

function renderLiveOrders() {
  byId("live-orders").innerHTML = orders
    .filter((order) => !["Finalizado", "Cancelado"].includes(order.status))
    .slice(0, 4)
    .map(
      (order) => `
        <article class="order-card">
          <div>
            <strong>#${order.id} · ${escapeHtml(order.customer)}</strong>
            <p>${escapeHtml(order.item)} via ${escapeHtml(order.channel)}</p>
          </div>
          <span class="status-pill">${escapeHtml(order.status)}</span>
        </article>
      `,
    )
    .join("");
}

function renderChannels() {
  if (!can("inbox") && state.currentUser?.role === "entregador") {
    byId("channels").innerHTML = `
      <article class="channel-card">
        <strong>Modo entregador</strong>
        <p>Este perfil prioriza entregas e localização em tempo real.</p>
      </article>
    `;
    return;
  }

  const data = [
    ["WhatsApp", "58 conversas", "Pedidos, dúvidas e pós-venda automatizados"],
    ["Instagram", "21 conversas", "Captação por DM e envio de cardápio"],
    ["Facebook", "12 conversas", "Respostas rápidas e recuperação de clientes"],
  ];

  byId("channels").innerHTML = data
    .map(
      ([name, total, description]) => `
        <article class="channel-card">
          <strong>${name}</strong>
          <p>${total} · ${description}</p>
        </article>
      `,
    )
    .join("");
}

function renderKitchen() {
  const columns = ["Novo", "Cozinha", "Entrega"];
  byId("kitchen-board").innerHTML = columns
    .map((status) => {
      const tickets = orders.filter((order) => order.status === status);
      return `
        <div class="kitchen-column">
          <strong>${status}</strong>
          ${tickets
            .map(
            (order) => `
                <div class="kitchen-ticket">
                  ${renderPhoto(getItemImage(order.item), "ticket-photo", order.item)}
                  <strong>#${order.id}</strong>
                  <p>${order.item}</p>
                  <small>${order.notes || "Sem observações"}</small><br>
                  <small>${order.eta} · ${orderAge(order)} min</small>
                  ${orderAge(order) > 30 && order.status !== "Entrega" ? '<span class="status-pill danger">Atrasado</span>' : ""}
                  <div class="ticket-actions">
                    <button class="secondary" data-advance="${order.id}" ${!canAdvanceOrder(order) ? "disabled" : ""}>${order.status === "Entrega" ? "Finalizar" : "Avançar"}</button>
                    <button class="ghost" data-whatsapp="${order.id}">WhatsApp</button>
                  </div>
                </div>
              `,
            )
            .join("")}
        </div>
      `;
    })
    .join("");
  document.querySelectorAll("#kitchen-board [data-advance]").forEach((button) => {
    button.addEventListener("click", () => advanceOrder(Number(button.dataset.advance)));
  });
  document.querySelectorAll("#kitchen-board [data-whatsapp]").forEach((button) => {
    button.addEventListener("click", () => copyWhatsAppMessage(Number(button.dataset.whatsapp)));
  });
}

function orderAge(order) {
  const created = new Date(order.created_at || Date.now());
  if (Number.isNaN(created.getTime())) return 0;
  return Math.max(Math.round((Date.now() - created.getTime()) / 60000), 0);
}

function renderMenu() {
  renderPizzaSizePrices();
  const categoryFilter = byId("menu-category-filter");
  if (categoryFilter) {
    const categories = ["Todos", ...new Set(menuItems.map((item) => item.category).filter(Boolean))];
    const current = categories.includes(state.menuCategory) ? state.menuCategory : "Todos";
    state.menuCategory = current;
    categoryFilter.innerHTML = categories.map((category) => `<option value="${category}" ${category === current ? "selected" : ""}>${category}</option>`).join("");
  }

  const filteredItems = menuItems.filter((item) => state.menuCategory === "Todos" || item.category === state.menuCategory);
  const showSort = state.menuCategory === "Todos" && can("menu");
  byId("menu-items").innerHTML = filteredItems
    .map(
      (item, index) => `
        <article class="menu-card${showSort ? " draggable-card" : ""}" data-menu-item-id="${item.id}"${showSort ? ' draggable="true"' : ""}>
          ${showSort ? '<div class="drag-handle" title="Arraste para reordenar">⋮⋮</div>' : ""}
          ${renderPhoto(item.image_url, "menu-photo", item.name)}
          <strong>${item.name}<span>${currency.format(item.price)}</span></strong>
          <p>${item.category}${item.size ? ` - ${item.size}` : ""} - ${item.sales} vendas</p>
          ${item.description ? `<p>${item.description}</p>` : ""}
          <p>${item.prep_time ? `Preparo: ${item.prep_time}` : "Preparo nao informado"}${item.addons ? ` - Adicionais: ${item.addons}` : ""}</p>
          ${Number(item.cost) > 0 ? `<p style="color:var(--accent);font-weight:600;">Custo: ${currency.format(item.cost)} · Margem: ${item.margin_percent || 0}%</p>` : ""}
          <div class="menu-card-actions">
            ${showSort ? `<button class="ghost sort-btn" data-sort-up="${item.id}" title="Mover para cima" ${index === 0 ? "disabled" : ""}>↑</button>` : ""}
            ${showSort ? `<button class="ghost sort-btn" data-sort-down="${item.id}" title="Mover para baixo" ${index === filteredItems.length - 1 ? "disabled" : ""}>↓</button>` : ""}
            <button class="ghost" data-edit-product="${item.id}">Editar</button>
            <button class="ghost" data-toggle-product="${item.id}">${item.active ? "Pausar" : "Ativar"}</button>
          </div>
        </article>
      `,
    )
    .join("");

  renderOrderProductOptions();

  byId("promotion-item").innerHTML = menuItems
    .map((item) => `<option value="${item.name}">${item.name}</option>`)
    .join("");

  const recipeItem = byId("recipe-item");
  if (recipeItem) {
    recipeItem.innerHTML = menuItems.map((item) => `<option value="${item.id}">${item.name}</option>`).join("");
  }
  const calcItem = byId("calc-item");
  if (calcItem) {
    calcItem.innerHTML = menuItems.map((item) => `<option value="${item.id}">${item.name}</option>`).join("");
  }

  byId("promotions-list").innerHTML = promotions.length
    ? promotions
        .map(
          (promotion) => `
            <article class="promo-card">
              <strong>${promotion.title}<span>${promotion.active ? "Ativa" : "Pausada"}</span></strong>
              <p>${promotion.item_name} · ${formatDiscount(promotion)}</p>
              <p>${formatDateTime(promotion.starts_at)} até ${formatDateTime(promotion.ends_at)}</p>
              <p>${promotion.channels}</p>
              <button class="ghost" data-edit-promotion="${promotion.id}">Editar</button>
              <button class="ghost" data-toggle-promotion="${promotion.id}">${promotion.active ? "Pausar" : "Ativar"}</button>
            </article>
          `,
        )
        .join("")
    : `
      <article class="promo-card">
        <strong>Nenhuma promoção lançada</strong>
        <p>Crie uma campanha para destacar produtos no cardápio e nos canais.</p>
      </article>
    `;

  document.querySelectorAll("[data-edit-product]").forEach((button) => {
    button.addEventListener("click", () => openProductEditor(Number(button.dataset.editProduct)));
  });
  document.querySelectorAll("[data-toggle-product]").forEach((button) => {
    button.addEventListener("click", () => toggleProduct(Number(button.dataset.toggleProduct)));
  });
  document.querySelectorAll("[data-sort-up]").forEach((button) => {
    button.addEventListener("click", () => moveMenuItem(Number(button.dataset.sortUp), -1));
  });
  document.querySelectorAll("[data-sort-down]").forEach((button) => {
    button.addEventListener("click", () => moveMenuItem(Number(button.dataset.sortDown), 1));
  });
  document.querySelectorAll("[data-edit-promotion]").forEach((button) => {
    button.addEventListener("click", () => openPromotionEditor(Number(button.dataset.editPromotion)));
  });
  document.querySelectorAll("[data-toggle-promotion]").forEach((button) => {
    button.addEventListener("click", () => togglePromotion(Number(button.dataset.togglePromotion)));
  });

  // Drag and drop com SortableJS para reordenar cardapio
  if (showSort && typeof Sortable !== "undefined") {
    setupMenuSortable();
  }

  renderInventory();
}

function renderOrderProductOptions() {
  const categorySelect = byId("order-category");
  const itemSelect = byId("order-item");
  if (!categorySelect || !itemSelect) return;

  const categories = ["Todos", ...new Set(menuItems.map((item) => item.category).filter(Boolean))];
  if (!categories.includes(state.orderCategory)) state.orderCategory = "Todos";
  categorySelect.innerHTML = categories
    .map((category) => `<option value="${category}" ${category === state.orderCategory ? "selected" : ""}>${category}</option>`)
    .join("");

  const filtered = menuItems.filter((item) => state.orderCategory === "Todos" || item.category === state.orderCategory);
  itemSelect.innerHTML = filtered.length
    ? filtered.map((item) => `<option value="${item.name}">${item.name} · ${currency.format(item.price)}</option>`).join("")
    : `<option value="">Nenhum produto nesta categoria</option>`;
}

function formatDiscount(promotion) {
  const value = Number(promotion.discount_value);
  if (promotion.discount_type === "percent") return `${value}% de desconto`;
  if (promotion.discount_type === "fixed") return `${currency.format(value)} de desconto`;
  return `por ${currency.format(value)}`;
}

function formatDateTime(value) {
  if (!value) return "sem data";
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderInventory() {
  const recipeRowsBox = byId("recipe-ingredients-list");
  if (!recipeRowsBox) return;
  if (!can("inventory")) return;

  const lowStock = ingredients.filter((ingredient) => ingredient.low_stock || Number(ingredient.stock_qty) <= Number(ingredient.min_qty));
  const stockValue = ingredients.reduce((total, ingredient) => total + Number(ingredient.stock_qty || 0) * Number(ingredient.unit_cost || 0), 0);
  renderRecipeRows();

  byId("stock-alerts").innerHTML = lowStock.length
    ? `
      <article class="ingredient-card low stock-summary-card">
        <div>
          <small>Alerta de compra</small>
          <strong>${lowStock.length} ingrediente(s) no minimo</strong>
          <p>${lowStock.map((ingredient) => `${ingredient.name}: ${Number(ingredient.stock_qty).toLocaleString("pt-BR")} ${ingredient.unit}`).join(" - ")}</p>
        </div>
        <button class="ghost" id="send-stock-whatsapp">Avisar no WhatsApp</button>
      </article>
    `
    : `
      <article class="ingredient-card success-card stock-summary-card">
        <div>
          <small>Status do estoque</small>
          <strong>Estoque confortavel</strong>
          <p>${ingredients.length ? `${ingredients.length} ingrediente(s) cadastrados. Valor estimado: ${currency.format(stockValue)}.` : "Cadastre os ingredientes para liberar a calculadora."}</p>
        </div>
      </article>
    `;

  byId("ingredients-list").innerHTML = ingredients.length
    ? ingredients
        .map(
          (ingredient) => `
            <article class="ingredient-card inventory-row ${ingredient.low_stock || Number(ingredient.stock_qty) <= Number(ingredient.min_qty) ? "low" : ""}">
              <div class="ingredient-main">
                <small>${ingredient.code || "Sem código"}</small>
                <strong>${ingredient.name}</strong>
                <p>${ingredient.supplier || "Sem fornecedor"}</p>
              </div>
              <div>
                <small>Atual</small>
                <strong>${Number(ingredient.stock_qty).toLocaleString("pt-BR")} ${ingredient.unit}</strong>
              </div>
              <div>
                <small>Minimo</small>
                <strong>${Number(ingredient.min_qty).toLocaleString("pt-BR")} ${ingredient.unit}</strong>
              </div>
              <div>
                <small>Custo unitario</small>
                <strong>${currency.format(ingredient.unit_cost || 0)}</strong>
              </div>
              <div class="inline-actions">
                <label>Novo saldo
                  <input type="number" step="0.01" value="${ingredient.stock_qty}" data-stock-input="${ingredient.id}" />
                </label>
                <button class="ghost" data-update-stock="${ingredient.id}">Salvar</button>
                <button class="ghost" onclick="openIngredientEditor(${ingredient.id})">✏️ Editar</button>
              </div>
            </article>
          `,
        )
        .join("")
    : `<article class="ingredient-card empty-card"><strong>Nenhum ingrediente cadastrado</strong><p>Use o formulario acima para criar o primeiro item de estoque.</p></article>`;

  // Agrupa fichas técnicas por pizza
  const recipesByItem = recipes.reduce((acc, recipe) => {
    if (!acc[recipe.item_name]) acc[recipe.item_name] = [];
    acc[recipe.item_name].push(recipe);
    return acc;
  }, {});

  byId("recipes-list").innerHTML = recipes.length
    ? Object.entries(recipesByItem).map(([itemName, itemRecipes]) => `
        <article class="ingredient-card recipe-group">
          <div class="recipe-group-header">
            <strong>${itemName}</strong>
            <span class="recipe-count">${itemRecipes.length} ingrediente(s)</span>
          </div>
          <ul class="recipe-group-list">
            ${itemRecipes.map((r) => `
              <li>
                <span class="recipe-ing-name">${r.ingredient_name}</span>
                <span class="recipe-ing-qty">${Number(r.quantity).toLocaleString("pt-BR")} ${r.unit}</span>
              </li>
            `).join("")}
          </ul>
        </article>
      `).join("")
    : `<article class="ingredient-card empty-card"><strong>Nenhuma ficha tecnica cadastrada</strong><p>Cadastre quanto cada produto consome no bloco "Receita do produto".</p></article>`;

  const movementsBox = byId("stock-movements-list");
  if (movementsBox) {
    movementsBox.innerHTML = stockMovements.length
      ? stockMovements
          .map(
            (movement) => `
              <article class="ingredient-card movement-row">
                <strong>${movement.ingredient_name}<span>${movement.movement_type}</span></strong>
                <p>${Number(movement.quantity).toLocaleString("pt-BR")} ${movement.unit} - ${movement.reason} ${movement.order_id ? `#${movement.order_id}` : ""}</p>
              </article>
            `,
          )
          .join("")
      : `<article class="ingredient-card empty-card"><strong>Sem movimentacoes</strong><p>Entradas, ajustes e baixas aparecem aqui.</p></article>`;
  }

  document.querySelectorAll("[data-update-stock]").forEach((button) => {
    button.addEventListener("click", () => updateStock(Number(button.dataset.updateStock)));
  });
  byId("send-stock-whatsapp")?.addEventListener("click", sendStockWhatsApp);
  renderIngredientCalculator();
}

function renderOrderInsights() {
  const box = byId("order-insights");
  if (!box) return;
  const open = orders.filter((order) => !["Finalizado", "Cancelado"].includes(order.status));
  const late = open.filter((order) => orderAge(order) > 30 && order.status !== "Entrega");
  const pixPending = orders.filter((order) => order.payment === "PIX" && !["Pago", "Comprovante aprovado"].includes(order.payment_status || ""));
  const delivery = orders.filter((order) => order.status === "Entrega");
  const cards = [
    ["Abertos", open.length, "Pedidos que ainda precisam de acao"],
    ["Atrasados", late.length, late.length ? "Priorizar cozinha/entrega" : "Fila dentro do tempo"],
    ["PIX pendente", pixPending.length, "Conferir comprovantes"],
    ["Em entrega", delivery.length, "Pedidos na rua"],
  ];
  box.innerHTML = cards
    .map(
      ([label, value, hint]) => `
        <article class="metric-card ${label === "Atrasados" && value ? "danger-card" : ""}">
          <small>${label}</small>
          <strong>${value}</strong>
          <span>${hint}</span>
        </article>
      `,
    )
    .join("");
}

function ingredientOptions(selectedId = "") {
  return ingredients
    .map((ingredient) => `<option value="${ingredient.id}" ${Number(selectedId) === Number(ingredient.id) ? "selected" : ""}>${ingredient.name} (${ingredient.unit})</option>`)
    .join("");
}

function recipeRowTemplate(row = {}, index = 0) {
  return `
    <div class="recipe-line" data-recipe-line>
      <label>Ingrediente
        <select data-recipe-ingredient>${ingredientOptions(row.ingredient_id)}</select>
      </label>
      <label>Quantidade por unidade
        <input data-recipe-qty type="number" min="0.01" step="0.01" value="${row.quantity || ""}" placeholder="Ex: 0,25" />
      </label>
      <button class="ghost icon-action" type="button" data-remove-recipe-row="${index}" title="Remover ingrediente">x</button>
    </div>
  `;
}

function renderRecipeRows(forceSaved = false) {
  const box = byId("recipe-ingredients-list");
  const itemId = Number(byId("recipe-item")?.value || menuItems[0]?.id);
  if (!box || !itemId) return;
  if (!forceSaved && box.dataset.itemId === String(itemId) && box.children.length) return;

  const savedRows = recipes.filter((recipe) => Number(recipe.menu_item_id) === itemId);
  const rows = savedRows.length ? savedRows : [{}];
  box.dataset.itemId = String(itemId);
  box.innerHTML = rows.map((row, index) => recipeRowTemplate(row, index)).join("");
  bindRecipeRowButtons();
}

function bindRecipeRowButtons() {
  document.querySelectorAll("[data-remove-recipe-row]").forEach((button) => {
    button.addEventListener("click", () => {
      const box = byId("recipe-ingredients-list");
      if (!box) return;
      const line = button.closest("[data-recipe-line]");
      if (box.children.length > 1) {
        line?.remove();
      } else if (line) {
        line.querySelector("[data-recipe-ingredient]").value = ingredients[0]?.id || "";
        line.querySelector("[data-recipe-qty]").value = "";
      }
    });
  });
}

function addRecipeRow() {
  const box = byId("recipe-ingredients-list");
  if (!box) return;
  box.insertAdjacentHTML("beforeend", recipeRowTemplate({}, box.children.length));
  bindRecipeRowButtons();
}

function renderIngredientCalculator() {
  const result = byId("calc-result");
  if (!result) return;
  const itemId = Number(byId("calc-item").value || menuItems[0]?.id);
  const qty = Math.max(Number(byId("calc-qty").value || 1), 1);
  const itemRecipes = recipes.filter((recipe) => Number(recipe.menu_item_id) === itemId);
  const totalCost = itemRecipes.reduce((sum, recipe) => {
    const ingredient = ingredients.find((current) => Number(current.id) === Number(recipe.ingredient_id));
    return sum + Number(recipe.quantity || 0) * qty * Number(ingredient?.unit_cost || 0);
  }, 0);
  result.innerHTML = itemRecipes.length
    ? `
      ${(() => {
        const item = menuItems.find((i) => Number(i.id) === itemId);
        const price = Number(item?.price || 0);
        const profit = price * qty - totalCost;
        const margin = price > 0 ? ((price - totalCost / qty) / price * 100).toFixed(1) : 0;
        return `
        <article class="ingredient-card stock-summary-card">
          <div>
            <small>Custo estimado da producao</small>
            <strong>${currency.format(totalCost)}</strong>
            <p>${qty} unidade(s) · Venda: ${currency.format(price * qty)} · Lucro: ${currency.format(profit)} · Margem: ${margin}%</p>
          </div>
        </article>`;
      })()}
      ${itemRecipes
        .map((recipe) => {
          const required = Number(recipe.quantity * qty);
          const ingredient = ingredients.find((current) => Number(current.id) === Number(recipe.ingredient_id));
          const stock = Number(ingredient?.stock_qty || 0);
          const missing = Math.max(required - stock, 0);
          return `<article class="ingredient-card calc-row ${missing ? "low" : ""}"><div><small>Ingrediente necessario</small><strong>${recipe.ingredient_name}</strong><p>${qty} unidade(s) de ${recipe.item_name}${missing ? ` - falta ${missing.toLocaleString("pt-BR")} ${recipe.unit}` : ` - estoque OK`}</p></div><strong>${required.toLocaleString("pt-BR")} ${recipe.unit}</strong></article>`;
        })
        .join("")}
    `
    : `<article class="ingredient-card empty-card"><strong>Sem ficha tecnica</strong><p>Cadastre a receita desse produto antes do calculo.</p></article>`;
}

function renderInbox() {
  // A view de inbox foi simplificada — agora so mostra QR code do WhatsApp
  // Os elementos de chat foram removidos do HTML para evitar erros
  renderInboxQrPanel();
}

let _deliveryMap = null;
let _deliveryMapMarkers = [];

function renderDelivery() {
  // Lista de entregadores
  const driversBox = byId("drivers");
  if (driversBox) {
    driversBox.innerHTML = drivers.map(d => `
      <article class="driver-card">
        <strong>${d.name}</strong>
        <p>${d.status} · ${d.orders || 0} pedido(s) · ${d.area}</p>
      </article>
    `).join("");
  }

  // Lista de entregas ativas
  const deliveriesBox = byId("active-deliveries");
  if (deliveriesBox) {
    deliveriesBox.innerHTML = deliveries.length ? deliveries.map(d => `
      <article class="driver-card">
        <strong>#${d.id} · ${d.customer}</strong>
        <p>${d.item} · ${d.driver_name || "Sem entregador"}</p>
        <p class="location-line">${formatLocation(d)}</p>
      </article>
    `).join("") : `
      <article class="driver-card">
        <strong>Nenhuma entrega ativa</strong>
        <p>Quando um pedido entrar em Entrega, a localização aparece aqui.</p>
      </article>
    `;
  }

  // MAPA LEAFLET
  const mapContainer = byId("delivery-map");
  if (!mapContainer || typeof L === "undefined") {
    console.log("[renderDelivery] mapContainer ou L não disponível");
    return;
  }

  const defaultLat = -27.1009;
  const defaultLng = -52.6157;

  // Sempre recriar o mapa para garantir que renderize correto
  if (_deliveryMap) {
    _deliveryMap.remove();
    _deliveryMap = null;
    _deliveryMapMarkers = [];
  }

  _deliveryMap = L.map(mapContainer).setView([defaultLat, defaultLng], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(_deliveryMap);

  const bounds = [];
  const activeDrivers = drivers.filter(d => d.active);
  console.log("[renderDelivery] drivers total:", drivers.length, "ativos:", activeDrivers.length, "deliveries:", deliveries.length);

  activeDrivers.forEach(driver => {
    const lat = Number(driver.lat);
    const lng = Number(driver.lng);
    if (!Number.isNaN(lat) && !Number.isNaN(lng) && lat !== 0 && lng !== 0) {
      const inRoute = deliveries.some(d => d.driver_name === driver.name);
      L.circle([lat, lng], { color: inRoute ? "#ff6b00" : "#2196f3", fillColor: inRoute ? "#ff6b00" : "#2196f3", fillOpacity: 0.2, radius: 150 }).addTo(_deliveryMap);
      const marker = L.marker([lat, lng]).addTo(_deliveryMap);
      marker.bindPopup(`<strong>🛵 ${escapeHtml(driver.name)}</strong><br>${inRoute ? "🔥 Em rota" : "📍 Disponível"}<br><small>${lat.toFixed(5)}, ${lng.toFixed(5)}</small>`).openPopup();
      bounds.push([lat, lng]);
      console.log("[renderDelivery] marcador adicionado:", driver.name, lat, lng);
    } else {
      console.log("[renderDelivery] sem coordenadas:", driver.name, "lat:", driver.lat, "lng:", driver.lng);
    }
  });

  if (bounds.length === 0) {
    L.marker([defaultLat, defaultLng]).addTo(_deliveryMap)
      .bindPopup("<strong>Centro de Chapecó</strong><br>Nenhum entregador com GPS ativo").openPopup();
    bounds.push([defaultLat, defaultLng]);
  }

  if (bounds.length > 0) {
    _deliveryMap.fitBounds(bounds, { padding: [60, 60] });
  }
}

function renderDeliveryManager() {
  const driversBox = byId("drivers");
  const deliveriesBox = byId("active-deliveries");
  const driverForm = document.querySelector(".driver-form");
  if (driverForm) driverForm.classList.toggle("hidden", !can("drivers"));
  if (!driversBox || !deliveriesBox) return;

  driversBox.innerHTML = drivers
    .map(
      (driver) => `
        <article class="driver-card">
          <strong>${driver.name}</strong>
          <p>${driver.status || "Disponivel"} - ${driver.orders || 0} pedido(s) - ${driver.area}</p>
          ${can("drivers") ? `<button class="ghost" data-toggle-driver="${driver.id}">${driver.active ? "Pausar" : "Ativar"}</button>` : ""}
        </article>
      `,
    )
    .join("");

  deliveriesBox.innerHTML = deliveries.length
    ? deliveries
        .map(
          (delivery) => `
            <article class="driver-card">
              <strong>#${delivery.id} - ${delivery.customer}</strong>
              <p>${delivery.item} - ${delivery.driver_name || "Sem entregador"}</p>
              <p class="location-line">${formatLocation(delivery)}</p>
              <select data-assign-driver="${delivery.id}" ${!can("drivers") ? "disabled" : ""}>
                <option value="">Escolher entregador</option>
                ${drivers
                  .filter((driver) => driver.active)
                  .map((driver) => `<option value="${driver.id}" ${driver.name === delivery.driver_name ? "selected" : ""}>${driver.name}</option>`)
                  .join("")}
              </select>
            </article>
          `,
        )
        .join("")
    : `<article class="driver-card"><strong>Nenhuma entrega ativa</strong><p>Quando um pedido entrar em Entrega, a localizacao aparece aqui.</p></article>`;

  document.querySelectorAll("[data-assign-driver]").forEach((select) => {
    select.addEventListener("change", () => assignDriver(Number(select.dataset.assignDriver), Number(select.value)));
  });
  document.querySelectorAll("[data-toggle-driver]").forEach((button) => {
    button.addEventListener("click", () => toggleDriver(Number(button.dataset.toggleDriver)));
  });
}

function mapPoint(lat, lng, index) {
  if (Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) {
    return { left: 20 + index * 12, top: 24 + index * 12 };
  }
  const left = 12 + (Math.abs((Number(lng) + 46.67) * 1800) % 68);
  const top = 14 + (Math.abs((Number(lat) + 23.58) * 1800) % 58);
  return { left: Math.round(left), top: Math.round(top) };
}

function destinationPoint(index) {
  return {
    left: 66 - index * 9,
    top: 62 - index * 8,
  };
}

function formatLocation(delivery) {
  const lat = Number(delivery.driver_lat).toFixed(4);
  const lng = Number(delivery.driver_lng).toFixed(4);
  const updatedAt = delivery.last_location_at
    ? new Date(delivery.last_location_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "sem horário";
  return `Localização: ${lat}, ${lng} · atualizado às ${updatedAt}`;
}

function simulateDriverMovement() {
  if (!deliveries.length) return;
  deliveries = deliveries.map((delivery, index) => {
    let lat = Number(delivery.driver_lat) + 0.00025 + index * 0.00004;
    let lng = Number(delivery.driver_lng) + 0.00018 + index * 0.00003;
    if (lat > -23.55) lat = -23.56;
    if (lat < -23.57) lat = -23.56;
    if (lng > -46.64) lng = -46.65;
    if (lng < -46.66) lng = -46.65;
    return {
      ...delivery,
      driver_lat: lat,
      driver_lng: lng,
      last_location_at: new Date().toISOString(),
    };
  });
  // Atualiza também os drivers em rota para o mapa geral
  drivers = drivers.map((driver) => {
    const inDelivery = deliveries.find((d) => d.driver_name === driver.name);
    if (inDelivery) {
      return { ...driver, lat: inDelivery.driver_lat, lng: inDelivery.driver_lng };
    }
    return driver;
  });
  renderDelivery();
  renderDeliveryManager();
}

function renderPayments() {
  if (!can("payments")) return;

  const periodLabel = state.financeFilter === "day" ? "Hoje" : state.financeFilter === "week" ? "Semana" : "Mês";
  const validOrders = orders.filter((order) => order.status !== "Cancelado");
  const paid = validOrders.reduce((sum, order) => sum + Number(order.total), 0);
  const pix = validOrders.filter((order) => order.payment === "PIX").length;
  const card = validOrders.filter((order) => order.payment === "Cartão").length;
  const cash = validOrders.filter((order) => order.payment === "Dinheiro").length;
  const pending = validOrders.filter((order) => !["Pago", "A pagar na entrega", "Comprovante aprovado"].includes(order.payment_status || "")).length;
  const data = [
    [`Recebido · ${periodLabel}`, currency.format(paid), "Conciliação automática"],
    ["PIX", pix, "Pagamentos instantâneos"],
    ["Cartão", card, "Crédito e débito"],
    ["Dinheiro", cash, "Receber na entrega/balcão"],
    ["Pendentes", pending, pending ? "Conferir antes do fechamento" : "Sem pendência"],
  ];

  byId("payment-metrics").innerHTML = data
    .map(
      ([label, value, hint]) => `
        <article class="metric-card">
          <small>${label}</small>
          <strong>${value}</strong>
          <span>${hint}</span>
        </article>
      `,
    )
    .join("");

  const closeoutBox = byId("closeout-summary");
  if (closeoutBox) {
    const paymentRows = (closeout?.payments || []).map((row) => `${row.payment || "Nao informado"}: ${currency.format(row.total)} (${row.count})`);
    const statusRows = (closeout?.statuses || []).map((row) => `${row.status}: ${row.count}`);
    closeoutBox.innerHTML = `
      <article class="transaction-card">
        <strong>Fechamento de caixa</strong>
        <p>Total valido: ${currency.format(closeout?.total || paid)} - Cancelados: ${closeout?.canceled || 0}</p>
        <p>${paymentRows.join(" - ") || "Sem pagamentos no periodo"}</p>
        <p>${statusRows.join(" - ") || "Sem pedidos"}</p>
      </article>
    `;
  }

  byId("transactions").innerHTML = orders
    .map(
      (order) => `
        <article class="transaction-card">
          <strong>#${order.id} · ${currency.format(order.total)}</strong>
          <p>${order.payment} · ${order.customer} · ${order.status === "Cancelado" ? "cancelado" : order.payment_status || "aguardando"}</p>
          ${order.payment_receipt_status ? `<p>Comprovante: ${order.payment_receipt_status}</p>` : ""}
        </article>
      `,
    )
    .join("");
}

function renderReports() {
  if (!can("reports")) return;

  const total = orders.length || 1;
  const channelAliases = [
    ["WhatsApp", "WhatsApp"],
    ["Instagram", "Instagram"],
    ["Facebook", "Facebook"],
    ["Balcao", "Balcao"],
    ["Balcão", "Balcao"],
    ["Cardapio QR", "Cardapio QR"],
    ["Cardápio QR", "Cardapio QR"],
  ];
  const channelTotals = channelAliases.reduce((acc, [raw, label]) => {
    acc[label] = (acc[label] || 0) + orders.filter((order) => order.channel === raw).length;
    return acc;
  }, {});
  const channels = Object.entries(channelTotals).map(([label, count]) => [label, Math.round((count / total) * 100)]);

  byId("sales-chart").innerHTML = channels
    .filter(([, value], index, all) => value || index < 4)
    .slice(0, 5)
    .map(
      ([label, value]) => `
        <div class="bar-row">
          <strong>${label}</strong>
          <div class="bar-track"><div class="bar-fill" style="width:${value}%"></div></div>
          <span>${value}%</span>
        </div>
      `,
    )
    .join("");

  byId("best-sellers").innerHTML = [...menuItems]
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 5)
    .map(
      (item, index) => `
        <article class="best-item">
          <strong>${index + 1}. ${item.name}</strong>
          <span>${item.sales} vendas - ${item.active ? "ativo" : "pausado"}</span>
        </article>
      `,
    )
    .join("");

  const profitBox = byId("profit-list");
  if (profitBox) {
    profitBox.innerHTML = profitReport.length
      ? profitReport
          .map(
            (row) => `
              <article class="best-item">
                <strong>${row.item_name}</strong>
                <span>${currency.format(row.profit || 0)} lucro · ${row.margin_percent || 0}% margem · custo ${currency.format(row.cost || 0)} · receita ${currency.format(row.revenue || 0)}</span>
              </article>
            `,
          )
          .join("")
      : `<article class="best-item"><strong>Sem dados de lucro</strong><span>Cadastre custos na ficha tecnica.</span></article>`;
  }

  const validOrders = orders.filter((order) => order.status !== "Cancelado");
  const paymentTotals = validOrders.reduce((acc, order) => {
    const payment = order.payment || "Nao informado";
    acc[payment] = acc[payment] || { count: 0, total: 0 };
    acc[payment].count += 1;
    acc[payment].total += Number(order.total || 0);
    return acc;
  }, {});
  const paymentReport = byId("payment-report-list");
  if (paymentReport) {
    paymentReport.innerHTML = Object.entries(paymentTotals).length
      ? Object.entries(paymentTotals)
          .map(
            ([payment, data]) => `
              <article class="best-item">
                <strong>${payment}</strong>
                <span>${currency.format(data.total)} em ${data.count} pedido(s)</span>
              </article>
            `,
          )
          .join("")
      : `<article class="best-item"><strong>Sem pagamentos</strong><span>Nenhum pedido valido.</span></article>`;
  }

  const operationBox = byId("operation-report-list");
  if (operationBox) {
    const open = orders.filter((order) => !["Finalizado", "Cancelado"].includes(order.status)).length;
    const canceled = orders.filter((order) => order.status === "Cancelado").length;
    const averageTicket = validOrders.length ? validOrders.reduce((sum, order) => sum + Number(order.total || 0), 0) / validOrders.length : 0;
    const lowStock = ingredients.filter((ingredient) => ingredient.low_stock || Number(ingredient.stock_qty) <= Number(ingredient.min_qty)).length;
    operationBox.innerHTML = [
      ["Pedidos em aberto", open],
      ["Cancelados", canceled],
      ["Ticket medio", currency.format(averageTicket)],
      ["Ingredientes no minimo", lowStock],
    ]
      .map(([label, value]) => `<article class="best-item"><strong>${label}</strong><span>${value}</span></article>`)
      .join("");
  }
}

function renderCustomerStore() {
  console.log("[renderCustomerStore] menuItems:", menuItems.length, "apiOnline:", state.apiOnline);
  byId("store-hours").textContent = `${settings.opening_hours || "18:00 às 23:30"} · entrega ${currency.format(Number(settings.delivery_fee || 0))} · preparo ${settings.prep_time || "35 a 45 minutos"}`;
  renderQrPanel();

  // Pizzas — lista de tamanhos clicáveis (estilo vídeo)
  const pizzaSizesList = byId("store-pizza-sizes-list");
  if (pizzaSizesList) {
    pizzaSizesList.innerHTML = PIZZA_SIZES.map((size) => `
      <article class="pizza-size-store-card" onclick="openPizzaSizeSelector('${size.key}')">
        <div class="size-text">
          <strong>${size.label}: ${size.cm} (${size.flavors} ${size.flavors === 1 ? "sabor" : "sabores"})</strong>
          <span>${size.slices}</span>
          <span class="size-price-store">${currency.format(size.price)}</span>
        </div>
        <img class="size-photo" src="assets/logo.png" alt="${size.label}" />
      </article>
    `).join("");
  }

  // Bebidas (cards estilo iFood)
  const bebidas = menuItems.filter((item) => item.active && item.category === "Bebidas");
  console.log("[renderCustomerStore] bebidas filtradas:", bebidas.length, "de", menuItems.length, "itens");
  byId("store-bebidas").innerHTML = bebidas.length
    ? bebidas.map((item) => `
        <article class="menu-card-ifood">
          <div class="ifood-info">
            <strong>${escapeHtml(item.name)}</strong>
            <p>${escapeHtml(item.description) || "Bebida"}</p>
            <span class="ifood-price">${currency.format(item.price)}</span>
          </div>
          <button class="add-btn-round" id="add-btn-${item.id}" onclick="addBebidaToCartAnimated(${item.id})">+</button>
        </article>
      `).join("")
    : `<p class="form-hint">Nenhuma bebida disponível no momento.</p>`;

  // Promoções
  const activePromos = promotions.filter((p) => p.active);
  byId("store-promocoes").innerHTML = activePromos.length
    ? activePromos.map((promo) => `
        <article class="menu-card">
          <strong>${escapeHtml(promo.title)}<span>${formatDiscount(promo)}</span></strong>
          <p>${escapeHtml(promo.item_name)}</p>
          <small>Válido de ${escapeHtml(promo.starts_at)} até ${escapeHtml(promo.ends_at)}</small>
        </article>
      `).join("")
    : `<p class="form-hint">Nenhuma promoção ativa no momento.</p>`;

  renderCart();
}

// Estado do dialog de sabores
let pizzaFlavorsDialogState = {
  sizeKey: "",
  flavors: [],
  maxFlavors: 0,
  basePrice: 0,
};

function openPizzaSizeSelector(sizeKey) {
  const size = PIZZA_SIZES.find((s) => s.key === sizeKey);
  if (!size) return;

  pizzaFlavorsDialogState = {
    sizeKey,
    flavors: [],
    maxFlavors: size.flavors,
    basePrice: size.price,
  };

  byId("pizza-flavors-dialog-title").textContent = `${size.label}: ${size.cm}`;
  byId("pizza-flavors-dialog-hint").textContent = `Selecione até ${size.flavors} ${size.flavors === 1 ? "sabor" : "sabores"}`;
  byId("pizza-flavors-dialog-crust").value = "";
  byId("pizza-flavors-dialog-notes").value = "";
  byId("pizza-flavors-dialog-error").textContent = "";

  renderPizzaFlavorsDialog();
  updatePizzaFlavorsDialogPrice();
  byId("pizza-flavors-dialog").showModal();
}

function renderPizzaFlavorsDialog() {
  const pizzaItems = menuItems.filter((item) => item.active && ["Pizzas", "Pizza", "Pizza Doce"].includes(item.category));
  const container = byId("pizza-flavors-dialog-list");
  if (!container) return;

  if (!pizzaItems.length) {
    container.innerHTML = `<p class="form-hint" style="text-align:center;padding:24px 0;">🍕 Nenhum sabor cadastrado no cardápio.<br><small>Entre no admin e sincronize o cardápio em Configurações.</small></p>`;
    return;
  }

  container.innerHTML = pizzaItems.map((item) => {
    const isSelected = pizzaFlavorsDialogState.flavors.some((f) => f.id === item.id);
    return `
      <article class="menu-card flavor-dialog-card ${isSelected ? "selected" : ""}" onclick="togglePizzaFlavorDialog(${item.id})">
        <div class="flavor-check">✓</div>
        ${renderPhoto(item.image_url, "menu-photo", item.name)}
        <strong>${item.name}</strong>
        <p class="ingredients-desc">${item.description || ""}</p>
      </article>
    `;
  }).join("");
}

function togglePizzaFlavorDialog(flavorId) {
  const item = menuItems.find((m) => m.id === flavorId);
  if (!item) return;

  const idx = pizzaFlavorsDialogState.flavors.findIndex((f) => f.id === flavorId);
  if (idx >= 0) {
    // Deselecionar
    pizzaFlavorsDialogState.flavors.splice(idx, 1);
  } else {
    // Selecionar (respeitar limite)
    if (pizzaFlavorsDialogState.flavors.length < pizzaFlavorsDialogState.maxFlavors) {
      pizzaFlavorsDialogState.flavors.push({ id: item.id, name: item.name });
    } else {
      showToast(`Máximo de ${pizzaFlavorsDialogState.maxFlavors} ${pizzaFlavorsDialogState.maxFlavors === 1 ? "sabor" : "sabores"} para este tamanho`);
      return;
    }
  }
  renderPizzaFlavorsDialog();
}

function updatePizzaFlavorsDialogPrice() {
  const crust = byId("pizza-flavors-dialog-crust")?.value || "";
  const crustPrice = CRUST_PRICES[crust] || 0;
  const price = pizzaFlavorsDialogState.basePrice + crustPrice;
  byId("pizza-flavors-dialog-price").textContent = currency.format(price);
}

function addPizzaFromFlavorsDialog() {
  const size = PIZZA_SIZES.find((s) => s.key === pizzaFlavorsDialogState.sizeKey);
  if (!size) return;

  if (pizzaFlavorsDialogState.flavors.length === 0) {
    byId("pizza-flavors-dialog-error").textContent = "Selecione pelo menos 1 sabor.";
    return;
  }

  const crust = byId("pizza-flavors-dialog-crust")?.value || "";
  const notes = byId("pizza-flavors-dialog-notes")?.value.trim() || "";
  const crustPrice = CRUST_PRICES[crust] || 0;
  const price = size.price + crustPrice;

  const existing = cart.find((entry) => {
    if (entry.type !== "pizza" || entry.sizeKey !== size.key) return false;
    if (entry.crust !== crust) return false;
    if (entry.notes !== notes) return false;
    if (entry.flavors.length !== pizzaFlavorsDialogState.flavors.length) return false;
    return entry.flavors.every((f, i) => f.id === pizzaFlavorsDialogState.flavors[i].id);
  });

  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({
      type: "pizza",
      sizeKey: size.key,
      sizeLabel: size.label,
      flavors: [...pizzaFlavorsDialogState.flavors],
      crust,
      notes,
      price,
      qty: 1,
    });
  }

  saveCart();
  renderCart();
  hidePixConfirmation();
  byId("pizza-flavors-dialog").close();
  showToast("Pizza adicionada ao carrinho!");
}

let pizzaBuilderState = {
  sizeKey: "",
  flavors: [],
  maxFlavors: 0,
  basePrice: 0,
};

function selectPizzaSize(sizeKey) {
  const size = PIZZA_SIZES.find((s) => s.key === sizeKey);
  if (!size) return;
  // Se já tinha sabores selecionados e o novo tamanho é menor, truncar
  const existingFlavors = pizzaBuilderState.flavors.slice(0, size.flavors);
  pizzaBuilderState = {
    sizeKey,
    flavors: existingFlavors,
    maxFlavors: size.flavors,
    basePrice: size.price,
  };
  byId("pizza-builder-crust").value = "";
  byId("pizza-builder-notes").value = "";
  renderCustomerStore();
  if (existingFlavors.length > 0) {
    byId("pizza-builder-area")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderPizzaFlavorsGrid() {
  // Função mantida para compatibilidade, mas não usada no novo fluxo
}

function renderPizzaBuilderArea() {
  const area = byId("pizza-builder-area");
  const extras = byId("pizza-extras-area");
  const selectedFlavorsBox = byId("pizza-builder-selected-flavors");
  if (!area || !extras || !selectedFlavorsBox) return;

  if (!pizzaBuilderState.sizeKey || pizzaBuilderState.flavors.length === 0) {
    area.classList.add("hidden");
    return;
  }

  area.classList.remove("hidden");
  const size = PIZZA_SIZES.find((s) => s.key === pizzaBuilderState.sizeKey);
  const selectedIds = pizzaBuilderState.flavors.map((f) => f.id);
  const remaining = pizzaBuilderState.maxFlavors - selectedIds.length;

  byId("pizza-builder-headline").textContent = remaining > 0
    ? `Escolha mais ${remaining} ${remaining === 1 ? "sabor" : "sabores"} para ${size.label}`
    : `${size.label} — ${size.cm} (${size.slices})`;
  byId("pizza-builder-hint").textContent = pizzaBuilderState.flavors.map((f) => f.name).join(" + ");

  selectedFlavorsBox.innerHTML = pizzaBuilderState.flavors.map((f) => `
    <span class="status-pill success">${f.name}</span>
  `).join("");

  updatePizzaBuilderPrice(pizzaBuilderState.basePrice);
}

function toggleFlavor(itemId) {
  const idx = pizzaBuilderState.flavors.findIndex((f) => f.id === itemId);
  if (idx >= 0) {
    // Remover sabor
    pizzaBuilderState.flavors.splice(idx, 1);
  } else {
    // Adicionar sabor (se já tem tamanho, respeitar limite; se não tem, permite 1)
    const limit = pizzaBuilderState.sizeKey ? pizzaBuilderState.maxFlavors : 1;
    if (pizzaBuilderState.flavors.length < limit) {
      const item = menuItems.find((m) => m.id === itemId);
      if (item) pizzaBuilderState.flavors.push({ id: item.id, name: item.name });
    } else if (pizzaBuilderState.sizeKey) {
      showToast(`Máximo de ${limit} ${limit === 1 ? "sabor" : "sabores"} para este tamanho`);
    } else {
      showToast("Selecione um tamanho primeiro para adicionar mais sabores");
    }
  }
  renderCustomerStore();
}

function renderCart() {
  const cartHTML = cart.length
    ? cart
        .map((entry, index) => {
          if (entry.type === "pizza") {
            const flavorsText = entry.flavors.map((f) => f.name).join(" + ");
            const crustText = entry.crust ? ` · ${entry.crust}` : "";
            const notesText = entry.notes ? ` <small>(${entry.notes})</small>` : "";
            return `
              <article class="cart-item">
                <div class="cart-item-info">
                  <strong>${entry.qty}x ${entry.sizeLabel}${crustText}</strong>
                  <p>${flavorsText}${notesText}</p>
                </div>
                <div class="cart-item-actions">
                  <span>${currency.format(entry.price * entry.qty)}</span>
                  <button class="ghost danger-link" onclick="removeFromCart(${index})" title="Remover">×</button>
                </div>
              </article>
            `;
          }
          return `
            <article class="cart-item">
              <div class="cart-item-info">
                <strong>${entry.qty}x ${entry.name}</strong>
              </div>
              <div class="cart-item-actions">
                <span>${currency.format(entry.price * entry.qty)}</span>
                <button class="ghost danger-link" onclick="removeFromCart(${index})" title="Remover">×</button>
              </div>
            </article>
          `;
        })
        .join("")
    : `<article class="cart-item"><strong>Carrinho vazio</strong><p>Adicione pizzas e bebidas para finalizar.</p></article>`;
  byId("cart-items") && (byId("cart-items").innerHTML = cartHTML);
  byId("cart-total") && (byId("cart-total").textContent = `Total: ${currency.format(cartTotal())}`);

  // Atualizar botão flutuante
  const floatingBtn = byId("floating-cart-btn");
  const floatingQty = byId("floating-cart-qty");
  const floatingTotal = byId("floating-cart-total");
  if (floatingBtn && floatingQty && floatingTotal) {
    const totalQty = cart.reduce((sum, entry) => sum + entry.qty, 0);
    floatingQty.textContent = totalQty;
    floatingTotal.textContent = currency.format(cartTotal());
    floatingBtn.classList.toggle("hidden", totalQty === 0);
  }
}

function openCartReview() {
  const dialog = byId("cart-review-dialog");
  if (!dialog) return;
  byId("cart-review-items").innerHTML = cart.length
    ? cart
        .map((entry, index) => {
          if (entry.type === "pizza") {
            const crustText = entry.crust ? ` · ${entry.crust}` : "";
            const notesText = entry.notes ? ` · ${entry.notes}` : "";
            return `
              <div class="ifood-item-row">
                <span class="ifood-item-qty">${entry.qty}x</span>
                <div class="ifood-item-info">
                  <strong>${escapeHtml(entry.sizeLabel)}${escapeHtml(crustText)}</strong>
                  <p>${entry.flavors.map((f) => escapeHtml(f.name)).join(" + ")}${escapeHtml(notesText)}</p>
                </div>
                <span class="ifood-item-price">${currency.format(entry.price * entry.qty)}</span>
              </div>
            `;
          }
          return `
            <div class="ifood-item-row">
              <span class="ifood-item-qty">${entry.qty}x</span>
              <div class="ifood-item-info">
                <strong>${escapeHtml(entry.name)}</strong>
              </div>
              <span class="ifood-item-price">${currency.format(entry.price * entry.qty)}</span>
            </div>
          `;
        })
        .join("")
    : `<div class="ifood-item-row"><span class="ifood-item-info"><strong>Carrinho vazio</strong></span></div>`;

  const subtotal = cartTotal();
  byId("review-subtotal").textContent = currency.format(subtotal);
  byId("review-delivery-fee").textContent = "A calcular";
  byId("review-total").textContent = currency.format(subtotal);
  dialog.showModal();
}

function removeFromCart(index) {
  if (index < 0 || index >= cart.length) return;
  cart.splice(index, 1);
  saveCart();
  renderCart();
}

function addBebidaToCart(itemId) {
  const item = menuItems.find((current) => current.id === itemId);
  if (!item) return;
  const existing = cart.find((entry) => entry.type === "bebida" && entry.id === item.id);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ type: "bebida", id: item.id, name: item.name, price: Number(item.price), qty: 1 });
  }
  saveCart();
  renderCart();
  hidePixConfirmation();
}

function addBebidaToCartAnimated(itemId) {
  const btn = byId(`add-btn-${itemId}`);
  if (btn) {
    btn.classList.add("added");
    setTimeout(() => btn.classList.remove("added"), 400);
  }
  addBebidaToCart(itemId);
}

function updatePizzaBuilderPrice(basePrice) {
  const crust = byId("pizza-builder-crust").value;
  const crustPrice = CRUST_PRICES[crust] || 0;
  byId("pizza-builder-price-display").textContent = currency.format(basePrice + crustPrice);
}

function addPizzaToCart() {
  const size = PIZZA_SIZES.find((s) => s.key === pizzaBuilderState.sizeKey);
  if (!size) {
    showToast("Selecione um tamanho de pizza");
    return;
  }

  if (pizzaBuilderState.flavors.length === 0) {
    showToast("Selecione pelo menos 1 sabor");
    return;
  }
  if (pizzaBuilderState.flavors.length > size.flavors) {
    showToast(`Este tamanho permite no máximo ${size.flavors} ${size.flavors === 1 ? "sabor" : "sabores"}`);
    return;
  }

  const crust = byId("pizza-builder-crust").value;
  const notes = byId("pizza-builder-notes").value.trim();
  const crustPrice = CRUST_PRICES[crust] || 0;
  const price = size.price + crustPrice;

  // Verificar se já existe pizza idêntica no carrinho
  const existing = cart.find((entry) => {
    if (entry.type !== "pizza" || entry.sizeKey !== size.key) return false;
    if (entry.crust !== crust) return false;
    if (entry.notes !== notes) return false;
    if (entry.flavors.length !== pizzaBuilderState.flavors.length) return false;
    return entry.flavors.every((f, i) => f.id === pizzaBuilderState.flavors[i].id);
  });

  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({
      type: "pizza",
      sizeKey: size.key,
      sizeLabel: size.label,
      flavors: [...pizzaBuilderState.flavors],
      crust,
      notes,
      price,
      qty: 1,
    });
  }

  // Resetar builder
  pizzaBuilderState = { sizeKey: "", flavors: [], maxFlavors: 0, basePrice: 0 };
  renderCustomerStore();
  saveCart();
  renderCart();
  hidePixConfirmation();
  showToast("Pizza adicionada ao carrinho!");
}

function cancelPizzaBuilder() {
  pizzaBuilderState = { sizeKey: "", flavors: [], maxFlavors: 0, basePrice: 0 };
  renderCustomerStore();
}

let inlineBuilders = {};

function openFlavorSizeSelector(itemId) {
  // Fecha qualquer outro inline aberto
  Object.keys(inlineBuilders).forEach((id) => closeFlavorSizeSelector(Number(id)));

  const item = menuItems.find((m) => m.id === itemId);
  if (!item) return;

  inlineBuilders[itemId] = {
    sizeKey: "",
    flavors: [{ id: item.id, name: item.name }],
    maxFlavors: 0,
    basePrice: 0,
  };

  renderInlineBuilder(itemId);
  byId(`flavor-inline-${itemId}`)?.classList.remove("hidden");
}

function renderInlineBuilder(itemId) {
  const builder = inlineBuilders[itemId];
  const container = byId(`flavor-inline-${itemId}`);
  if (!container || !builder) return;

  const sizeButtons = PIZZA_SIZES.map((size) => `
    <button class="pizza-size-card ${builder.sizeKey === size.key ? "selected" : ""}" onclick="selectInlineSize(${itemId}, '${size.key}')">
      <div class="size-info">
        <strong>${size.cm}</strong>
        <span>${size.slices}</span>
      </div>
      <div class="size-price">${currency.format(size.price)}</div>
    </button>
  `).join("");

  let extraFlavorsHtml = "";
  if (builder.sizeKey && builder.maxFlavors > 1) {
    const remaining = builder.maxFlavors - builder.flavors.length;
    extraFlavorsHtml = `
      <p class="form-hint">Este sabor + escolha mais ${remaining} ${remaining === 1 ? "sabor" : "sabores"}</p>
      <div class="inline-flavors-grid menu-grid">
        ${renderInlineFlavorOptions(itemId)}
      </div>
    `;
  } else if (builder.sizeKey) {
    extraFlavorsHtml = `<p class="form-hint">Sabor único</p>`;
  }

  const crustValue = builder.crust || "";
  const crustSelect = `
    <label>Tipo de borda
      <select id="inline-crust-${itemId}" onchange="updateInlinePrice(${itemId})">
        <option value="" ${crustValue === "" ? "selected" : ""}>Sem borda recheada</option>
        <option value="Borda recheada catupiry" ${crustValue === "Borda recheada catupiry" ? "selected" : ""}>Borda recheada de catupiry (+ R$ 10,00)</option>
        <option value="Borda recheada cheddar" ${crustValue === "Borda recheada cheddar" ? "selected" : ""}>Borda recheada de cheddar (+ R$ 10,00)</option>
        <option value="Borda recheada chocolate" ${crustValue === "Borda recheada chocolate" ? "selected" : ""}>Borda recheada de chocolate (+ R$ 8,00)</option>
        <option value="Borda de cream cheese" ${crustValue === "Borda de cream cheese" ? "selected" : ""}>Borda de cream cheese (+ R$ 8,00)</option>
      </select>
    </label>
  `;

  const crustPrice = CRUST_PRICES[builder.crust || ""] || 0;
  const price = builder.basePrice + crustPrice;

  container.innerHTML = `
    <div class="inline-size-list pizza-size-list">${sizeButtons}</div>
    ${extraFlavorsHtml}
    ${builder.sizeKey ? crustSelect : ""}
    ${builder.sizeKey ? `
      <label>Observações
        <textarea id="inline-notes-${itemId}" placeholder="Ex: sem cebola, bem passada, pouco queijo..."></textarea>
      </label>
      <div class="pizza-builder-price">
        <strong id="inline-price-${itemId}">${currency.format(price)}</strong>
      </div>
      <button class="primary" onclick="addInlinePizzaToCart(${itemId})">Adicionar ao carrinho</button>
      <button class="ghost" onclick="closeFlavorSizeSelector(${itemId})">Cancelar</button>
    ` : ""}
  `;
}

function renderInlineFlavorOptions(mainItemId) {
  const builder = inlineBuilders[mainItemId];
  if (!builder) return "";

  const selectedIds = builder.flavors.map((f) => f.id);
  const remaining = builder.maxFlavors - selectedIds.length;

  const pizzaItems = menuItems.filter((item) => item.active && ["Pizzas", "Pizza", "Pizza Doce"].includes(item.category));

  return pizzaItems.map((item) => {
    const isSelected = selectedIds.includes(item.id);
    const canSelect = !isSelected && remaining > 0;
    return `
      <article class="menu-card flavor-card ${isSelected ? "selected" : ""} ${!isSelected && !canSelect ? "disabled" : ""}" onclick="toggleInlineFlavor(${mainItemId}, ${item.id})">
        ${renderPhoto(item.image_url, "menu-photo", item.name)}
        <strong>${item.name}</strong>
        <p class="ingredients-desc">${item.description || ""}</p>
        ${isSelected ? '<span class="status-pill success">✓ Selecionado</span>' : ""}
      </article>
    `;
  }).join("");
}

function selectInlineSize(itemId, sizeKey) {
  const size = PIZZA_SIZES.find((s) => s.key === sizeKey);
  if (!size) return;

  const builder = inlineBuilders[itemId];
  if (!builder) return;

  const currentCrust = byId(`inline-crust-${itemId}`)?.value || "";
  builder.crust = currentCrust;

  builder.sizeKey = sizeKey;
  builder.maxFlavors = size.flavors;
  builder.basePrice = size.price;
  builder.flavors = builder.flavors.slice(0, size.flavors);

  renderInlineBuilder(itemId);
}

function toggleInlineFlavor(itemId, flavorItemId) {
  const builder = inlineBuilders[itemId];
  if (!builder) return;

  const currentCrust = byId(`inline-crust-${itemId}`)?.value || "";
  builder.crust = currentCrust;

  const idx = builder.flavors.findIndex((f) => f.id === flavorItemId);
  if (idx >= 0) {
    if (idx === 0) {
      showToast("O sabor principal não pode ser removido");
      return;
    }
    builder.flavors.splice(idx, 1);
  } else {
    if (builder.flavors.length < builder.maxFlavors) {
      const item = menuItems.find((m) => m.id === flavorItemId);
      if (item) builder.flavors.push({ id: item.id, name: item.name });
    } else {
      showToast(`Máximo de ${builder.maxFlavors} ${builder.maxFlavors === 1 ? "sabor" : "sabores"} para este tamanho`);
      return;
    }
  }
  renderInlineBuilder(itemId);
}

function updateInlinePrice(itemId) {
  const builder = inlineBuilders[itemId];
  if (!builder) return;
  const crust = byId(`inline-crust-${itemId}`)?.value || "";
  const price = builder.basePrice + (CRUST_PRICES[crust] || 0);
  const priceDisplay = byId(`inline-price-${itemId}`);
  if (priceDisplay) priceDisplay.textContent = currency.format(price);
}

function addInlinePizzaToCart(itemId) {
  const builder = inlineBuilders[itemId];
  if (!builder) return;

  if (!builder.sizeKey) {
    showToast("Selecione um tamanho de pizza");
    return;
  }
  if (builder.flavors.length === 0) {
    showToast("Selecione pelo menos 1 sabor");
    return;
  }

  const size = PIZZA_SIZES.find((s) => s.key === builder.sizeKey);
  const crust = byId(`inline-crust-${itemId}`)?.value || "";
  const notes = byId(`inline-notes-${itemId}`)?.value.trim() || "";
  const crustPrice = CRUST_PRICES[crust] || 0;
  const price = size.price + crustPrice;

  const existing = cart.find((entry) => {
    if (entry.type !== "pizza" || entry.sizeKey !== size.key) return false;
    if (entry.crust !== crust) return false;
    if (entry.notes !== notes) return false;
    if (entry.flavors.length !== builder.flavors.length) return false;
    return entry.flavors.every((f, i) => f.id === builder.flavors[i].id);
  });

  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({
      type: "pizza",
      sizeKey: size.key,
      sizeLabel: size.label,
      flavors: [...builder.flavors],
      crust,
      notes,
      price,
      qty: 1,
    });
  }

  closeFlavorSizeSelector(itemId);
  saveCart();
  renderCart();
  hidePixConfirmation();
  showToast("Pizza adicionada ao carrinho!");
}

function closeFlavorSizeSelector(itemId) {
  delete inlineBuilders[itemId];
  const container = byId(`flavor-inline-${itemId}`);
  if (container) {
    container.classList.add("hidden");
    container.innerHTML = "";
  }
}

function hidePixConfirmation() {
  const pixBox = byId("pix-confirmation");
  if (pixBox && !pixBox.classList.contains("hidden")) {
    pixBox.classList.add("hidden");
    const floatingBtn = byId("floating-cart-btn");
    if (floatingBtn) floatingBtn.classList.remove("hidden");
  }
}

function saveCart() {
  try {
    localStorage.setItem("bortolini_cart", JSON.stringify(cart));
  } catch (_) {}
}

function loadCart() {
  try {
    const saved = JSON.parse(localStorage.getItem("bortolini_cart") || "[]");
    if (Array.isArray(saved)) cart = saved;
  } catch (_) {
    cart = [];
  }
}

function cartTotal() {
  return cart.reduce((sum, entry) => sum + entry.price * entry.qty, 0);
}

function getDeliveryFee(address) {
  return Number(zoneForAddress(address)?.fee || settings.delivery_fee || 0);
}

function zoneForAddress(address) {
  const text = String(address || "").toLowerCase();
  return deliveryZones.find((zone) => zone.active && text.includes(String(zone.neighborhood || "").toLowerCase()));
}

function addInternalOrderItem() {
  const item = menuItems.find((menuItem) => menuItem.name === byId("order-item").value);
  if (!item) return;
  const qty = Math.max(Number(byId("order-qty").value || 1), 1);
  const existing = internalOrderItems.find((entry) => entry.id === item.id);
  const addon = byId("order-addon").value;
  const name = item.name;
  if (existing && !addon) existing.qty += qty;
  else internalOrderItems.push({ id: item.id, name, addon, qty, price: Number(item.price) + addonPrice(addon) });
  renderInternalOrderItems();
}

function renderInternalOrderItems() {
  const box = byId("order-items-preview");
  if (!box) return;
  box.innerHTML = internalOrderItems.length
    ? internalOrderItems.map((entry) => `<article class="cart-item"><strong>${entry.qty}x ${entry.name}${entry.addon ? ` (${entry.addon})` : ""}</strong><p>${currency.format(entry.qty * entry.price)}</p></article>`).join("")
    : `<article class="cart-item"><strong>Nenhum item adicionado</strong><p>Se não adicionar, o produto selecionado entra como 1 unidade.</p></article>`;
}

function updateOrderDeliveryMode() {
  const type = byId("order-delivery-type")?.value || "Entrega";
  const address = byId("order-address");
  const fee = byId("order-delivery-fee");
  if (!address || !fee) return;
  address.placeholder = type === "Retirada" ? "Retirada no balcão" : "Rua, número, bairro";
  fee.disabled = type === "Retirada";
  if (type === "Retirada") fee.value = "";
}

function renderCustomers() {
  const filtered = filteredCustomers();
  byId("customers-list").innerHTML = filtered.length
    ? filtered
        .map((customer) => {
          const orderCount = Number(customer.order_count || 0);
          const eligible = orderCount >= Number(state.customerMinOrders || 0) && Number(state.customerMinOrders || 0) > 0;
          return `
            <article class="customer-card ${eligible ? "eligible" : ""}">
              <strong>${customer.name} ${eligible ? '<span class="status-pill success">Promoção liberada</span>' : ""}</strong>
              <p>${customer.phone || "Sem telefone"} · ${customer.address || "Sem endereço"}</p>
              <p>${customer.notes || "Sem preferências registradas"}</p>
              <p>${orderCount} pedido(s) · ${currency.format(customer.total_spent || 0)} em compras</p>
              <button class="ghost" data-customer-history="${customer.id}">Ver historico</button>
              ${eligible ? `<button class="ghost" data-customer-promo="${customer.id}">Mensagem de promoção</button>` : ""}
            </article>
          `;
        })
        .join("")
    : `<article class="customer-card"><strong>Nenhum cliente encontrado</strong><p>Ajuste os filtros ou aguarde novos pedidos.</p></article>`;

  document.querySelectorAll("[data-customer-promo]").forEach((button) => {
    button.addEventListener("click", () => createCustomerPromoMessage(Number(button.dataset.customerPromo)));
  });
  document.querySelectorAll("[data-customer-history]").forEach((button) => {
    button.addEventListener("click", () => showCustomerHistory(Number(button.dataset.customerHistory)));
    });
}

function customerOrderUrl() {
  const configuredDomain = String(settings.domain || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  const base = configuredDomain ? `https://${configuredDomain}` : window.location.origin;
  return `${base}${window.location.pathname}#pedir`;
}

function renderInboxQrPanel() {
  const image = byId("inbox-qr-image");
  const hint = byId("inbox-qr-hint");
  if (!image || !hint) return;
  const phone = String(settings.whatsapp_number || settings.stock_whatsapp || "").replace(/\D/g, "");
  if (phone) {
    const waUrl = `https://wa.me/${phone}`;
    image.src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(waUrl)}`;
    hint.innerHTML = `<strong>Conecte seu WhatsApp</strong><br>Escaneie para iniciar conversa no número ${phone}`;
  } else {
    image.src = "";
    image.alt = "Configure o número WhatsApp em Integrações";
    hint.textContent = "Configure o número WhatsApp em Integrações para gerar o QR Code de conexão.";
  }
}

function renderQrPanel() {
  const image = byId("qr-code-image");
  const display = byId("qr-display-link");
  const helper = byId("qr-helper-text");
  if (!image || !display || !helper) return;

  const url = customerOrderUrl();
  image.src = `https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=12&data=${encodeURIComponent(url)}`;
  display.textContent = String(settings.domain || "").trim() || "Link local do cardápio";
  helper.textContent = String(settings.domain || "").trim()
    ? "Use este QR nas mesas, embalagens e redes sociais."
    : "Antes de imprimir para clientes, publique o sistema e cadastre o domínio em Integrações.";
}

function filteredCustomers() {
  const name = state.customerNameFilter.toLowerCase();
  const phone = state.customerPhoneFilter.replace(/\D/g, "");
  const address = state.customerAddressFilter.toLowerCase();
  return customers.filter((customer) => {
    const customerPhone = String(customer.phone || "").replace(/\D/g, "");
    return (
      (!name || String(customer.name || "").toLowerCase().includes(name)) &&
      (!phone || customerPhone.includes(phone)) &&
      (!address || String(customer.address || "").toLowerCase().includes(address))
    );
  });
}

function createCustomerPromoMessage(customerId) {
  const customer = customers.find((current) => current.id === customerId);
  if (!customer) return;
  const message = `Olá, ${customer.name}! Você já fez ${customer.order_count || 0} pedidos na Bortolini. Temos uma promoção especial para você no próximo pedido.`;
  navigator.clipboard?.writeText(message);
  const phone = String(customer.phone || "").replace(/\D/g, "");
  if (phone) {
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank");
  }
  showToast("Mensagem de promoção copiada.");
}

async function showCustomerHistory(customerId) {
  const panel = byId("customer-history");
  if (!panel) return;
  const customer = customers.find((current) => current.id === customerId);
  panel.innerHTML = `<article class="customer-card"><strong>Carregando historico...</strong></article>`;
  try {
    const data = state.apiOnline
      ? await api(`/api/customers/${customerId}/orders`)
      : { customer, orders: orders.filter((order) => order.customer === customer?.name) };
    panel.innerHTML = `
      <article class="customer-card">
        <strong>${data.customer.name}</strong>
        <p>${data.customer.phone || "Sem telefone"} - ${data.customer.address || "Sem endereco"}</p>
      </article>
      ${(data.orders || [])
        .map(
          (order) => `
            <article class="customer-card">
              <strong>#${order.id} - ${currency.format(order.total)}</strong>
              <p>${order.item} - ${order.payment || "Nao informado"} - ${order.status}</p>
              <p>${order.created_at || ""}${order.cancel_reason ? ` - Cancelado: ${order.cancel_reason}` : ""}</p>
            </article>
          `,
        )
        .join("") || `<article class="customer-card"><strong>Sem pedidos encontrados</strong></article>`}
    `;
  } catch (error) {
    panel.innerHTML = `<article class="customer-card"><strong>Nao foi possivel carregar o historico.</strong></article>`;
  }
}

function renderDriverApp() {
  const assigned = deliveries;
  byId("driver-orders").innerHTML = assigned.length
    ? assigned
        .map(
          (delivery) => `
            <article class="driver-card">
              <strong>#${delivery.id} · ${delivery.customer}</strong>
              <p>${delivery.item}</p>
              <p>${delivery.address || "Endereço não informado"}</p>
              <p>${delivery.customer_phone || "Telefone não informado"}</p>
              <p class="location-line">${formatLocation(delivery)}</p>
              <div class="ticket-actions">
                <button class="ghost" data-driver-whatsapp="${delivery.id}">WhatsApp</button>
                <button class="ghost" data-driver-route="${delivery.id}">Rota</button>
              </div>
              <button class="secondary" data-driver-done="${delivery.id}">Marcar entregue</button>
            </article>
          `,
        )
        .join("")
    : `<article class="driver-card"><strong>Sem entregas atribuídas</strong><p>Quando houver rota, ela aparece aqui.</p></article>`;
  document.querySelectorAll("[data-driver-done]").forEach((button) => {
    button.addEventListener("click", () => advanceOrder(Number(button.dataset.driverDone)));
  });
  document.querySelectorAll("[data-driver-whatsapp]").forEach((button) => {
    button.addEventListener("click", () => copyWhatsAppMessage(Number(button.dataset.driverWhatsapp)));
  });
  document.querySelectorAll("[data-driver-route]").forEach((button) => {
    button.addEventListener("click", () => openDeliveryRoute(Number(button.dataset.driverRoute)));
  });
}

function inboxModeLabel(mode) {
  return {
    ai: "IA automática",
    human: "Atendente",
    assisted: "IA assistida",
  }[mode] || "IA automática";
}

function openDeliveryRoute(orderId) {
  const delivery = deliveries.find((current) => Number(current.id) === Number(orderId));
  if (!delivery?.address) {
    showToast("Endereço não informado para este pedido.");
    return;
  }
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(delivery.address)}`, "_blank");
}

function renderSettings() {
  byId("setting-name").value = settings.restaurant_name || "";
  byId("setting-hours").value = settings.opening_hours || "";
  byId("setting-fee").value = settings.delivery_fee || "";
  byId("setting-prep").value = settings.prep_time || "";
  byId("setting-areas").value = settings.delivery_areas || "";
  const baseUrl = `${window.location.origin}${window.location.pathname}`;
  byId("settings-menu-link").value = baseUrl + "#pedir";
  byId("settings-driver-link").value = baseUrl + "entregador/";
  renderDeliveryZones();
  renderTeamUsers();
}

function renderPizzaSizePrices() {
  try {
    const stored = JSON.parse(settings.pizza_sizes || "[]");
    PIZZA_SIZES.forEach((size) => {
      const input = byId(`menu-pizza-${size.key}`);
      if (input) {
        const found = stored.find((s) => s.key === size.key);
        input.value = found ? found.price : size.price;
      }
    });
  } catch (e) {
    PIZZA_SIZES.forEach((size) => {
      const input = byId(`menu-pizza-${size.key}`);
      if (input) input.value = size.price;
    });
  }
}

function renderTeamUsers() {
  const box = byId("team-users-list");
  if (!box) return;
  box.innerHTML = demoUsers.length
    ? demoUsers
        .map(
          (user) => {
            const driverLink = user.role === "entregador" ? `<a href="/entregador/${user.id}" target="_blank">🔗 Link do entregador</a>` : "";
            return `
            <article class="ingredient-card">
              <div>
                <small>${roleLabels[user.role] || user.role}</small>
                <strong>${user.name}</strong>
                <p>${user.email}${Number(user.must_change_pin) ? " · primeiro acesso pendente" : ""}</p>
                ${driverLink}
              </div>
              <button class="ghost" data-reset-user-pin="${user.id}" ${user.role === "admin" ? "disabled" : ""}>Resetar PIN</button>
            </article>
          `;
          }
        )
        .join("")
    : `<article class="ingredient-card"><strong>Nenhum usuário cadastrado</strong></article>`;

  document.querySelectorAll("[data-reset-user-pin]").forEach((button) => {
    button.addEventListener("click", () => resetUserPin(Number(button.dataset.resetUserPin)));
  });
}

function formatCpf(cpf) {
  const digits = String(cpf || "").replace(/\D/g, "");
  if (digits.length !== 11) return cpf || "Não informado";
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

function renderDeliveryZones() {
  const box = byId("delivery-zones-list");
  if (!box) return;
  box.innerHTML = deliveryZones.length
    ? deliveryZones
        .map(
          (zone) => `
            <article class="ingredient-card">
              <strong>${zone.neighborhood}<span>${currency.format(zone.fee)}</span></strong>
              <p>${zone.eta} · ${zone.active ? "Ativo" : "Pausado"}</p>
              <div class="zone-actions">
                <button class="ghost" data-edit-zone="${zone.id}">Editar</button>
                <button class="ghost" data-toggle-zone="${zone.id}">${zone.active ? "Pausar" : "Ativar"}</button>
              </div>
            </article>
          `,
        )
        .join("")
    : `<article class="ingredient-card"><strong>Sem bairros</strong><p>Cadastre taxas por região.</p></article>`;
  document.querySelectorAll("[data-toggle-zone]").forEach((button) => {
    button.addEventListener("click", () => toggleDeliveryZone(Number(button.dataset.toggleZone)));
  });
  document.querySelectorAll("[data-edit-zone]").forEach((button) => {
    button.addEventListener("click", () => openZoneEditor(Number(button.dataset.editZone)));
  });
}

function renderIntegrations() {
  byId("integration-payment-provider").value = settings.payment_provider || "Mercado Pago";
  byId("integration-pix-key").value = settings.pix_key || "";
  byId("integration-payment-token").value = settings.payment_token || "";
  byId("integration-whatsapp-number").value = settings.whatsapp_number || "";
  byId("integration-stock-whatsapp").value = settings.stock_whatsapp || "";
  byId("integration-whatsapp-token").value = settings.whatsapp_token || "";
  const pnid = byId("integration-phone-number-id"); if(pnid) pnid.value = settings.phone_number_id || "";
  byId("integration-gps-interval").value = settings.gps_interval || "30 segundos";
  byId("integration-domain").value = settings.domain || "";
  byId("deploy-db").checked = settings.deploy_db === "true";
  byId("deploy-env").checked = settings.deploy_env === "true";
  byId("deploy-https").checked = settings.deploy_https === "true";
  byId("integration-evolution-url").value = settings.evolution_url || "";
  byId("integration-evolution-instance").value = settings.evolution_instance || "";
  byId("integration-evolution-apikey").value = settings.evolution_apikey || "";
  const baseUrl = `${window.location.origin}${window.location.pathname}`.replace(/\/$/, "");
  const webhookEl = byId("evolution-webhook-url");
  if (webhookEl) webhookEl.textContent = `${baseUrl}/api/webhook/evolution`;
}

async function advanceOrder(id) {
  const order = orders.find((current) => current.id === id);
  if (!canAdvanceOrder(order)) return;

  const nextStatus = statusFlow[order.status];

  // Feedback visual de loading
  const btns = document.querySelectorAll(`[data-advance="${id}"]`);
  btns.forEach((btn) => { btn.disabled = true; btn.textContent = "Aguarde..."; });

  if (state.apiOnline) {
    try {
      const updated = await api(`/api/orders/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      orders = orders.map((current) => (current.id === id ? updated : current));
      if (nextStatus === "Entrega") {
        deliveries = await api("/api/deliveries");
        drivers = await api("/api/drivers");
      }
      closeout = await api("/api/closeout");
    } catch (error) {
      state.apiOnline = false;
      orders = orders.map((current) => (current.id === id ? { ...current, status: nextStatus } : current));
      if (nextStatus === "Entrega") {
        const updatedOrder = orders.find((current) => current.id === id);
        deliveries = [
          ...deliveries,
          {
            ...updatedOrder,
            driver_name: "Caio",
            driver_lat: -23.5614,
            driver_lng: -46.6559,
            last_location_at: new Date().toISOString(),
          },
        ];
      }
    }
  } else {
    orders = orders.map((current) => (current.id === id ? { ...current, status: nextStatus } : current));
    if (nextStatus === "Entrega") {
      const updatedOrder = orders.find((current) => current.id === id);
      deliveries = [
        ...deliveries,
        {
          ...updatedOrder,
          driver_name: "Caio",
          driver_lat: -23.5614,
          driver_lng: -46.6559,
          last_location_at: new Date().toISOString(),
        },
      ];
    }
  }
  renderAll();
}

async function createOrder() {
  if (!can("createOrder")) return;
  const stockBeforeOrder = [...ingredients];

  const customer = byId("customer-name").value.trim();
  const itemName = byId("order-item").value;
  const item = menuItems.find((menuItem) => menuItem.name === itemName) || menuItems[0];

  if (!customer || (!item && !internalOrderItems.length)) {
    return;
  }
  const items = internalOrderItems.length ? internalOrderItems : [{ id: item.id, name: item.name, qty: Number(byId("order-qty").value || 1), price: Number(item.price) }];
  const discount = Number(byId("order-discount").value || 0);
  const deliveryType = byId("order-delivery-type").value;
  const deliveryFee = deliveryType === "Retirada" ? 0 : Number(byId("order-delivery-fee").value || zoneForAddress(byId("order-address").value)?.fee || settings.delivery_fee || 0);
  const subtotal = items.reduce((sum, entry) => sum + entry.price * entry.qty, 0);

  const payload = {
    customer,
    customer_phone: byId("customer-phone").value.trim(),
    address: byId("order-address").value.trim(),
    notes: byId("order-notes").value.trim(),
    delivery_type: deliveryType,
    channel: byId("order-channel").value,
    status: "Novo",
    item: items.map((entry) => `${entry.qty}x ${entry.name}${entry.addon ? ` (${entry.addon})` : ""}`).join(" + "),
    items,
    total: Math.max(subtotal + deliveryFee - discount, 0),
    payment: byId("order-payment").value,
    payment_status: byId("order-payment").value === "Dinheiro" ? "A pagar na entrega" : "Aguardando pagamento",
    eta: zoneForAddress(byId("order-address").value)?.eta || "20 min",
    delivery_fee: deliveryFee,
    discount,
  };

  if (state.apiOnline) {
    try {
      const created = await api("/api/orders", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      orders = [created, ...orders];
    } catch (error) {
      showToast(error.message || "Nao foi possivel criar o pedido.");
      if (error.status === 409) return;
      state.apiOnline = false;
      orders = [{ ...payload, id: Math.max(...orders.map((order) => order.id)) + 1 }, ...orders];
    }
  } else {
    orders = [{ ...payload, id: Math.max(...orders.map((order) => order.id)) + 1 }, ...orders];
  }

  byId("customer-name").value = "";
  byId("customer-phone").value = "";
  byId("order-address").value = "";
  byId("order-notes").value = "";
  byId("order-delivery-type").value = "Entrega";
  internalOrderItems = [];
  renderInternalOrderItems();
  byId("order-qty").value = "1";
  byId("order-discount").value = "";
  byId("order-delivery-fee").value = "";
  byId("order-dialog").close();
  if (state.apiOnline) {
    customers = await api("/api/customers");
    ingredients = await api("/api/ingredients");
    stockMovements = await api("/api/stock-movements");
    profitReport = await api("/api/profit-report");
    notifyNewLowStock(stockBeforeOrder, "pedido");
  }
  renderAll();
  switchView("orders");
}

async function createProduct() {
  if (!can("menu")) return;

  const payload = {
    name: byId("product-name").value.trim(),
    category: byId("product-category").value.trim(),
    description: byId("product-description").value.trim(),
    size: byId("product-size").value.trim(),
    prep_time: byId("product-prep").value.trim(),
    addons: byId("product-addons").value.trim(),
    price: Number(byId("product-price").value),
    image_url: productPhotoData,
  };

  byId("product-error").textContent = "";
  if (!payload.name || !payload.category || !payload.price) {
    byId("product-error").textContent = "Preencha nome, categoria e preço.";
    return;
  }

  try {
    if (editingProductId) {
      const updated = state.apiOnline
        ? await api(`/api/menu/${editingProductId}`, { method: "PATCH", body: JSON.stringify(payload) })
        : { ...menuItems.find((item) => item.id === editingProductId), ...payload };
      menuItems = menuItems.map((item) => (item.id === editingProductId ? updated : item));
    } else if (state.apiOnline) {
      const created = await api("/api/menu", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      menuItems = [...menuItems, created];
    } else {
      menuItems = [
        ...menuItems,
        { ...payload, id: Math.max(...menuItems.map((item) => item.id)) + 1, sales: 0, active: 1 },
      ];
    }
    byId("product-name").value = "";
    byId("product-category").value = "";
    byId("product-description").value = "";
    byId("product-size").value = "";
    byId("product-prep").value = "";
    byId("product-addons").value = "";
    byId("product-price").value = "";
    byId("product-photo").value = "";
    productPhotoData = "";
    editingProductId = null;
    byId("create-product").textContent = "Criar produto";
    byId("product-dialog").close();
    byId("product-photo-preview").classList.add("hidden");
    byId("product-photo-preview").classList.add("hidden");
    byId("product-photo-preview").style.backgroundImage = "";
    byId("product-dialog").close();
    renderMenu();
  } catch (error) {
    byId("product-error").textContent = "Não foi possível criar. Verifique se o produto já existe.";
  }
}

async function createPromotion() {
  if (!can("menu")) return;

  const channels = [...document.querySelectorAll('[name="promo-channel"]:checked')].map((input) => input.value);
  const payload = {
    title: byId("promotion-title").value.trim(),
    item_name: byId("promotion-item").value,
    discount_type: byId("promotion-type").value,
    discount_value: Number(byId("promotion-value").value),
    starts_at: byId("promotion-start").value,
    ends_at: byId("promotion-end").value,
    channels,
  };

  byId("promotion-error").textContent = "";
  if (!payload.title || !payload.item_name || !payload.discount_value || !payload.starts_at || !payload.ends_at) {
    byId("promotion-error").textContent = "Preencha título, produto, valor, início e fim.";
    return;
  }

  try {
    if (editingPromotionId) {
      const updated = state.apiOnline
        ? await api(`/api/promotions/${editingPromotionId}`, { method: "PATCH", body: JSON.stringify(payload) })
        : { ...promotions.find((promotion) => promotion.id === editingPromotionId), ...payload, channels: channels.join(", ") };
      promotions = promotions.map((promotion) => (promotion.id === editingPromotionId ? updated : promotion));
    } else if (state.apiOnline) {
      const created = await api("/api/promotions", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      promotions = [created, ...promotions];
    } else {
      promotions = [
        { ...payload, id: Math.max(...promotions.map((promotion) => promotion.id), 0) + 1, active: 1, channels: channels.join(", ") },
        ...promotions,
      ];
    }
    byId("promotion-title").value = "";
    byId("promotion-value").value = "";
    editingPromotionId = null;
    byId("create-promotion").textContent = "Lançar promoção";
    byId("promotion-dialog").close();
    renderMenu();
  } catch (error) {
    byId("promotion-error").textContent = "Não foi possível lançar a promoção.";
  }
}

function openIngredientEditor(ingredientId) {
  const ingredient = ingredients.find((i) => i.id === ingredientId);
  if (!ingredient) return;
  byId("edit-ingredient-id").value = ingredient.id;
  byId("edit-ingredient-name").value = ingredient.name || "";
  byId("edit-ingredient-code").value = ingredient.code || "";
  byId("edit-ingredient-unit").value = ingredient.unit || "";
  byId("edit-ingredient-stock").value = ingredient.stock_qty || 0;
  byId("edit-ingredient-min").value = ingredient.min_qty || 0;
  byId("edit-ingredient-cost").value = ingredient.unit_cost || 0;
  byId("edit-ingredient-supplier").value = ingredient.supplier || "";
  byId("edit-ingredient-error").textContent = "";
  byId("ingredient-edit-dialog").showModal();
}

async function saveIngredientEdit() {
  const id = Number(byId("edit-ingredient-id").value);
  const payload = {
    name: byId("edit-ingredient-name").value.trim(),
    code: byId("edit-ingredient-code").value.trim(),
    unit: byId("edit-ingredient-unit").value.trim(),
    stock_qty: parseFloat(byId("edit-ingredient-stock").value) || 0,
    min_qty: parseFloat(byId("edit-ingredient-min").value) || 0,
    unit_cost: parseFloat(byId("edit-ingredient-cost").value) || 0,
    supplier: byId("edit-ingredient-supplier").value.trim(),
  };
  if (!payload.name || !payload.code) {
    byId("edit-ingredient-error").textContent = "Nome e código são obrigatórios.";
    return;
  }
  try {
    const updated = state.apiOnline
      ? await api(`/api/ingredients/${id}`, { method: "PATCH", body: JSON.stringify(payload) })
      : { ...ingredients.find((i) => i.id === id), ...payload };
    ingredients = ingredients.map((i) => (i.id === id ? updated : i));
    renderInventory();
    renderRecipeRows();
    byId("ingredient-edit-dialog").close();
    showToast("Ingrediente atualizado!");
  } catch (error) {
    byId("edit-ingredient-error").textContent = error.message || "Erro ao salvar.";
  }
}

async function createIngredient() {
  const name = byId("ingredient-name").value.trim();
  const code = byId("ingredient-code") ? byId("ingredient-code").value.trim() : "";
  const stockQty = byId("ingredient-stock").value;
  const minQty = byId("ingredient-min").value;
  const errEl = byId("ingredient-error");
  if (errEl) errEl.textContent = "";
  if (!name) { if(errEl) errEl.textContent = "Nome é obrigatório."; else showToast("Nome obrigatório."); return; }
  if (!code) { if(errEl) errEl.textContent = "Código é obrigatório."; else showToast("Código obrigatório."); return; }
  if (stockQty === "") { if(errEl) errEl.textContent = "Quantidade é obrigatória."; return; }
  if (minQty === "") { if(errEl) errEl.textContent = "Quantidade mínima é obrigatória."; return; }
  const payload = {
    name,
    code,
    unit: byId("ingredient-unit").value.trim() || "un",
    stock_qty: Number(stockQty),
    min_qty: Number(minQty),
    unit_cost: Number(byId("ingredient-cost").value || 0),
    supplier: byId("ingredient-supplier").value.trim(),
  };
  try {
    const created = state.apiOnline
      ? await api("/api/ingredients", { method: "POST", body: JSON.stringify(payload) })
      : { ...payload, id: Math.max(...ingredients.map((i) => i.id), 0) + 1, low_stock: payload.stock_qty <= payload.min_qty };
    ingredients = [...ingredients, created];
    ["ingredient-name", "ingredient-code", "ingredient-unit", "ingredient-stock", "ingredient-min", "ingredient-cost", "ingredient-supplier"].forEach((id) => {
      const el = byId(id); if (el) el.value = "";
    });
    renderInventory();
    if (payload.min_qty > 0 && payload.stock_qty <= payload.min_qty) {
      showToast("⚠️ Estoque abaixo do mínimo! Alerta WhatsApp enviado.");
    } else {
      showToast("Ingrediente adicionado ao estoque.");
    }
  } catch (error) {
    if(errEl) errEl.textContent = "Não foi possível cadastrar o ingrediente.";
    else showToast("Erro ao cadastrar ingrediente.");
  }
}

async function saveRecipeIngredient() {
  const itemId = Number(byId("recipe-item").value);
  const rows = [...document.querySelectorAll("[data-recipe-line]")]
    .map((line) => ({
      ingredient_id: Number(line.querySelector("[data-recipe-ingredient]")?.value),
      quantity: Number(line.querySelector("[data-recipe-qty]")?.value),
    }))
    .filter((row) => row.ingredient_id || row.quantity);

  const hasInvalid = rows.some((row) => !row.ingredient_id || !Number.isFinite(row.quantity) || row.quantity <= 0);
  if (!itemId || !rows.length || hasInvalid) {
    showToast("Informe ingrediente e quantidade maior que zero.");
    return;
  }

  const duplicated = new Set();
  const hasDuplicate = rows.some((row) => {
    if (duplicated.has(row.ingredient_id)) return true;
    duplicated.add(row.ingredient_id);
    return false;
  });
  if (hasDuplicate) {
    showToast("Cada ingrediente deve aparecer apenas uma vez na ficha.");
    return;
  }
  try {
    if (state.apiOnline) {
      recipes = await api(`/api/menu/${itemId}/ingredients`, { method: "PATCH", body: JSON.stringify({ ingredients: rows }) });
    } else {
      recipes = replaceLocalRecipe(itemId, rows);
    }
    renderRecipeRows(true);
    renderInventory();
  } catch (error) {
    showToast("Nao foi possivel salvar a ficha tecnica.");
  }
}

function upsertLocalRecipe(itemId, payload) {
  const item = menuItems.find((current) => current.id === itemId);
  const ingredient = ingredients.find((current) => current.id === payload.ingredient_id);
  const next = {
    id: Date.now(),
    menu_item_id: itemId,
    ingredient_id: payload.ingredient_id,
    quantity: payload.quantity,
    item_name: item?.name || "",
    ingredient_name: ingredient?.name || "",
    unit: ingredient?.unit || "",
  };
  return [...recipes.filter((recipe) => !(recipe.menu_item_id === itemId && recipe.ingredient_id === payload.ingredient_id)), next];
}

function replaceLocalRecipe(itemId, rows) {
  let nextRecipes = recipes.filter((recipe) => Number(recipe.menu_item_id) !== Number(itemId));
  rows.forEach((payload) => {
    const item = menuItems.find((current) => Number(current.id) === Number(itemId));
    const ingredient = ingredients.find((current) => Number(current.id) === Number(payload.ingredient_id));
    nextRecipes = [
      ...nextRecipes,
      {
        id: Date.now() + Number(payload.ingredient_id),
        menu_item_id: itemId,
        ingredient_id: payload.ingredient_id,
        quantity: payload.quantity,
        item_name: item?.name || "",
        ingredient_name: ingredient?.name || "",
        unit: ingredient?.unit || "",
      },
    ];
  });
  return nextRecipes;
}

async function updateStock(ingredientId) {
  const input = document.querySelector(`[data-stock-input="${ingredientId}"]`);
  const ingredient = ingredients.find((current) => current.id === ingredientId);
  if (!input || !ingredient) return;
  const stockBeforeUpdate = [...ingredients];
  const payload = { stock_qty: Number(input.value) };
  try {
    const updated = state.apiOnline
      ? await api(`/api/ingredients/${ingredientId}`, { method: "PATCH", body: JSON.stringify({ ...payload, reason: "Ajuste manual" }) })
      : { ...ingredient, ...payload, low_stock: payload.stock_qty <= Number(ingredient.min_qty) };
    ingredients = ingredients.map((current) => (current.id === ingredientId ? updated : current));
    stockMovements = state.apiOnline ? await api("/api/stock-movements") : stockMovements;
    notifyNewLowStock(stockBeforeUpdate, "ajuste manual");
    renderInventory();
  } catch (error) {
    showToast("Nao foi possivel atualizar o estoque.");
  }
}

function openZoneEditor(zoneId) {
  const zone = deliveryZones.find((z) => z.id === zoneId);
  if (!zone) return;
  editingZoneId = zoneId;
  byId("zone-neighborhood").value = zone.neighborhood || "";
  byId("zone-fee").value = zone.fee ?? "";
  byId("zone-eta").value = zone.eta || "";
  byId("create-zone-btn").textContent = "Salvar bairro";
  const cancelBtn = byId("cancel-zone-btn");
  if (cancelBtn) cancelBtn.classList.remove("hidden");
  // Destaque visual no formulario
  const formGrid = document.querySelector("#settings .inventory-form");
  if (formGrid) formGrid.classList.add("editing-zone");
  // Scroll e foco para o usuario ver o form preenchido
  const neighborhoodInput = byId("zone-neighborhood");
  if (neighborhoodInput) {
    neighborhoodInput.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => neighborhoodInput.focus(), 300);
  }
}

function cancelZoneEdit() {
  editingZoneId = null;
  byId("zone-neighborhood").value = "";
  byId("zone-fee").value = "";
  byId("zone-eta").value = "";
  byId("create-zone-btn").textContent = "Adicionar bairro";
  const cancelBtn = byId("cancel-zone-btn");
  if (cancelBtn) cancelBtn.classList.add("hidden");
  const formGrid = document.querySelector("#settings .inventory-form");
  if (formGrid) formGrid.classList.remove("editing-zone");
}

async function saveDeliveryZone() {
  const payload = {
    neighborhood: byId("zone-neighborhood").value.trim(),
    fee: Number(byId("zone-fee").value || 0),
    eta: byId("zone-eta").value.trim() || "35 a 45 minutos",
  };
  if (!payload.neighborhood) return;
  try {
    if (editingZoneId) {
      const updated = state.apiOnline
        ? await api(`/api/delivery-zones/${editingZoneId}`, { method: "PATCH", body: JSON.stringify(payload) })
        : { ...deliveryZones.find((z) => z.id === editingZoneId), ...payload };
      deliveryZones = deliveryZones.map((z) => (z.id === editingZoneId ? updated : z));
      editingZoneId = null;
    } else {
      const created = state.apiOnline
        ? await api("/api/delivery-zones", { method: "POST", body: JSON.stringify({ ...payload, active: 1 }) })
        : { ...payload, active: 1, id: Date.now() };
      deliveryZones = [...deliveryZones, created];
    }
    byId("zone-neighborhood").value = "";
    byId("zone-fee").value = "";
    byId("zone-eta").value = "";
    byId("create-zone-btn").textContent = "Adicionar bairro";
    const cancelBtn = byId("cancel-zone-btn");
    if (cancelBtn) cancelBtn.classList.add("hidden");
    renderDeliveryZones();
  } catch (error) {
    showToast(editingZoneId ? "Nao foi possivel atualizar o bairro." : "Nao foi possivel cadastrar o bairro.");
  }
}

async function toggleDeliveryZone(zoneId) {
  const zone = deliveryZones.find((current) => current.id === zoneId);
  if (!zone) return;
  const payload = { active: zone.active ? 0 : 1 };
  const updated = state.apiOnline
    ? await api(`/api/delivery-zones/${zoneId}`, { method: "PATCH", body: JSON.stringify(payload) })
    : { ...zone, ...payload };
  deliveryZones = deliveryZones.map((current) => (current.id === zoneId ? updated : current));
  renderDeliveryZones();
}

function isLowStock(ingredient) {
  return Boolean(ingredient?.low_stock) || Number(ingredient?.stock_qty || 0) <= Number(ingredient?.min_qty || 0);
}

function lowStockItems() {
  return ingredients.filter(isLowStock);
}

function rememberCurrentLowStock() {
  notifiedLowStockIds = new Set(lowStockItems().map((ingredient) => Number(ingredient.id)));
}

function notifyNewLowStock(previousIngredients = [], source = "estoque") {
  const previousById = new Map(previousIngredients.map((ingredient) => [Number(ingredient.id), ingredient]));
  const recoveredIds = ingredients.filter((ingredient) => !isLowStock(ingredient)).map((ingredient) => Number(ingredient.id));
  recoveredIds.forEach((id) => notifiedLowStockIds.delete(id));

  const newAlerts = lowStockItems().filter((ingredient) => {
    const id = Number(ingredient.id);
    const previous = previousById.get(id);
    const crossedMinimum = !previous || !isLowStock(previous) || Number(ingredient.stock_qty) < Number(previous.stock_qty);
    return crossedMinimum && !notifiedLowStockIds.has(id);
  });

  if (!newAlerts.length) return;
  newAlerts.forEach((ingredient) => notifiedLowStockIds.add(Number(ingredient.id)));
  sendStockWhatsApp(newAlerts, { automatic: true, source });
}

function sendStockWhatsApp(items = lowStockItems(), options = {}) {
  if (!items.length) {
    showToast("Nenhum ingrediente abaixo do minimo.");
    return;
  }
  const message = `Alerta de estoque Bortolini${options.automatic ? ` (${options.source})` : ""}: ${items.map((ingredient) => `${ingredient.name} esta com ${Number(ingredient.stock_qty).toLocaleString("pt-BR")} ${ingredient.unit}, minimo ${Number(ingredient.min_qty).toLocaleString("pt-BR")} ${ingredient.unit}`).join("; ")}`;
  navigator.clipboard?.writeText(message);
  const phone = String(settings.stock_whatsapp || settings.whatsapp_number || "").replace(/\D/g, "");
  if (phone) {
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank");
    showToast(options.automatic ? "Estoque no minimo: aviso aberto no WhatsApp." : "Alerta aberto no WhatsApp e copiado.");
  } else {
    showToast("Estoque no minimo: alerta copiado. Cadastre um WhatsApp nas integracoes para abrir direto.");
  }
}

function copyWhatsAppTemplate(type) {
  const templates = {
    confirm: "Ola! Seu pedido na Bortolini foi confirmado e ja entrou na fila. Em breve avisamos quando estiver em preparo.",
    delivery: "Ola! Seu pedido saiu para entrega. O entregador ja esta a caminho e voce pode acompanhar pelo numero do pedido.",
    promo: "Ola! Hoje temos promocao especial na Bortolini. Chame aqui e veja as opcoes disponiveis para seu pedido.",
    stock: "Alerta de estoque Bortolini: conferir ingredientes abaixo do minimo antes do proximo turno.",
  };
  const message = templates[type] || templates.confirm;
  navigator.clipboard?.writeText(message);
  showToast("Mensagem pronta copiada.");
}

function selectPaymentCard(card) {
  if (!card) return;
  // Suporta tanto o layout antigo (payment-cards) quanto o novo iFood (ifood-payment-list)
  const container = card.closest('.payment-cards') || card.closest('.ifood-payment-list');
  if (container) {
    const selector = container.classList.contains('ifood-payment-list') ? '.ifood-pay-row' : '.payment-card';
    container.querySelectorAll(selector).forEach(c => c.classList.remove('selected'));
  }
  card.classList.add('selected');
  const input = card.querySelector('input[type="radio"]');
  if (input) input.checked = true;

  const trocoBox = byId('checkout-troco-box');
  if (trocoBox) {
    if (card.dataset.payment === 'Dinheiro') {
      trocoBox.classList.remove('hidden');
    } else {
      trocoBox.classList.add('hidden');
      byId('dialog-checkout-troco').value = '';
    }
  }
}

function openCheckoutDialog() {
  if (!cart.length) {
    showToast("Adicione pelo menos um item ao carrinho.");
    return;
  }
  const subtotal = cartTotal();
  const deliveryType = byId("dialog-checkout-type")?.value || "Entrega";
  const address = byId("dialog-checkout-address")?.value || "";
  const fee = deliveryType === "Entrega" ? getDeliveryFee(address) : 0;

  byId("checkout-summary").innerHTML = cart
    .map((entry) => {
      if (entry.type === "pizza") {
        const crustText = entry.crust ? ` · ${entry.crust}` : "";
        const notesText = entry.notes ? ` · ${entry.notes}` : "";
        return `
          <div class="ifood-item-row">
            <span class="ifood-item-qty">${entry.qty}x</span>
            <div class="ifood-item-info">
              <strong>${escapeHtml(entry.sizeLabel)}${escapeHtml(crustText)}</strong>
              <p>${entry.flavors.map((f) => escapeHtml(f.name)).join(" + ")}${escapeHtml(notesText)}</p>
            </div>
            <span class="ifood-item-price">${currency.format(entry.price * entry.qty)}</span>
          </div>
        `;
      }
      return `
        <div class="ifood-item-row">
          <span class="ifood-item-qty">${entry.qty}x</span>
          <div class="ifood-item-info">
            <strong>${escapeHtml(entry.name)}</strong>
          </div>
          <span class="ifood-item-price">${currency.format(entry.price * entry.qty)}</span>
        </div>
      `;
    })
    .join("");

  byId("checkout-subtotal").textContent = currency.format(subtotal);
  byId("checkout-fee").textContent = currency.format(fee);
  byId("checkout-grand-total").textContent = currency.format(subtotal + fee);
  byId("checkout-btn-total").textContent = `· ${currency.format(subtotal + fee)}`;
  byId("checkout-eta").textContent = settings.prep_time || "35 min";

  byId("dialog-checkout-error").textContent = "";
  byId("dialog-checkout-name").value = "";
  byId("dialog-checkout-phone").value = "";
  byId("dialog-checkout-type").value = "Entrega";
  byId("dialog-checkout-address").value = "";
  selectPaymentCard(byId("checkout-payment-cards")?.querySelector('[data-payment="PIX"]'));
  byId("dialog-checkout-notes").value = "";
  byId("checkout-dialog").showModal();
}

async function checkoutCart() {
  byId("dialog-checkout-error").textContent = "";
  const stockBeforeCheckout = [...ingredients];
  if (!cart.length) {
    byId("dialog-checkout-error").textContent = "Adicione pelo menos um item.";
    return;
  }
  const customer = byId("dialog-checkout-name").value.trim();
  if (!customer) {
    byId("dialog-checkout-error").textContent = "Informe seu nome.";
    return;
  }
  const deliveryType = byId("dialog-checkout-type").value;
  const address = byId("dialog-checkout-address").value.trim();
  if (deliveryType === "Entrega" && !address) {
    byId("dialog-checkout-error").textContent = "Informe o endereço para entrega.";
    return;
  }
  const itemLines = cart.map((entry) => {
    if (entry.type === "pizza") {
      const flavors = entry.flavors.map((f) => f.name).join(" + ");
      const crust = entry.crust ? ` · ${entry.crust}` : "";
      return `${entry.qty}x ${entry.sizeLabel}${crust} (${flavors})`;
    }
    return `${entry.qty}x ${entry.name}`;
  });

  const allNotes = [];
  const checkoutNotes = byId("dialog-checkout-notes").value.trim();
  if (checkoutNotes) allNotes.push(checkoutNotes);

  const paymentMethod = document.querySelector('input[name="checkout-payment"]:checked')?.value || "PIX";
  if (paymentMethod === "Dinheiro") {
    const troco = byId("dialog-checkout-troco")?.value?.trim();
    if (troco) allNotes.push(`Troco para: R$ ${troco}`);
  }

  cart.forEach((entry) => {
    if (entry.type === "pizza" && entry.notes) {
      allNotes.push(`${entry.sizeLabel}: ${entry.notes}`);
    }
  });

  const subtotal = cartTotal();
  const deliveryFee = deliveryType === "Entrega" ? getDeliveryFee(address) : 0;
  const total = subtotal + deliveryFee;

  const payload = {
    customer,
    customer_phone: byId("dialog-checkout-phone").value.trim(),
    address,
    notes: allNotes.join(" | "),
    delivery_type: deliveryType,
    channel: "Cardápio QR",
    status: "Novo",
    item: itemLines.join(" + "),
    items: cart.map((entry) => ({
      name: entry.type === "pizza" ? `${entry.sizeLabel} (${entry.flavors.map((f) => f.name).join(" + ")})` : entry.name,
      qty: entry.qty,
      price: entry.price,
    })),
    total,
    payment: document.querySelector('input[name="checkout-payment"]:checked')?.value || "PIX",
    payment_receipt_url: "",
    eta: settings.prep_time || "35 min",
    delivery_fee: deliveryFee,
    discount: 0,
  };
  try {
    const created = state.apiOnline
      ? await api("/api/orders", { method: "POST", body: JSON.stringify(payload) })
      : { ...payload, id: Math.max(...orders.map((order) => order.id), 0) + 1 };
    orders = [created, ...orders];
    // Só atualiza dados admin se o usuário estiver logado (evita erro 403 no checkout público)
    if (state.apiOnline && state.currentUser) {
      try { customers = await api("/api/customers"); } catch (e) {}
      try { ingredients = await api("/api/ingredients"); } catch (e) {}
      try { stockMovements = await api("/api/stock-movements"); } catch (e) {}
      try { profitReport = await api("/api/profit-report"); } catch (e) {}
      notifyNewLowStock(stockBeforeCheckout, "pedido online");
    }
    cart = [];
    saveCart();
    pixReceiptData = "";
    renderAll();

    byId("checkout-dialog").close();
    const trackLink = `${window.location.origin}${window.location.pathname}#pedir?pedido=${created.id}`;
    const floatingBtn = byId("floating-cart-btn");
    if (floatingBtn) floatingBtn.classList.add("hidden");
    byId("track-order-result").innerHTML = `
      <article class="cart-item">
        <strong>✅ Pedido #${created.id} recebido!</strong>
        <p>${payload.item} · ${currency.format(payload.total)}</p>
        <p><a href="${trackLink}" target="_blank">🔗 Acompanhar pedido</a></p>
      </article>
    `;
    byId("track-order-result").scrollIntoView({ behavior: "smooth", block: "start" });

    // Se pagamento for PIX, mostrar confirmação com CNPJ
    if (payload.payment === "PIX") {
      byId("pix-confirmation").classList.remove("hidden");
      byId("pix-order-summary").textContent = `${payload.item} · ${currency.format(payload.total)}`;
      window._pixOrderId = created.id;
    }
  } catch (error) {
    byId("dialog-checkout-error").textContent = error.message || "Não foi possível finalizar o pedido.";
  }
}

function copyPix() {
  const cnpj = settings.pix_cnpj || "66.686.680/0001-57";
  navigator.clipboard.writeText(cnpj).then(() => {
    const btn = byId("pix-copy-btn");
    btn.textContent = "Copiado!";
    setTimeout(() => { btn.textContent = "Copiar"; }, 2000);
  }).catch(() => {
    showToast(`Chave PIX: ${cnpj}`);
  });
}

async function sendPixComprovante() {
  const orderId = window._pixOrderId;
  const receiptData = window._pixReceiptData;
  byId("pix-upload-error").textContent = "";

  if (!receiptData) {
    byId("pix-upload-error").textContent = "Selecione o comprovante antes de enviar.";
    return;
  }
  const btn = byId("pix-send-btn");
  btn.disabled = true;
  btn.textContent = "Enviando...";
  try {
    if (state.apiOnline) {
      await api(`/api/public/orders/${orderId}/comprovante`, {
        method: "POST",
        body: JSON.stringify({ comprovante: receiptData }),
      });
    }
    byId("pix-sent-msg").classList.remove("hidden");
    const pixUploadSection = document.querySelector(".pix-upload-section");
    if (pixUploadSection) {
      const fileInput = pixUploadSection.querySelector('input[type="file"]');
      if (fileInput) fileInput.disabled = true;
    }
    btn.classList.add("hidden");
    showToast("Comprovante enviado com sucesso!");
  } catch (error) {
    byId("pix-upload-error").textContent = error.message || "Erro ao enviar comprovante. Tente novamente.";
    btn.disabled = false;
    btn.textContent = "Enviar comprovante";
  }
}

async function trackOrder() {
  const id = Number(byId("track-order-id").value);
  const result = byId("track-order-result");
  if (!id) {
    result.innerHTML = `<article class="cart-item"><strong>Informe o número do pedido.</strong></article>`;
    return;
  }
  try {
    const order = await api(`/api/public/orders/${id}`);
    result.innerHTML = `
      <article class="cart-item">
        <strong>Pedido #${order.id} · ${order.status}</strong>
        <p>${order.item} · previsão ${order.eta}</p>
        <p>${order.driver_name ? `Entregador: ${order.driver_name} · ${formatLocation(order)}` : "Ainda sem entregador em rota."}</p>
      </article>
    `;
  } catch (error) {
    result.innerHTML = `<article class="cart-item"><strong>Pedido não encontrado.</strong></article>`;
  }
}

async function trackOrderV2() {
  const id = Number(byId("track-order-id").value);
  const result = byId("track-order-result");
  if (!id) {
    result.innerHTML = `<article class="cart-item"><strong>Informe o numero do pedido.</strong></article>`;
    return;
  }
  try {
    const order = await api(`/api/public/orders/${id}`);
    result.innerHTML = `
      <article class="cart-item">
        <strong>Pedido #${order.id} - ${order.status}</strong>
        <div class="status-timeline">${renderOrderTimeline(order.status)}</div>
        <p>${order.item} - previsao ${order.eta}</p>
        <p>${order.status === "Cancelado" ? `Cancelado: ${order.cancel_reason || "motivo nao informado"}` : order.driver_name ? `Entregador: ${order.driver_name} - ${formatLocation(order)}` : "Ainda sem entregador em rota."}</p>
      </article>
    `;
  } catch (error) {
    result.innerHTML = `<article class="cart-item"><strong>Pedido nao encontrado.</strong></article>`;
  }
}

function renderOrderTimeline(status) {
  const steps = status === "Cancelado" ? ["Novo", "Cancelado"] : ["Novo", "Cozinha", "Entrega", "Finalizado"];
  const current = steps.indexOf(status);
  return steps
    .map((step, index) => `<span class="timeline-step ${index <= current ? "done" : ""}">${step}</span>`)
    .join("");
}

function openProductEditor(itemId) {
  const item = menuItems.find((current) => current.id === itemId);
  if (!item) return;
  editingProductId = item.id;
  byId("product-name").value = item.name;
  byId("product-category").value = item.category;
  byId("product-description").value = item.description || "";
  byId("product-size").value = item.size || "";
  byId("product-prep").value = item.prep_time || "";
  byId("product-addons").value = item.addons || "";
  byId("product-price").value = item.price;
  productPhotoData = item.image_url || "";
  byId("product-photo-preview").classList.toggle("hidden", !productPhotoData);
  byId("product-photo-preview").style.backgroundImage = productPhotoData ? `url("${productPhotoData}")` : "";
  byId("create-product").textContent = "Salvar produto";
  byId("product-dialog").showModal();
}

async function toggleProduct(itemId) {
  const item = menuItems.find((current) => current.id === itemId);
  if (!item) return;
  const payload = { active: item.active ? 0 : 1 };
  try {
    const updated = state.apiOnline
      ? await api(`/api/menu/${itemId}`, { method: "PATCH", body: JSON.stringify(payload) })
      : { ...item, ...payload };
    menuItems = menuItems.map((current) => (current.id === itemId ? updated : current));
    renderMenu();
    renderCustomerStore();
  } catch (error) {
    return;
  }
}

async function moveMenuItem(itemId, direction) {
  const idx = menuItems.findIndex((item) => item.id === itemId);
  if (idx === -1) return;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= menuItems.length) return;

  // Swap local
  const temp = menuItems[idx];
  menuItems[idx] = menuItems[newIdx];
  menuItems[newIdx] = temp;

  // Persist new order
  if (state.apiOnline) {
    try {
      const payload = { items: menuItems.map((item) => item.id) };
      await api("/api/menu/sort", { method: "PATCH", body: JSON.stringify(payload) });
    } catch (error) {
      showToast("Nao foi possivel salvar a ordenacao.");
      return;
    }
  }

  renderMenu();
  renderCustomerStore();
}

// SortableJS para reordenar cardapio
let _menuSortableInstance = null;

function setupMenuSortable() {
  const container = byId("menu-items");
  if (!container) return;

  // Destruir instancia anterior se existir
  if (_menuSortableInstance) {
    _menuSortableInstance.destroy();
    _menuSortableInstance = null;
  }

  _menuSortableInstance = Sortable.create(container, {
    animation: 200,
    handle: ".drag-handle",
    ghostClass: "sortable-ghost",
    chosenClass: "sortable-chosen",
    dragClass: "sortable-drag",
    onEnd: async (evt) => {
      // Reconstruir menuItems na nova ordem
      const cards = [...container.querySelectorAll("[data-menu-item-id]")];
      const newOrderIds = cards.map((c) => Number(c.dataset.menuItemId));
      const newMenuItems = [];
      for (const id of newOrderIds) {
        const item = menuItems.find((m) => m.id === id);
        if (item) newMenuItems.push(item);
      }
      // Preservar itens nao visiveis (nao deveria acontecer com categoria=Todos)
      for (const item of menuItems) {
        if (!newOrderIds.includes(item.id)) newMenuItems.push(item);
      }
      menuItems = newMenuItems;

      if (state.apiOnline) {
        try {
          await api("/api/menu/sort", { method: "PATCH", body: JSON.stringify({ items: menuItems.map((item) => item.id) }) });
        } catch (error) {
          showToast("Nao foi possivel salvar a ordenacao.");
          return;
        }
      }

      renderCustomerStore();
    },
  });
}

function openPromotionEditor(promotionId) {
  const promotion = promotions.find((current) => current.id === promotionId);
  if (!promotion) return;
  editingPromotionId = promotion.id;
  byId("promotion-title").value = promotion.title;
  byId("promotion-item").value = promotion.item_name;
  byId("promotion-type").value = promotion.discount_type;
  byId("promotion-value").value = promotion.discount_value;
  byId("promotion-start").value = promotion.starts_at;
  byId("promotion-end").value = promotion.ends_at;
  const channels = String(promotion.channels || "").split(",").map((channel) => channel.trim());
  document.querySelectorAll('[name="promo-channel"]').forEach((input) => {
    input.checked = channels.includes(input.value);
  });
  byId("create-promotion").textContent = "Salvar promocao";
  byId("promotion-dialog").showModal();
}

async function togglePromotion(promotionId) {
  const promotion = promotions.find((current) => current.id === promotionId);
  if (!promotion) return;
  const payload = { active: promotion.active ? 0 : 1 };
  try {
    const updated = state.apiOnline
      ? await api(`/api/promotions/${promotionId}`, { method: "PATCH", body: JSON.stringify(payload) })
      : { ...promotion, ...payload };
    promotions = promotions.map((current) => (current.id === promotionId ? updated : current));
    renderMenu();
    renderCustomerStore();
  } catch (error) {
    showToast("Nao foi possivel alterar a promocao.");
  }
}

async function assignDriver(orderId, driverId) {
  if (!driverId) return;
  try {
    const updated = state.apiOnline
      ? await api(`/api/orders/${orderId}/driver`, { method: "PATCH", body: JSON.stringify({ driver_id: driverId }) })
      : { ...deliveries.find((delivery) => delivery.id === orderId), driver_name: drivers.find((driver) => driver.id === driverId)?.name };
    orders = orders.map((order) => (order.id === orderId ? { ...order, ...updated } : order));
    deliveries = state.apiOnline ? await api("/api/deliveries") : deliveries.map((delivery) => (delivery.id === orderId ? updated : delivery));
    drivers = state.apiOnline ? await api("/api/drivers") : drivers;
    renderAll();
    showToast("Entregador atribuido.");
  } catch (error) {
    showToast("Nao foi possivel atribuir o entregador.");
  }
}

async function toggleDriver(driverId) {
  const driver = drivers.find((current) => current.id === driverId);
  if (!driver) return;
  const payload = { active: driver.active ? 0 : 1, status: driver.active ? "Pausado" : "Disponivel" };
  try {
    const updated = state.apiOnline
      ? await api(`/api/drivers/${driverId}`, { method: "PATCH", body: JSON.stringify(payload) })
      : { ...driver, ...payload };
    drivers = drivers.map((current) => (current.id === driverId ? updated : current));
    renderDelivery();
    renderDeliveryManager();
  } catch (error) {
    showToast("Nao foi possivel alterar o entregador.");
  }
}

async function createDriver() {
  const payload = {
    name: byId("driver-name").value.trim(),
    area: byId("driver-area").value.trim(),
    status: "Disponivel",
  };
  if (!payload.name) { showToast("Informe o nome do entregador."); return; }
  try {
    const created = state.apiOnline
      ? await api("/api/drivers", { method: "POST", body: JSON.stringify(payload) })
      : { ...payload, id: Math.max(...drivers.map((driver) => driver.id), 0) + 1, active: 1, orders: 0 };
    drivers = [...drivers, created];
    byId("driver-name").value = "";
    byId("driver-area").value = "";
    renderDelivery();
    renderDeliveryManager();
    renderTeamUsers();
    if (created.default_pin && created.driver_link) {
      const baseUrl = `${window.location.origin}${window.location.pathname}`;
      const fullLink = baseUrl.replace(/\/$/, "") + created.driver_link;
      byId("driver-created-name").textContent = created.name || payload.name;
      byId("driver-created-link").value = fullLink;
      byId("driver-created-pin").value = created.default_pin;
      byId("driver-created-dialog").showModal();
    } else if (created.default_pin) {
      showToast(`Entregador criado! PIN inicial: ${created.default_pin}`);
    }
  } catch (error) {
    showToast("Nao foi possivel criar o entregador.");
  }
}

function openCancelDialog(orderId) {
  cancelOrderId = orderId;
  byId("cancel-reason").value = "";
  byId("cancel-error").textContent = "";
  byId("cancel-dialog").showModal();
}

async function confirmCancelOrder() {
  const reason = byId("cancel-reason").value.trim();
  if (!reason) {
    byId("cancel-error").textContent = "Informe o motivo.";
    return;
  }
  try {
    const updated = state.apiOnline
      ? await api(`/api/orders/${cancelOrderId}`, { method: "PATCH", body: JSON.stringify({ status: "Cancelado", cancel_reason: reason }) })
      : { ...orders.find((order) => order.id === cancelOrderId), status: "Cancelado", cancel_reason: reason };
    orders = orders.map((order) => (order.id === cancelOrderId ? updated : order));
    deliveries = state.apiOnline ? await api("/api/deliveries") : deliveries.filter((delivery) => delivery.id !== cancelOrderId);
    closeout = state.apiOnline ? await api("/api/closeout") : closeout;
    ingredients = state.apiOnline ? await api("/api/ingredients") : ingredients;
    stockMovements = state.apiOnline ? await api("/api/stock-movements") : stockMovements;
    profitReport = state.apiOnline ? await api("/api/profit-report") : profitReport;
    byId("cancel-dialog").close();
    renderAll();
    showToast("Pedido cancelado com motivo registrado.");
  } catch (error) {
    byId("cancel-error").textContent = "Nao foi possivel cancelar.";
  }
}

async function updatePaymentStatus(orderId, paymentStatus, receiptStatus) {
  try {
    const updated = state.apiOnline
      ? await api(`/api/orders/${orderId}/payment`, {
          method: "PATCH",
          body: JSON.stringify({
            payment_status: paymentStatus,
            payment_receipt_status: receiptStatus,
            payment_receipt_note: receiptStatus === "Recusado" ? "Conferir comprovante com o cliente" : "Comprovante aprovado",
          }),
        })
      : { ...orders.find((order) => order.id === orderId), payment_status: paymentStatus, payment_receipt_status: receiptStatus };
    orders = orders.map((order) => (order.id === orderId ? updated : order));
    closeout = state.apiOnline ? await api("/api/closeout") : closeout;
    renderAll();
    showToast(`Pagamento ${receiptStatus.toLowerCase()}.`);
  } catch (error) {
    showToast("Nao foi possivel atualizar o pagamento.");
  }
}

function copyWhatsAppMessage(orderId) {
  const order = orders.find((current) => current.id === orderId);
  if (!order) return;

  let locationLine = "";
  if (order.status === "Entrega" && order.driver_lat && order.driver_lng) {
    const mapsLink = `https://maps.google.com/?q=${order.driver_lat},${order.driver_lng}`;
    locationLine = `\nLocalização do entregador em tempo real: ${mapsLink}`;
  }
  if (order.status === "Entrega" && order.driver_name) {
    locationLine = `\nEntregador: ${order.driver_name}.${locationLine}`;
  }

  const statusMessages = {
    Novo: `recebemos seu pedido e ele já entrou na fila`,
    Cozinha: `seu pedido está sendo preparado agora`,
    Entrega: `seu pedido saiu para entrega`,
    Finalizado: `seu pedido foi finalizado. Obrigado pela preferência`,
    Cancelado: `seu pedido foi cancelado${order.cancel_reason ? `: ${order.cancel_reason}` : ""}`,
  };
  const message = `Olá, ${order.customer}! Pedido #${order.id}: ${statusMessages[order.status] || `status ${order.status}`}. Itens: ${order.item}. Total: ${currency.format(order.total)}. Pagamento: ${order.payment || "Não informado"}. Previsão: ${order.eta}.${locationLine}`;
  navigator.clipboard?.writeText(message);
  const phone = String(order.customer_phone || settings.whatsapp_number || "").replace(/\D/g, "");
  if (phone) {
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank");
    showToast("Mensagem com localização aberta no WhatsApp.");
  } else {
    showToast(`Mensagem copiada.`);
  }
}

function printOrder(orderId) {
  const order = orders.find((current) => current.id === orderId);
  if (!order) return;
  const win = window.open("", "_blank");
  win.document.write(`
    <title>Pedido #${order.id}</title>
    <body style="font-family:Arial;padding:24px">
      <h1>Bortolini Pizzaria e delivery</h1>
      <h2>Pedido #${order.id}</h2>
      <p><strong>Cliente:</strong> ${order.customer}</p>
      <p><strong>Item:</strong> ${order.item}</p>
      <p><strong>Observações:</strong> ${order.notes || "Sem observações"}</p>
      <p><strong>Endereço:</strong> ${order.address || "Retirada/balcão"}</p>
      <p><strong>Taxa:</strong> ${currency.format(order.delivery_fee || 0)}</p>
      <p><strong>Desconto:</strong> ${currency.format(order.discount || 0)}</p>
      <p><strong>Pagamento:</strong> ${order.payment || "Não informado"}</p>
      <p><strong>Status pagamento:</strong> ${order.payment_status || "Aguardando pagamento"}</p>
      ${order.payment_receipt_url ? `<p><strong>Comprovante:</strong> anexado no pedido</p>` : ""}
      <p><strong>Total:</strong> ${currency.format(order.total)}</p>
    </body>
  `);
  win.document.close();
  win.print();
}

function printKitchenTickets() {
  const active = orders.filter((order) => ["Novo", "Cozinha"].includes(order.status));
  const win = window.open("", "_blank");
  win.document.write(`
    <title>Mapa da cozinha</title>
    <body style="font-family:Arial;padding:24px">
      <h1>Bortolini - cozinha</h1>
      ${active
        .map(
          (order) => `
            <section style="border-bottom:1px solid #ddd;padding:12px 0">
              <h2>Pedido #${order.id}</h2>
              <p><strong>Item:</strong> ${order.item}</p>
              <p><strong>Observações:</strong> ${order.notes || "Sem observações"}</p>
              <p><strong>Status:</strong> ${order.status} · ${orderAge(order)} min</p>
            </section>
          `,
        )
        .join("")}
    </body>
  `);
  win.document.close();
  win.print();
}

async function saveSettings() {
  const payload = {
    restaurant_name: byId("setting-name").value,
    opening_hours: byId("setting-hours").value,
    delivery_fee: byId("setting-fee").value,
    prep_time: byId("setting-prep").value,
    delivery_areas: byId("setting-areas").value,
  };
  try {
    settings = state.apiOnline
      ? await api("/api/settings", { method: "POST", body: JSON.stringify(payload) })
      : { ...settings, ...payload };
    byId("settings-message").textContent = "Configurações salvas.";
    renderCustomerStore();
  } catch (error) {
    byId("settings-message").textContent = "Não foi possível salvar.";
  }
}

async function syncMenuItems() {
  if (!can("settings")) return;
  try {
    byId("settings-message").textContent = "Sincronizando cardápio...";
    byId("settings-message").classList.remove("form-error");
    const result = await api("/api/sync-menu", { method: "POST" });
    byId("settings-message").textContent = `Cardápio sincronizado! ${result.inserted || 0} novos, ${result.updated || 0} atualizados.`;
    showToast("Cardápio sincronizado com sucesso!");
    loadData();
  } catch (error) {
    byId("settings-message").textContent = "Erro ao sincronizar cardápio.";
    byId("settings-message").classList.add("form-error");
  }
}

async function syncIngredients() {
  if (!can("settings")) return;
  try {
    byId("settings-message").textContent = "Sincronizando estoque...";
    byId("settings-message").classList.remove("form-error");
    const result = await api("/api/sync-ingredients", { method: "POST" });
    byId("settings-message").textContent = `${result.message || "Estoque sincronizado!"}`;
    showToast("Estoque sincronizado com sucesso!");
    loadData();
  } catch (error) {
    byId("settings-message").textContent = "Erro ao sincronizar estoque.";
    byId("settings-message").classList.add("form-error");
  }
}

async function savePizzaSizePrices() {
  const pizzaSizes = PIZZA_SIZES.map((size) => ({
    key: size.key,
    price: Number(byId(`menu-pizza-${size.key}`).value) || size.price,
  }));
  const payload = {
    ...settings,
    pizza_sizes: JSON.stringify(pizzaSizes),
  };
  try {
    settings = state.apiOnline
      ? await api("/api/settings", { method: "POST", body: JSON.stringify(payload) })
      : { ...settings, pizza_sizes: JSON.stringify(pizzaSizes) };
    updatePizzaSizesFromSettings();
    byId("pizza-prices-message").textContent = "Preços salvos.";
    byId("pizza-prices-message").classList.remove("form-error");
    renderCustomerStore();
  } catch (error) {
    byId("pizza-prices-message").textContent = "Não foi possível salvar.";
    byId("pizza-prices-message").classList.add("form-error");
  }
}

async function saveIntegrations() {
  const payload = {
    payment_provider: byId("integration-payment-provider").value,
    pix_key: byId("integration-pix-key").value,
    payment_token: byId("integration-payment-token").value,
    whatsapp_number: byId("integration-whatsapp-number").value,
    stock_whatsapp: byId("integration-stock-whatsapp").value,
    whatsapp_token: byId("integration-whatsapp-token").value,
    phone_number_id: byId("integration-phone-number-id") ? byId("integration-phone-number-id").value : "",
    gps_interval: byId("integration-gps-interval").value,
    domain: byId("integration-domain").value,
    deploy_db: String(byId("deploy-db").checked),
    deploy_env: String(byId("deploy-env").checked),
    deploy_https: String(byId("deploy-https").checked),
    evolution_url: byId("integration-evolution-url").value.trim(),
    evolution_instance: byId("integration-evolution-instance").value.trim(),
    evolution_apikey: byId("integration-evolution-apikey").value.trim(),
  };
  try {
    settings = state.apiOnline
      ? await api("/api/settings", { method: "POST", body: JSON.stringify(payload) })
      : { ...settings, ...payload };
    byId("integrations-message").textContent = "Integrações salvas.";
    showToast("Configurações de integração salvas.");
  } catch (error) {
    byId("integrations-message").textContent = "Não foi possível salvar.";
  }
}

async function resetUserPin(userId) {
  if (!can("settings")) return;
  try {
    const updated = state.apiOnline
      ? await api(`/api/users/${userId}/reset-pin`, { method: "PATCH" })
      : demoUsers.find((user) => user.id === userId);
    demoUsers = demoUsers.map((user) => (Number(user.id) === Number(userId) ? { ...user, ...updated } : user));
    renderTeamUsers();
    showToast(`PIN resetado. Novo PIN: ${updated.default_pin || "0000"}`);
  } catch (error) {
    showToast(error.message || "Não foi possível resetar o PIN.");
  }
}

async function saveNewPin() {
  const currentPin = byId("current-pin").value.trim();
  const newPin = byId("new-pin").value.trim();
  const confirmPin = byId("confirm-new-pin").value.trim();
  byId("pin-message").textContent = "";
  if (!/^\d{4,6}$/.test(newPin)) {
    byId("pin-message").textContent = "Use 4 a 6 números.";
    return;
  }
  if (newPin !== confirmPin) {
    byId("pin-message").textContent = "A confirmação não confere.";
    return;
  }
  try {
    const updated = state.apiOnline
      ? await api(`/api/users/${state.currentUser.id}/pin`, {
          method: "PATCH",
          body: JSON.stringify({ current_pin: currentPin, new_pin: newPin }),
        })
      : { ...state.currentUser, must_change_pin: 0 };
    state.currentUser = { ...state.currentUser, ...updated };
    localStorage.setItem("bortoliniUser", JSON.stringify(state.currentUser));
    byId("pin-dialog").close();
    byId("current-pin").value = "";
    byId("new-pin").value = "";
    byId("confirm-new-pin").value = "";
    renderAccess();
    showToast("PIN atualizado.");
  } catch (error) {
    byId("pin-message").textContent = error.message || "Não foi possível atualizar o PIN.";
  }
}

async function recoverAdminAccess() {
  const masterKey = byId("recover-master-key").value;
  const newPin = byId("recover-new-pin").value.trim();
  byId("recover-admin-message").textContent = "";
  if (!masterKey || !/^\d{4,6}$/.test(newPin)) {
    byId("recover-admin-message").textContent = "Preencha chave mestra e novo PIN com 4 a 6 números.";
    return;
  }
  try {
    await api("/api/admin/recover", {
      method: "POST",
      body: JSON.stringify({ master_key: masterKey, new_pin: newPin }),
    });
    byId("recover-admin-dialog").close();
    byId("login-user").value = "adm";
    byId("login-pin").value = newPin;
    byId("recover-master-key").value = "";
    byId("recover-new-pin").value = "";
    showToast("PIN do adm redefinido.");
  } catch (error) {
    byId("recover-admin-message").textContent = error.message || "Não foi possível recuperar o adm.";
  }
}

async function shareRealLocation() {
  if (!deliveries.length) {
    showToast("Não há entrega em rota para atualizar.");
    return;
  }
  if (!navigator.geolocation) {
    showToast("GPS indisponível neste navegador.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const target = deliveries[0];
      const payload = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      try {
        const updated = state.apiOnline
          ? await api(`/api/deliveries/${target.id}/location`, { method: "PATCH", body: JSON.stringify(payload) })
          : { ...target, driver_lat: payload.lat, driver_lng: payload.lng, last_location_at: new Date().toISOString() };
        deliveries = deliveries.map((delivery) => (delivery.id === target.id ? updated : delivery));
        renderDelivery();
        renderDriverApp();
        showToast("Localização real atualizada no pedido em rota.");
      } catch (error) {
        showToast("Não foi possível salvar a localização.");
      }
    },
    () => {
      showToast("Permissão de GPS negada. Ative o GPS e tente novamente.");
    },
    { enableHighAccuracy: true, timeout: 8000 },
  );
}

function showToast(message) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), 4200);
}

function switchView(viewId) {
  const permission = document.querySelector(`[data-view="${viewId}"]`)?.dataset.permission || viewId;
  if (!can(permission)) {
    const fallback = firstAllowedView();
    if (fallback && fallback !== viewId) {
      switchView(fallback);
    }
    return;
  }

  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active-view"));
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
  byId(viewId).classList.add("active-view");
  document.querySelector(`[data-view="${viewId}"]`)?.classList.add("active");
  byId("view-title").textContent = document.querySelector(`[data-view="${viewId}"]`)?.textContent.trim() || "Bortolini";
  // Renderizar entregas quando aba Entregas for ativada
  if (viewId === "delivery") {
    setTimeout(() => renderDelivery(), 150);
  }
}

function firstAllowedView() {
  const item = [...document.querySelectorAll("[data-view]")].find((button) => can(button.dataset.permission));
  return item?.dataset.view || "orders";
}

function exportOrders() {
  if (!can("exportOrders")) return;

  const header = "pedido,cliente,canal,status,total,pagamento";
  const rows = filteredOrders().map((order) =>
    [order.id, order.customer, order.channel, order.status, order.total, order.payment || "Não informado"]
      .map(csvValue)
      .join(","),
  );
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "pedidos-bortolini.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function downloadCsv(filename, header, rows) {
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportStock() {
  if (!can("inventory")) return;
  downloadCsv(
    "estoque-bortolini.csv",
    "ingrediente,unidade,estoque,minimo,custo,fornecedor",
    ingredients.map((ingredient) =>
      [ingredient.name, ingredient.unit, ingredient.stock_qty, ingredient.min_qty, ingredient.unit_cost || 0, ingredient.supplier || ""].map(csvValue).join(","),
    ),
  );
}

function exportProducts() {
  if (!can("menu")) return;
  downloadCsv(
    "produtos-bortolini.csv",
    "produto,categoria,preco,ativo,descricao,tamanho,preparo,adicionais",
    menuItems.map((item) =>
      [item.name, item.category, item.price, item.active ? "ativo" : "pausado", item.description || "", item.size || "", item.prep_time || "", item.addons || ""].map(csvValue).join(","),
    ),
  );
}

function exportPayments() {
  if (!can("payments")) return;
  downloadCsv(
    "caixa-bortolini.csv",
    "pedido,cliente,total,pagamento,status_pagamento,status_pedido,comprovante",
    orders.map((order) =>
      [order.id, order.customer, order.total, order.payment || "", order.payment_status || "", order.status, order.payment_receipt_status || ""].map(csvValue).join(","),
    ),
  );
}

function exportReport() {
  if (!can("reports")) return;
  const rows = [
    ...profitReport.map((row) => ["lucro", row.item_name, row.quantity, row.revenue, row.cost, row.profit].map(csvValue).join(",")),
    ...orders.map((order) => ["pedido", order.item, 1, order.total, "", ""].map(csvValue).join(",")),
  ];
  downloadCsv("relatorio-bortolini.csv", "tipo,item,quantidade,receita,custo,lucro", rows);
}

function copyQrLink() {
  const url = customerOrderUrl();
  navigator.clipboard?.writeText(url);
  showToast("Link do cardápio copiado.");
}

function copyWhatsAppLink() {
  const phone = String(settings.whatsapp_number || settings.stock_whatsapp || "").replace(/\D/g, "");
  if (!phone) { showToast("Configure o número WhatsApp primeiro."); return; }
  const url = `https://wa.me/${phone}`;
  navigator.clipboard?.writeText(url);
  showToast("Link do WhatsApp copiado.");
}

function downloadQrCode() {
  const url = customerOrderUrl();
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=720x720&margin=18&data=${encodeURIComponent(url)}`;
  const link = document.createElement("a");
  link.href = qrUrl;
  link.download = "qr-cardapio-bortolini.png";
  link.target = "_blank";
  link.click();
}

function goToDigitalMenu() {
  byId("digital-menu-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function callPizzeriaWhatsApp() {
  const phone = String(settings.whatsapp_number || "").replace(/\D/g, "");
  const message = "Olá! Vim pelo cardápio digital e gostaria de fazer um pedido.";
  navigator.clipboard?.writeText(message);
  if (phone) {
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank");
    return;
  }
  showToast("Cadastre o número oficial do WhatsApp em Integrações.");
}

function csvValue(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function renderAll() {
  updateConnectionBadge();
  renderAccess();
  renderMetrics();
  renderOrders();
  renderLiveOrders();
  renderChannels();
  renderKitchen();
  renderMenu();
  renderCustomerStore();
  renderInbox();
  renderDelivery();
  renderDeliveryManager();
  renderPayments();
  renderReports();
  renderInventory();
  renderCustomers();
  renderDriverApp();
  renderSettings();
  renderIntegrations();
}

function updateConnectionBadge() {
  const badge = byId("connection-badge");
  const statusText = byId("connection-status-text");
  if (!badge) return;
  if (state.apiOnline) {
    badge.className = "connection-badge online";
    badge.textContent = "Ao vivo";
    if (statusText) statusText.textContent = "Restaurante conectado";
  } else {
    badge.className = "connection-badge offline";
    badge.textContent = "Demo local";
    if (statusText) statusText.textContent = "Modo demonstração";
  }
}

function renderAccess() {
  if (!state.currentUser) return;

  byId("current-user-name").textContent = state.currentUser.name;
  byId("current-user-role").textContent = roleLabels[state.currentUser.role] || state.currentUser.role;
  byId("new-order-btn").classList.toggle("hidden", !can("createOrder"));
  byId("export-orders").classList.toggle("hidden", !can("exportOrders"));
  byId("new-product-btn").classList.toggle("hidden", !can("menu"));
  byId("new-promotion-btn").classList.toggle("hidden", !can("menu"));

  document.querySelectorAll("[data-permission]").forEach((button) => {
    button.classList.toggle("hidden", !can(button.dataset.permission));
  });

  document.querySelectorAll("[data-view-jump]").forEach((button) => {
    const target = document.querySelector(`[data-view="${button.dataset.viewJump}"]`);
    button.classList.toggle("hidden", target ? !can(target.dataset.permission) : true);
  });
}

function renderDemoUsers() {
  const fallbackProfiles = [
    { username: "adm", name: "adm", role: "admin", default_pin: "3725" },
    { username: "financeiro", name: "Financeiro", role: "financeiro", default_pin: "3702" },
  ];
  const profiles = demoUsers.length ? demoUsers : fallbackProfiles;
  byId("demo-users").innerHTML = profiles
    .map(
      (user) => `
        <button class="profile-button" data-demo-user="${user.username}" data-demo-pin="${user.default_pin || "1234"}">
          <strong>${roleLabels[user.role] || user.name}</strong>
          <small>${user.username} · PIN: ${user.default_pin || "1234"}</small>
        </button>
      `,
    )
    .join("");

  document.querySelectorAll("[data-demo-pin]").forEach((button) => {
    button.addEventListener("click", () => {
      byId("login-user").value = button.dataset.demoUser;
      byId("login-pin").value = button.dataset.demoPin;
      login();
    });
  });
}

async function login() {
  const username = byId("login-user").value.trim().toLowerCase();
  const pin = byId("login-pin").value.trim();
  byId("login-error").textContent = "";

  if (!username || !pin) return;

  try {
    if (state.apiOnline) {
      state.currentUser = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ usuario: username, pin }),
      });
    } else {
      const user = demoUsers.find((candidate) => candidate.username === username && pin === "1234");
      if (!user) throw new Error("Login inválido");
      state.currentUser = { ...user, token: `demo-${user.role}` };
    }
    localStorage.setItem("bortoliniUser", JSON.stringify(state.currentUser));
    showApp();
  } catch (error) {
    byId("login-error").textContent = "Usuário ou PIN inválido.";
  }
}

function isPublicPage() {
  const hash = window.location.hash;
  const path = window.location.pathname;
  const search = window.location.search;
  if (hash.startsWith("#pedir")) return true;
  if (search.includes("driver_id=") || path.startsWith("/entregador")) return true;
  const urlParams = new URLSearchParams(search);
  const trackId = urlParams.get("pedido") || urlParams.get("order_id");
  if (trackId && !isNaN(Number(trackId))) return true;
  return false;
}

function restoreSession() {
  // Não restaurar sessão admin/financeiro na página do entregador
  if (window.location.pathname.startsWith("/entregador")) return;
  try {
    const saved = JSON.parse(localStorage.getItem("bortoliniUser"));
    if (saved?.role && saved?.username) {
      if (!["admin", "financeiro", "entregador"].includes(saved.role)) {
        localStorage.removeItem("bortoliniUser");
        return;
      }
      state.currentUser = saved;
      showApp();
      return;
    }
  } catch (error) {
    localStorage.removeItem("bortoliniUser");
  }
  if (isPublicPage()) return;
  byId("login-screen").classList.remove("hidden");
  byId("app-shell").classList.add("hidden");
}

function showApp() {
  byId("login-screen").classList.add("hidden");
  byId("app-shell").classList.remove("hidden");
  renderAll();
  switchView(firstAllowedView());
  if (Number(state.currentUser?.must_change_pin)) {
    byId("current-pin").value = byId("login-pin").value;
    byId("pin-dialog").showModal();
  }
  startPolling();
}

function logout() {
  // Invalidar sessão no servidor se online
  if (state.apiOnline && state.currentUser?.token) {
    api("/api/logout", { method: "POST" }).catch(() => {});
  }
  localStorage.removeItem("bortoliniUser");
  // Limpar carrinho ao sair
  localStorage.removeItem("bortolini_cart");
  cart = [];
  stopPolling();
  state.currentUser = null;
  byId("login-screen").classList.remove("hidden");
  byId("app-shell").classList.add("hidden");
  byId("login-user").value = "";
  byId("login-pin").value = "";
}

// --- Polling automático de pedidos (30s) ---
let _pollingInterval = null;

function startPolling() {
  if (_pollingInterval) return;
  _pollingInterval = setInterval(async () => {
    if (!state.currentUser || !state.apiOnline) return;
    try {
      const [newOrders, newDeliveries] = await Promise.all([
        api("/api/orders"),
        api("/api/deliveries"),
      ]);
      const hasNewOrder = newOrders.length > orders.length ||
        newOrders.some((o, i) => o.status !== orders[i]?.status);
      orders = newOrders;
      deliveries = newDeliveries;
      state.apiOnline = true;
      updateConnectionBadge();
      renderOrders();
      renderLiveOrders();
      renderKitchen();
      renderMetrics();
      renderDelivery();
      renderDeliveryManager();
      if (hasNewOrder) {
        showToast("🔔 Pedidos atualizados");
        playNotificationSound();
      }
    } catch (_) {}
  }, 30_000);
}

function stopPolling() {
  if (_pollingInterval) {
    clearInterval(_pollingInterval);
    _pollingInterval = null;
  }
}

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch (_) {}
}

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

document.querySelectorAll("[data-view-jump]").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.viewJump));
});

byId("global-search")?.addEventListener("input", (event) => {
  state.search = event.target.value;
  renderOrders();
});

byId("order-filter")?.addEventListener("click", (event) => {
  if (!event.target.dataset.filter) return;
  state.filter = event.target.dataset.filter;
  document.querySelectorAll("#order-filter button").forEach((button) => button.classList.remove("active"));
  event.target.classList.add("active");
  renderOrders();
});

byId("new-order-btn")?.addEventListener("click", () => {
  internalOrderItems = [];
  renderOrderProductOptions();
  renderInternalOrderItems();
  updateOrderDeliveryMode();
  byId("order-dialog").showModal();
});
byId("new-product-btn")?.addEventListener("click", () => {
  editingProductId = null;
  productPhotoData = "";
  byId("product-name").value = "";
  byId("product-category").value = "";
  byId("product-description").value = "";
  byId("product-size").value = "";
  byId("product-prep").value = "";
  byId("product-addons").value = "";
  byId("product-price").value = "";
  byId("product-photo").value = "";
  byId("product-photo-preview").classList.add("hidden");
  byId("create-product").textContent = "Criar produto";
  byId("product-dialog").showModal();
});
byId("new-promotion-btn")?.addEventListener("click", () => {
  editingPromotionId = null;
  byId("promotion-title").value = "";
  byId("promotion-value").value = "";
  byId("create-promotion").textContent = "Lançar promoção";
  document.querySelectorAll('[name="promo-channel"]').forEach((input) => {
    input.checked = input.value === "Cardápio QR" || input.value === "WhatsApp";
  });
  byId("promotion-dialog").showModal();
});
byId("menu-category-filter")?.addEventListener("change", (event) => {
  state.menuCategory = event.target.value;
  renderMenu();
});
byId("create-order")?.addEventListener("click", createOrder);
byId("add-order-item")?.addEventListener("click", addInternalOrderItem);
byId("order-category")?.addEventListener("change", (event) => {
  state.orderCategory = event.target.value;
  renderOrderProductOptions();
});
byId("order-delivery-type")?.addEventListener("change", updateOrderDeliveryMode);
byId("create-product")?.addEventListener("click", createProduct);
byId("create-promotion")?.addEventListener("click", createPromotion);
byId("floating-cart-btn")?.addEventListener("click", openCartReview);
byId("cart-review-continue")?.addEventListener("click", () => {
  byId("cart-review-dialog").close();
  openCheckoutDialog();
});
byId("dialog-checkout-btn")?.addEventListener("click", checkoutCart);
byId("dialog-checkout-type")?.addEventListener("change", (event) => {
  const addressLabel = byId("dialog-address-label");
  if (addressLabel) {
    addressLabel.style.display = event.target.value === "Entrega" ? "" : "none";
  }
  const subtotal = cartTotal();
  const fee = event.target.value === "Entrega" ? getDeliveryFee(byId("dialog-checkout-address")?.value) : 0;
  byId("checkout-dialog-total").textContent = `Total: ${currency.format(subtotal + fee)}`;
});
byId("dialog-checkout-address")?.addEventListener("input", (event) => {
  if (byId("dialog-checkout-type")?.value === "Entrega") {
    const fee = getDeliveryFee(event.target.value);
    byId("checkout-dialog-total").textContent = `Total: ${currency.format(cartTotal() + fee)}`;
  }
});
byId("track-order-btn")?.addEventListener("click", trackOrderV2);
byId("export-orders")?.addEventListener("click", exportOrders);
byId("export-stock")?.addEventListener("click", exportStock);
byId("export-payments")?.addEventListener("click", exportPayments);
byId("export-products")?.addEventListener("click", exportProducts);
byId("export-report")?.addEventListener("click", exportReport);
byId("copy-qr-link")?.addEventListener("click", copyQrLink);
byId("download-qr-code")?.addEventListener("click", downloadQrCode);
byId("copy-whatsapp-link")?.addEventListener("click", copyWhatsAppLink);
byId("go-to-menu")?.addEventListener("click", goToDigitalMenu);
byId("call-pizzeria")?.addEventListener("click", callPizzeriaWhatsApp);
byId("print-kitchen")?.addEventListener("click", printKitchenTickets);
byId("logout-btn")?.addEventListener("click", logout);
byId("save-settings-btn")?.addEventListener("click", saveSettings);
byId("save-pizza-prices-btn")?.addEventListener("click", savePizzaSizePrices);
byId("save-integrations-btn")?.addEventListener("click", saveIntegrations);
byId("save-pin-btn")?.addEventListener("click", saveNewPin);
byId("copy-driver-created-link")?.addEventListener("click", () => {
  const link = byId("driver-created-link").value;
  navigator.clipboard?.writeText(link);
  showToast("Link do entregador copiado.");
});
byId("recover-admin-btn")?.addEventListener("click", () => byId("recover-admin-dialog").showModal());
byId("recover-admin-save")?.addEventListener("click", recoverAdminAccess);
byId("close-product-dialog")?.addEventListener("click", () => byId("order-dialog")?.close());
byId("close-product-dialog-2")?.addEventListener("click", () => byId("product-dialog")?.close());
byId("close-pin-dialog")?.addEventListener("click", () => byId("pin-dialog")?.close());
byId("close-recover-admin-dialog")?.addEventListener("click", () => byId("recover-admin-dialog")?.close());
byId("close-promotion-dialog")?.addEventListener("click", () => byId("promotion-dialog")?.close());
byId("close-cancel-dialog")?.addEventListener("click", () => byId("cancel-dialog")?.close());
byId("create-zone-btn")?.addEventListener("click", saveDeliveryZone);
byId("cancel-zone-btn")?.addEventListener("click", cancelZoneEdit);
byId("pizza-flavors-dialog-add")?.addEventListener("click", addPizzaFromFlavorsDialog);
byId("pizza-flavors-dialog-crust")?.addEventListener("change", updatePizzaFlavorsDialogPrice);

// Event delegation para tabs da loja pública (evita listeners duplicados)
document.querySelector(".store-tabs")?.addEventListener("click", (e) => {
  const tab = e.target.closest(".store-tab");
  if (!tab) return;
  document.querySelectorAll(".store-tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".store-tab-content").forEach((c) => { c.classList.remove("active"); c.classList.remove("hidden"); });
  tab.classList.add("active");
  byId(`store-tab-${tab.dataset.tab}`)?.classList.add("active");
});

byId("create-driver-btn")?.addEventListener("click", createDriver);
byId("confirm-cancel")?.addEventListener("click", confirmCancelOrder);
byId("create-ingredient-btn")?.addEventListener("click", createIngredient);
byId("add-recipe-row")?.addEventListener("click", addRecipeRow);
byId("recipe-item")?.addEventListener("change", () => renderRecipeRows(true));
byId("save-recipe-btn")?.addEventListener("click", saveRecipeIngredient);
byId("share-location-btn")?.addEventListener("click", () => {
  shareRealLocation();
});
// Checkout movido para dialog (estilo iFood)
byId("calc-item")?.addEventListener("change", renderIngredientCalculator);
byId("calc-qty")?.addEventListener("input", renderIngredientCalculator);

document.querySelectorAll("[data-template]").forEach((button) => {
  button.addEventListener("click", () => copyWhatsAppTemplate(button.dataset.template));
});

document.querySelectorAll("[data-inbox-mode]").forEach((button) => {
  button.addEventListener("click", async () => {
    const active = conversations[state.conversation];
    if (!active?.id) return;
    const mode = button.dataset.inboxMode;
    const assignedTo = mode === "ai" ? "" : state.currentUser?.name || "Atendente";
    try {
      const updated = await api(`/api/inbox/${active.id}/mode`, {
        method: "POST",
        body: JSON.stringify({ mode, assigned_to: assignedTo }),
      });
      conversations = conversations.map((conversation) => (conversation.id === updated.id ? updated : conversation));
      renderInbox();
      showToast(`Modo alterado para ${inboxModeLabel(mode)}.`);
    } catch (error) {
      showToast(error.message || "Nao foi possivel alterar o modo.");
    }
  });
});

byId("finance-filter")?.addEventListener("click", (event) => {
  if (!event.target.dataset.finance) return;
  state.financeFilter = event.target.dataset.finance;
  document.querySelectorAll("#finance-filter button").forEach((button) => button.classList.remove("active"));
  event.target.classList.add("active");
  renderPayments();
});

byId("customer-filter-name")?.addEventListener("input", (event) => {
  state.customerNameFilter = event.target.value;
  renderCustomers();
});

byId("customer-filter-phone")?.addEventListener("input", (event) => {
  state.customerPhoneFilter = event.target.value;
  renderCustomers();
});

byId("customer-filter-address")?.addEventListener("input", (event) => {
  state.customerAddressFilter = event.target.value;
  renderCustomers();
});

byId("customer-filter-min-orders")?.addEventListener("input", (event) => {
  state.customerMinOrders = Number(event.target.value || 0);
  renderCustomers();
});

byId("login-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  login();
});

byId("product-photo")?.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  productPhotoData = "";
  byId("product-photo-preview").classList.add("hidden");
  byId("product-photo-preview").style.backgroundImage = "";
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    productPhotoData = reader.result;
    byId("product-photo-preview").style.backgroundImage = `url("${productPhotoData}")`;
    byId("product-photo-preview").classList.remove("hidden");
  });
  reader.readAsDataURL(file);
});

// Upload de comprovante PIX após pedido já existe via pix-receipt-input

if (byId("send-reply")) byId("send-reply")?.addEventListener("click", async () => {
  const input = byId("reply-input");
  const text = input.value.trim();
  if (!text) return;
  const active = conversations[state.conversation];
  input.disabled = true;
  try {
    if (state.apiOnline && active?.id) {
      const updated = await api(`/api/inbox/${active.id}/reply`, {
        method: "POST",
        body: JSON.stringify({
          text,
          author: active.mode === "human" ? "agent" : "client",
        }),
      });
      conversations = await api("/api/inbox");
      const nextIndex = conversations.findIndex((conversation) => conversation.id === updated.id);
      state.conversation = nextIndex >= 0 ? nextIndex : 0;
    } else if (active) {
      if (active.mode === "human") {
        active.messages.push(["agent", text]);
      } else {
        active.messages.push(["client", text]);
        active.messages.push(["ai", "Recebi sua mensagem. Quando o servidor estiver online, eu respondo usando cardapio, entrega e pedidos."]);
      }
    }
    input.value = "";
    renderInbox();
  } catch (error) {
    showToast(error.message || "Nao foi possivel gerar resposta da IA.");
  } finally {
    input.disabled = false;
    input.focus();
  }
});

loadData().then(() => {
  renderDemoUsers();
  restoreSession();
  renderCustomerStore();
});

byId("pix-receipt-input")?.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  window._pixReceiptData = "";
  byId("pix-receipt-preview").classList.add("hidden");
  byId("pix-receipt-preview").style.backgroundImage = "";
  byId("pix-upload-error").textContent = "";
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    window._pixReceiptData = reader.result;
    if (file.type.startsWith("image/")) {
      byId("pix-receipt-preview").style.backgroundImage = `url("${window._pixReceiptData}")`;
      byId("pix-receipt-preview").textContent = "";
    } else {
      byId("pix-receipt-preview").textContent = file.name;
    }
    byId("pix-receipt-preview").classList.remove("hidden");
  });
  reader.readAsDataURL(file);
});

// ── App público do entregador ──────────────────────────────────────────
let _driverLocationInterval = null;
let _driverUserId = null;
let _driverCurrentOrderIds = [];
let _driverToken = null;

function showDriverLogin() {
  byId("driver-login-screen").classList.remove("hidden");
  byId("driver-recover-screen").classList.add("hidden");
  byId("driver-orders-screen").classList.add("hidden");
}
function showDriverRecover() {
  byId("driver-login-screen").classList.add("hidden");
  byId("driver-recover-screen").classList.remove("hidden");
  byId("driver-orders-screen").classList.add("hidden");
}
function showDriverOrders() {
  byId("driver-login-screen").classList.add("hidden");
  byId("driver-recover-screen").classList.add("hidden");
  byId("driver-orders-screen").classList.remove("hidden");
}

async function driverPublicLogin() {
  const cpf = byId("driver-login-cpf").value.trim();
  const pin = byId("driver-login-pin").value.trim();
  byId("driver-login-error").textContent = "";
  if (!cpf || !pin) return;
  try {
    const data = await fetch("/api/public/driver/login", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ cpf, pin })
    }).then(r => { if (!r.ok) throw new Error("login invalido"); return r.json(); });
    _driverUserId = data.id;
    _driverToken = data.token;
    localStorage.setItem("bortoliniDriver", JSON.stringify({ id: data.id, token: data.token, name: data.name }));
    byId("driver-public-name").textContent = data.name || "Entregador";
    showDriverOrders();
    loadDriverPublicOrders();
    startDriverOrdersPoll();
  } catch(e) {
    byId("driver-login-error").textContent = "CPF ou PIN invalido.";
  }
}

async function driverPublicRecover() {
  const cpf = byId("driver-recover-cpf").value.trim();
  const master = byId("driver-recover-master").value;
  const newPin = byId("driver-recover-newpin").value.trim();
  byId("driver-recover-error").textContent = "";
  if (!cpf || !master || !/^\d{4,6}$/.test(newPin)) {
    byId("driver-recover-error").textContent = "Preencha todos os campos corretamente.";
    return;
  }
  try {
    await fetch("/api/public/driver/recover", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ cpf, master_key: master, new_pin: newPin })
    }).then(r => { if (!r.ok) throw new Error("erro"); return r.json(); });
    byId("driver-recover-screen").classList.add("hidden");
    byId("driver-login-screen").classList.remove("hidden");
    byId("driver-login-cpf").value = cpf;
    byId("driver-login-pin").value = newPin;
    showToast("PIN redefinido! Faca login com o novo PIN.");
  } catch(e) {
    byId("driver-recover-error").textContent = "Erro ao redefinir. Verifique CPF e chave mestra.";
  }
}

function driverPublicLogout() {
  localStorage.removeItem("bortoliniDriver");
  _driverUserId = null;
  _driverToken = null;
  _driverCurrentOrderIds = [];
  stopDriverOrdersPoll();
  if (_driverLocationInterval !== null) {
    navigator.geolocation.clearWatch(_driverLocationInterval);
    _driverLocationInterval = null;
  }
  showDriverLogin();
}

function initDriverPublicPage() {
  const page = byId("driver-public-page");
  if (!page) return;
  page.classList.remove("hidden");
  byId("login-screen")?.classList.add("hidden");
  byId("app-shell")?.classList.add("hidden");
  document.querySelector(".app-layout") && document.querySelector(".app-layout").classList.add("hidden");

  // Verifica se ja tem sessao salva
  try {
    const saved = JSON.parse(localStorage.getItem("bortoliniDriver"));
    if (saved?.id && saved?.token) {
      _driverUserId = saved.id;
      _driverToken = saved.token;
      byId("driver-public-name").textContent = saved.name || "Entregador";
      showDriverOrders();
      loadDriverPublicOrders();
      startDriverOrdersPoll();
      return;
    }
  } catch(e) {}

  showDriverLogin();
}

let _driverOrdersPoll = null;

function startDriverOrdersPoll() {
  if (_driverOrdersPoll) return;
  _driverOrdersPoll = setInterval(() => {
    if (_driverUserId) loadDriverPublicOrders();
  }, 15000);
}

function stopDriverOrdersPoll() {
  if (_driverOrdersPoll) {
    clearInterval(_driverOrdersPoll);
    _driverOrdersPoll = null;
  }
}

async function loadDriverPublicOrders() {
  if (!_driverUserId) { console.log("[loadDriverPublicOrders] sem _driverUserId"); return; }
  try {
    console.log("[loadDriverPublicOrders] buscando pedidos para userId", _driverUserId);
    const res = await fetch(`/api/public/driver/${_driverUserId}`, {
      headers: _driverToken ? {"Authorization": `Bearer ${_driverToken}`} : {}
    });
    if (!res.ok) { console.error("[loadDriverPublicOrders] erro HTTP", res.status); return; }
    const data = await res.json();
    console.log("[loadDriverPublicOrders] recebido", data.orders?.length || 0, "pedidos");
    byId("driver-public-name").textContent = data.driver_name || "Entregador";
    const list = byId("driver-public-orders");
    const emptyState = byId("driver-empty-state");

    if (!data.orders || data.orders.length === 0) {
      list.innerHTML = "";
      list.classList.add("hidden");
      emptyState.classList.remove("hidden");
      _driverCurrentOrderIds = [];
      return;
    }

    list.classList.remove("hidden");
    emptyState.classList.add("hidden");

    list.innerHTML = data.orders.map(order => {
      const phone = String(order.customer_phone || "").replace(/\D/g, "");
      const whatsappLink = phone ? `https://wa.me/55${phone}` : "";
      const mapsLink = order.address ? `https://maps.google.com/?q=${encodeURIComponent(order.address)}` : "";
      const isStart = order.status === "Entrega";
      const isDeliver = order.status === "Saiu para entrega";

      return `
      <article class="driver-order-card" style="border:1px solid #e0e0e0;border-radius:12px;padding:16px;margin:12px 0;background:#fff;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong style="font-size:1.1rem;">Pedido #${order.id}</strong>
          <span style="padding:4px 10px;border-radius:20px;background:${isStart?'#fff3e0;color:#e65100':isDeliver?'#e8f5e9;color:#2e7d32':'#f5f5f5;color:#666'};font-size:0.85rem;font-weight:600;">${escapeHtml(order.status)}</span>
        </div>
        <div style="font-weight:600;margin-bottom:4px;">${escapeHtml(order.customer)}</div>
        <div style="color:#666;font-size:0.9rem;margin-bottom:8px;">${escapeHtml(order.address || "Sem endereço")}</div>
        <div style="color:#333;font-size:0.9rem;margin-bottom:8px;">${escapeHtml(order.item)}</div>
        <div style="font-weight:700;color:#1a1a1a;font-size:1.1rem;margin-bottom:12px;">${currency.format(Number(order.total || 0))}</div>
        
        <div style="margin-bottom:12px;">
          ${mapsLink ? `<a href="${mapsLink}" target="_blank" rel="noopener" style="display:block;padding:10px;background:#e3f2fd;color:#1565c0;border-radius:8px;text-decoration:none;font-weight:600;margin-bottom:8px;text-align:center;">📍 Abrir endereço no Google Maps</a>` : ""}
          ${whatsappLink ? `<a href="${whatsappLink}" target="_blank" rel="noopener" style="display:block;padding:10px;background:#e8f5e9;color:#2e7d32;border-radius:8px;text-decoration:none;font-weight:600;text-align:center;">💬 Falar com cliente no WhatsApp</a>` : ""}
        </div>
        
        ${isStart ? `<button onclick="driverStartDelivery(${order.id})" style="width:100%;padding:14px;background:#ff6b00;color:#fff;border:none;border-radius:10px;font-size:1.1rem;font-weight:700;cursor:pointer;">🚀 INICIAR ENTREGA</button>` : ""}
        ${isDeliver ? `<button onclick="if(!confirm('Tem certeza que a entrega foi realizada?'))return;driverMarkDelivered(${order.id})" style="width:100%;padding:14px;background:#00c853;color:#fff;border:none;border-radius:10px;font-size:1.1rem;font-weight:700;cursor:pointer;">✅ CONFIRMAR ENTREGA REALIZADA</button>` : ""}
      </article>
    `;}).join("");

    _driverCurrentOrderIds = data.orders.map(o => o.id);
  } catch(e) {
    console.error("[loadDriverPublicOrders] erro", e);
    byId("driver-public-orders").innerHTML = '<p style="padding:1rem;color:#dc2626;text-align:center;">Erro ao carregar pedidos. Tente recarregar.</p>';
  }
}

async function driverMarkDelivered(orderId) {
  const btn = byId(`driver-deliver-${orderId}`);
  if (btn) { btn.disabled = true; btn.textContent = "Enviando..."; }
  try {
    await fetch(`/api/public/driver/orders/${orderId}/deliver`, {
      method: "PATCH",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ status: "Entregue" })
    });
    showToast("✅ Pedido entregue!");
    loadDriverPublicOrders();
  } catch(e) {
    showToast("Erro ao atualizar pedido.");
    if (btn) { btn.disabled = false; btn.textContent = "✅ Entrega realizada"; }
  }
}

async function driverStartDelivery(orderId) {
  const btn = byId(`driver-start-${orderId}`);
  if (btn) { btn.disabled = true; btn.textContent = "Iniciando..."; }
  try {
    await fetch(`/api/public/driver/orders/${orderId}/start`, {
      method: "PATCH",
      headers: {"Content-Type": "application/json", ...(_driverToken ? {"Authorization": `Bearer ${_driverToken}`} : {})},
      body: JSON.stringify({ status: "Saiu para entrega" })
    });
    showToast("🚀 Entrega iniciada!");
    loadDriverPublicOrders();
  } catch(e) {
    showToast("Erro ao iniciar entrega.");
    if (btn) { btn.disabled = false; btn.textContent = "🚀 Iniciar entrega"; }
  }
}

function toggleDriverLocation() {
  if (_driverLocationInterval !== null) {
    // Parar
    navigator.geolocation.clearWatch(_driverLocationInterval);
    _driverLocationInterval = null;
    const icon = byId("driver-bar-gps-icon");
    if (icon) icon.textContent = "📍";
    const status = byId("driver-header-status");
    if (status) { status.textContent = "Offline"; status.classList.add("offline"); }
    showToast("Localização pausada");
  } else {
    // Iniciar
    if (!navigator.geolocation) { showToast("GPS não disponível."); return; }
    const icon = byId("driver-bar-gps-icon");
    if (icon) icon.textContent = "📡";
    const status = byId("driver-header-status");
    if (status) { status.textContent = "Online"; status.classList.remove("offline"); }

    function sendLocation(pos) {
      const { latitude: lat, longitude: lng } = pos.coords;
      _driverCurrentOrderIds.forEach(orderId => {
        fetch(`/api/deliveries/${orderId}/location`, {
          method: "PATCH",
          headers: {"Content-Type": "application/json", ...(_driverToken ? {"Authorization": `Bearer ${_driverToken}`} : {})},
          body: JSON.stringify({ lat, lng })
        }).catch(() => {});
      });
      if (_driverUserId) {
        fetch(`/api/public/drivers/${_driverUserId}/location`, {
          method: "PATCH",
          headers: {"Content-Type": "application/json", ...(_driverToken ? {"Authorization": `Bearer ${_driverToken}`} : {})},
          body: JSON.stringify({ lat, lng })
        }).catch(() => {});
      }
    }

    _driverLocationInterval = navigator.geolocation.watchPosition(
      sendLocation,
      () => { showToast("⚠️ Erro ao obter GPS."); },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );
    showToast("Localização ativa");
  }
}

function driverStopLocation() {
  if (_driverLocationInterval !== null) {
    navigator.geolocation.clearWatch(_driverLocationInterval);
    _driverLocationInterval = null;
  }
}

async function registerDriver() {
  const name = byId("driver-reg-name").value.trim();
  const phone = byId("driver-reg-phone").value.trim();
  const errEl = byId("driver-reg-error");
  errEl.textContent = "";
  if (!name) { errEl.textContent = "Informe seu nome."; return; }
  try {
    const data = await fetch("/api/public/drivers/register", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ name, phone })
    }).then(r => r.json());
    byId("driver-register-dialog").close();
    showToast(`Cadastro realizado! Seu PIN inicial é ${data.default_pin}. Guarde-o. Link: /entregador?driver_id=${data.user_id}`);
    _driverUserId = data.user_id;
    initDriverPublicPage();
  } catch(e) {
    errEl.textContent = "Erro ao cadastrar. Tente outro nome.";
  }
}

async function loadOrderTrack(orderId) {
  const details = byId("track-order-details");
  const pixSection = byId("track-pix-section");
  const mapSection = byId("track-map-section");
  const statusPill = byId("track-status-pill");
  details.innerHTML = "<p>Carregando dados do pedido...</p>";
  pixSection.classList.add("hidden");
  mapSection.classList.add("hidden");
  try {
    const order = await api(`/api/public/orders/${orderId}`);
    statusPill.textContent = order.status;
    statusPill.className = `status-pill ${order.status === "Cancelado" ? "danger" : order.status === "Finalizado" ? "success" : ""}`;
    details.innerHTML = `
      <article class="cart-item">
        <strong>Pedido #${order.id}</strong>
        <p>${order.item}</p>
        <p>Total: ${currency.format(order.total)} · Pagamento: ${order.payment}</p>
        <p>Previsão: ${order.eta}</p>
        ${order.notes ? `<p>Obs: ${order.notes}</p>` : ""}
      </article>
      <div class="status-timeline" style="margin:12px 0;">${renderOrderTimeline(order.status)}</div>
    `;
    if (order.payment === "PIX" && order.payment_receipt_status !== "Enviado") {
      pixSection.classList.remove("hidden");
      window._trackOrderId = orderId;
      window._trackPixData = "";
    }
    if ((order.status === "Entrega" || order.status === "Saiu para entrega") && order.driver_lat && order.driver_lng) {
      mapSection.classList.remove("hidden");
      byId("track-location-info").textContent = `Entregador: ${order.driver_name || "Em rota"} · atualizado ${order.last_location_at ? new Date(order.last_location_at).toLocaleTimeString("pt-BR") : "agora"}`;
      byId("track-map-link").href = `https://www.google.com/maps/search/?api=1&query=${order.driver_lat},${order.driver_lng}`;
      const mapContainer = byId("track-map-area");
      if (typeof L !== "undefined" && mapContainer) {
        if (!window._trackMap) {
          window._trackMap = L.map(mapContainer).setView([Number(order.driver_lat), Number(order.driver_lng)], 15);
          L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: '&copy; OpenStreetMap contributors',
            maxZoom: 19,
          }).addTo(window._trackMap);
        } else {
          window._trackMap.setView([Number(order.driver_lat), Number(order.driver_lng)], 15);
        }
        if (window._trackMarker) window._trackMap.removeLayer(window._trackMarker);
        window._trackMarker = L.marker([Number(order.driver_lat), Number(order.driver_lng)]).addTo(window._trackMap);
        window._trackMarker.bindPopup(`<strong>${escapeHtml(order.driver_name || "Entregador")}</strong><br>Pedido #${order.id}`).openPopup();
        setTimeout(() => window._trackMap.invalidateSize(), 300);
      }
    }
  } catch(e) {
    details.innerHTML = `<p style="color:var(--danger)">Pedido não encontrado.</p>`;
  }
}

async function sendTrackPixComprovante() {
  const orderId = window._trackOrderId;
  const receiptData = window._trackPixData;
  const errEl = byId("track-pix-error");
  errEl.textContent = "";
  if (!receiptData) { errEl.textContent = "Selecione o comprovante."; return; }
  try {
    await api(`/api/public/orders/${orderId}/comprovante`, {
      method: "POST",
      body: JSON.stringify({ comprovante: receiptData }),
    });
    byId("track-pix-sent-msg").classList.remove("hidden");
    byId("track-pix-send-btn").disabled = true;
    loadOrderTrack(orderId);
  } catch(e) {
    errEl.textContent = "Erro ao enviar comprovante.";
  }
}

byId("track-back-btn")?.addEventListener("click", () => {
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active-view"));
  byId("customer").classList.add("active-view");
  document.querySelector(".app-layout")?.classList.remove("hidden");
  history.replaceState(null, "", window.location.pathname);
});

byId("track-pix-receipt-input")?.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  window._trackPixData = "";
  byId("track-pix-receipt-preview").classList.add("hidden");
  byId("track-pix-receipt-preview").style.backgroundImage = "";
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    window._trackPixData = reader.result;
    byId("track-pix-receipt-preview").style.backgroundImage = `url("${reader.result}")`;
    byId("track-pix-receipt-preview").classList.remove("hidden");
  });
  reader.readAsDataURL(file);
});

byId("track-pix-send-btn")?.addEventListener("click", sendTrackPixComprovante);

// Inicializar app do entregador se URL tiver driver_id
if (window.location.search.includes("driver_id=") || window.location.pathname.startsWith("/entregador")) {
  document.addEventListener("DOMContentLoaded", initDriverPublicPage);
}

// Inicializar acompanhamento de pedido se URL tiver pedido ou order_id
const urlParams = new URLSearchParams(window.location.search);
const trackOrderId = urlParams.get("pedido") || urlParams.get("order_id");
if (trackOrderId && !isNaN(Number(trackOrderId))) {
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".view").forEach((view) => view.classList.remove("active-view"));
    byId("order-track").classList.add("active-view");
    document.querySelector(".app-layout")?.classList.add("hidden");
    loadOrderTrack(Number(trackOrderId));
  });
}

// Modo público do cardápio (cliente acessa via link #pedir)
function initCustomerPublicMode() {
  // Não interferir com app do entregador
  const path = window.location.pathname;
  const search = window.location.search;
  if (path.startsWith("/entregador") || search.includes("driver_id=")) return;

  const hash = window.location.hash;
  const hashParams = new URLSearchParams(hash.replace(/^#pedir\?/, ""));
  const trackId = hashParams.get("pedido");

  if (hash.startsWith("#pedir")) {
    document.body.classList.add("public-customer-mode");
    byId("login-screen").classList.add("hidden");
    byId("app-shell").classList.remove("hidden");
    document.querySelectorAll(".view").forEach((view) => view.classList.remove("active-view"));
    byId("customer").classList.add("active-view");
    renderCustomerStore();
    // Se vier com pedido na URL, preenche e consulta automaticamente
    if (trackId && byId("track-order-id")) {
      byId("track-order-id").value = trackId;
      setTimeout(() => trackOrderV2(), 500);
    }
  }
}

function handleHashChange() {
  initCustomerPublicMode();
  // Se não é página pública e não está logado, mostrar login
  if (!isPublicPage() && !state.currentUser?.role) {
    document.body.classList.remove("public-customer-mode");
    byId("login-screen").classList.remove("hidden");
    byId("app-shell").classList.add("hidden");
  }
}

window.addEventListener("hashchange", handleHashChange);
document.addEventListener("DOMContentLoaded", initCustomerPublicMode);
