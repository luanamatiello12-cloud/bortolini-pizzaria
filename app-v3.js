const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

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
      ...(state.currentUser?.token ? { "Authorization": `Bearer ${state.currentUser.token}` } : {}),
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
    ...late.map((order) => [`Pedido atrasado`, `#${order.id} - ${order.item} - ${orderAge(order)} min`]),
    ...pendingPix.map((order) => [`PIX pendente`, `#${order.id} - ${order.customer} - ${currency.format(order.total)}`]),
    ...lowStock.map((ingredient) => [`Estoque no mínimo`, `${ingredient.name}: ${Number(ingredient.stock_qty).toLocaleString("pt-BR")} ${ingredient.unit}`]),
  ];
  box.innerHTML = alerts.length
    ? alerts.slice(0, 8).map(([title, detail]) => `<article class="best-item"><strong>${title}</strong><span>${detail}</span></article>`).join("")
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
              ${renderPhoto(getItemImage(order.item), "order-photo", order.item)}
              <div>${order.customer}<br><small>${order.item}${order.driver_name ? ` · ${order.driver_name} em rota` : ""}${order.payment_receipt_url ? " · comprovante anexado" : ""}</small></div>
            </div>
          </td>
          <td>${order.channel}<br><small>${order.delivery_type || "Entrega"}</small></td>
          <td><span class="status-pill">${order.status}</span></td>
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
            <strong>#${order.id} · ${order.customer}</strong>
            <p>${order.item} via ${order.channel}</p>
          </div>
          <span class="status-pill">${order.status}</span>
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
  const categoryFilter = byId("menu-category-filter");
  if (categoryFilter) {
    const categories = ["Todos", ...new Set(menuItems.map((item) => item.category).filter(Boolean))];
    const current = categories.includes(state.menuCategory) ? state.menuCategory : "Todos";
    state.menuCategory = current;
    categoryFilter.innerHTML = categories.map((category) => `<option value="${category}" ${category === current ? "selected" : ""}>${category}</option>`).join("");
  }

  byId("menu-items").innerHTML = menuItems
    .filter((item) => state.menuCategory === "Todos" || item.category === state.menuCategory)
    .map(
      (item) => `
        <article class="menu-card">
          ${renderPhoto(item.image_url, "menu-photo", item.name)}
          <strong>${item.name}<span>${currency.format(item.price)}</span></strong>
          <p>${item.category}${item.size ? ` - ${item.size}` : ""} - ${item.sales} vendas</p>
          ${item.description ? `<p>${item.description}</p>` : ""}
          <p>${item.prep_time ? `Preparo: ${item.prep_time}` : "Preparo nao informado"}${item.addons ? ` - Adicionais: ${item.addons}` : ""}</p>
          ${Number(item.cost) > 0 ? `<p style="color:var(--accent);font-weight:600;">Custo: ${currency.format(item.cost)} · Margem: ${item.margin_percent || 0}%</p>` : ""}
          <button class="ghost" data-edit-product="${item.id}">Editar</button>
          <button class="ghost" data-toggle-product="${item.id}">${item.active ? "Pausar" : "Ativar"}</button>
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
  document.querySelectorAll("[data-edit-promotion]").forEach((button) => {
    button.addEventListener("click", () => openPromotionEditor(Number(button.dataset.editPromotion)));
  });
  document.querySelectorAll("[data-toggle-promotion]").forEach((button) => {
    button.addEventListener("click", () => togglePromotion(Number(button.dataset.togglePromotion)));
  });
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
              </div>
            </article>
          `,
        )
        .join("")
    : `<article class="ingredient-card empty-card"><strong>Nenhum ingrediente cadastrado</strong><p>Use o formulario acima para criar o primeiro item de estoque.</p></article>`;

  byId("recipes-list").innerHTML = recipes.length
    ? recipes
        .map(
          (recipe) => `
            <article class="ingredient-card recipe-row">
              <div>
                <small>Produto</small>
                <strong>${recipe.item_name}</strong>
              </div>
              <div>
                <small>Consome por unidade</small>
                <strong>${Number(recipe.quantity).toLocaleString("pt-BR")} ${recipe.unit}</strong>
                <p>${recipe.ingredient_name}</p>
              </div>
            </article>
          `,
        )
        .join("")
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
  if (!conversations.length) {
    byId("conversation-list").innerHTML = `<article class="empty-card"><strong>Nenhuma conversa</strong><p>As mensagens dos canais digitais aparecem aqui.</p></article>`;
    byId("chat-client").textContent = "Atendimento IA";
    byId("chat-channel").textContent = "Sem conversa";
    byId("inbox-mode-label").textContent = "Sem conversa";
    byId("messages").innerHTML = `<div class="message ai">Digite uma mensagem do cliente para testar a resposta automatica.</div>`;
    return;
  }
  if (state.conversation >= conversations.length) state.conversation = 0;
  byId("conversation-list").innerHTML = conversations
    .map(
      (conversation, index) => `
        <button class="conversation-button ${index === state.conversation ? "active" : ""}" data-conversation="${index}">
          <strong>${conversation.client}</strong>
          <p>${conversation.channel} - ${inboxModeLabel(conversation.mode)}</p>
          <small>${conversation.preview}</small>
        </button>
      `,
    )
    .join("");

  const active = conversations[state.conversation];
  byId("chat-client").textContent = active.client;
  byId("chat-channel").textContent = active.assigned_to ? `${active.channel} - ${active.assigned_to}` : active.channel;
  byId("inbox-mode-label").textContent = inboxModeLabel(active.mode);
  byId("reply-input").placeholder = active.mode === "human"
    ? "Digite a resposta do atendente"
    : active.mode === "assisted"
      ? "Digite a mensagem do cliente para gerar sugestao"
      : "Digite a mensagem do cliente para a IA responder";
  document.querySelectorAll("[data-inbox-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.inboxMode === active.mode);
  });
  byId("messages").innerHTML = active.messages
    .map(([author, text]) => `<div class="message ${author === "ai" ? "ai" : author === "agent" ? "agent" : author === "system" ? "system" : ""}">${text}</div>`)
    .join("");

  document.querySelectorAll("[data-conversation]").forEach((button) => {
    button.addEventListener("click", () => {
      state.conversation = Number(button.dataset.conversation);
      renderInbox();
    });
  });
  renderInboxQrPanel();
}

function renderDelivery() {
  byId("drivers").innerHTML = drivers
    .map(
      (driver) => `
        <article class="driver-card">
          <strong>${driver.name}</strong>
          <p>${driver.status} · ${driver.orders} pedido(s) · ${driver.area}</p>
        </article>
      `,
    )
    .join("");

  byId("active-deliveries").innerHTML = deliveries.length
    ? deliveries
        .map(
          (delivery) => `
            <article class="driver-card">
              <strong>#${delivery.id} · ${delivery.customer}</strong>
              <p>${delivery.item} · ${delivery.driver_name || "Sem entregador"}</p>
              <p class="location-line">${formatLocation(delivery)}</p>
            </article>
          `,
        )
        .join("")
    : `
      <article class="driver-card">
        <strong>Nenhuma entrega ativa</strong>
        <p>Quando um pedido entrar em Entrega, a localização aparece aqui.</p>
      </article>
    `;

  const activeDrivers = drivers.filter((d) => d.active);
  const driverPins = activeDrivers.map((driver, index) => {
    const point = mapPoint(driver.lat, driver.lng, index);
    const inRoute = deliveries.some((d) => d.driver_name === driver.name);
    return `
      <div class="map-pin ${inRoute ? "driver-pin" : "driver-idle-pin"}" style="left:${point.left}%; top:${point.top}%">
        <strong>${driver.name}</strong>
        <small>${inRoute ? "Em rota" : "Disponível"}</small>
      </div>
    `;
  }).join("");

  const deliveryPins = deliveries
    .map((delivery, index) => {
      const driver = mapPoint(delivery.driver_lat, delivery.driver_lng, index);
      const destination = destinationPoint(index);
      return `
        <div class="map-pin driver-pin" style="left:${driver.left}%; top:${driver.top}%">
          <strong>${delivery.driver_name || "Entregador"}</strong>
          <small>Pedido #${delivery.id}</small>
        </div>
        <div class="map-pin destination-pin" style="left:${destination.left}%; top:${destination.top}%">
          <strong>Destino</strong>
          <small>${delivery.customer}</small>
        </div>
      `;
    })
    .join("");

  byId("delivery-map").innerHTML = driverPins + deliveryPins;
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
  return `Localização: ${lat}, ${lng} · atualizado agora`;
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
  byId("store-hours").textContent = `${settings.opening_hours || "18:00 às 23:30"} · entrega ${currency.format(Number(settings.delivery_fee || 0))} · preparo ${settings.prep_time || "35 a 45 minutos"}`;
  renderQrPanel();
  byId("store-products").innerHTML = menuItems
    .filter((item) => item.active)
    .map((item) => {
      const promo = promotions.find((promotion) => promotion.item_name === item.name && promotion.active);
      return `
        <article class="menu-card">
          ${renderPhoto(item.image_url, "menu-photo", item.name)}
          <strong>${item.name}<span>${currency.format(item.price)}</span></strong>
          <p>${item.category}${promo ? ` · ${formatDiscount(promo)}` : ""}</p>
          <button class="primary" data-add-cart="${item.id}">Adicionar</button>
        </article>
      `;
    })
    .join("");

  document.querySelectorAll("[data-add-cart]").forEach((button) => {
    button.addEventListener("click", () => addToCart(Number(button.dataset.addCart)));
  });
  renderCart();
}

function renderCart() {
  byId("cart-items").innerHTML = cart.length
    ? cart
        .map(
          (entry) => `
            <article class="cart-item">
              <strong>${entry.qty}x ${entry.name}</strong>
              <p>${currency.format(entry.price * entry.qty)}</p>
            </article>
          `,
        )
        .join("")
    : `<article class="cart-item"><strong>Carrinho vazio</strong><p>Adicione pizzas e bebidas para finalizar.</p></article>`;
  byId("cart-total").textContent = `Total: ${currency.format(cartTotal())}`;
}

function addToCart(itemId) {
  const item = menuItems.find((current) => current.id === itemId);
  if (!item) return;
  const promo = promotions.find((promotion) => promotion.item_name === item.name && promotion.active);
  const price = promo?.discount_type === "special" ? Number(promo.discount_value) : Number(item.price);
  const existing = cart.find((entry) => entry.id === item.id);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ id: item.id, name: item.name, price, qty: 1 });
  }
  saveCart();
  renderCart();
  // Esconder confirmação PIX se o cliente adicionar novo item depois de um pedido
  const pixBox = byId("pix-confirmation");
  if (pixBox && !pixBox.classList.contains("hidden")) {
    pixBox.classList.add("hidden");
    byId("checkout-btn").classList.remove("hidden");
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
  const subtotal = cart.reduce((sum, entry) => sum + entry.price * entry.qty, 0);
  const addon = addonPrice(byId("checkout-addon")?.value);
  const fee = byId("checkout-type")?.value === "Entrega" ? Number(zoneForAddress(byId("checkout-address")?.value)?.fee || settings.delivery_fee || 0) : 0;
  return subtotal + addon + fee;
}

function addonPrice(addon) {
  return addon === "Borda recheada" ? 8 : addon === "Extra queijo" ? 6 : 0;
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
              <button class="ghost" data-toggle-zone="${zone.id}">${zone.active ? "Pausar" : "Ativar"}</button>
            </article>
          `,
        )
        .join("")
    : `<article class="ingredient-card"><strong>Sem bairros</strong><p>Cadastre taxas por região.</p></article>`;
  document.querySelectorAll("[data-toggle-zone]").forEach((button) => {
    button.addEventListener("click", () => toggleDeliveryZone(Number(button.dataset.toggleZone)));
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

async function createDeliveryZone() {
  const payload = {
    neighborhood: byId("zone-neighborhood").value.trim(),
    fee: Number(byId("zone-fee").value || 0),
    eta: byId("zone-eta").value.trim() || "35 a 45 minutos",
    active: 1,
  };
  if (!payload.neighborhood) return;
  try {
    const created = state.apiOnline
      ? await api("/api/delivery-zones", { method: "POST", body: JSON.stringify(payload) })
      : { ...payload, id: Date.now() };
    deliveryZones = [...deliveryZones, created];
    byId("zone-neighborhood").value = "";
    byId("zone-fee").value = "";
    byId("zone-eta").value = "";
    renderDeliveryZones();
  } catch (error) {
    showToast("Nao foi possivel cadastrar o bairro.");
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

async function checkoutCart() {
  byId("checkout-error").textContent = "";
  const stockBeforeCheckout = [...ingredients];
  if (!cart.length) {
    byId("checkout-error").textContent = "Adicione pelo menos um item.";
    return;
  }
  const customer = byId("checkout-name").value.trim();
  if (!customer) {
    byId("checkout-error").textContent = "Informe seu nome.";
    return;
  }
  if (!pixReceiptData) {
    byId("checkout-error").textContent = "Anexe o comprovante do PIX para finalizar o pedido.";
    return;
  }
  const payload = {
    customer,
    customer_phone: byId("checkout-phone").value.trim(),
    address: byId("checkout-address").value.trim(),
    notes: [byId("checkout-notes").value.trim(), byId("checkout-addon").value ? `Adicional: ${byId("checkout-addon").value}` : ""].filter(Boolean).join(" | "),
    delivery_type: byId("checkout-type").value,
    channel: "Cardápio QR",
    status: "Novo",
    item: `${cart.map((entry) => `${entry.qty}x ${entry.name}`).join(" + ")}${byId("checkout-addon").value ? ` + ${byId("checkout-addon").value}` : ""}`,
    items: cart.map((entry) => ({
      name: entry.name,
      qty: entry.qty,
      price: entry.price,
    })),
    total: cartTotal(),
    payment: byId("checkout-payment").value,
    payment_receipt_url: byId("checkout-payment").value === "PIX" ? (pixReceiptData || "") : "",
    eta: settings.prep_time || "35 min",
    delivery_fee: byId("checkout-type").value === "Entrega" ? Number(zoneForAddress(byId("checkout-address").value)?.fee || settings.delivery_fee || 0) : 0,
    discount: 0,
  };
  try {
    const created = state.apiOnline
      ? await api("/api/orders", { method: "POST", body: JSON.stringify(payload) })
      : { ...payload, id: Math.max(...orders.map((order) => order.id), 0) + 1 };
    orders = [created, ...orders];
    customers = state.apiOnline ? await api("/api/customers") : [{ name: customer, phone: payload.customer_phone, address: payload.address, notes: payload.notes }, ...customers];
    ingredients = state.apiOnline ? await api("/api/ingredients") : ingredients;
    stockMovements = state.apiOnline ? await api("/api/stock-movements") : stockMovements;
    profitReport = state.apiOnline ? await api("/api/profit-report") : profitReport;
    notifyNewLowStock(stockBeforeCheckout, "pedido online");
    cart = [];
    saveCart();
    pixReceiptData = "";
    byId("checkout-receipt").value = "";
    byId("receipt-preview").classList.add("hidden");
    renderAll();

    const trackLink = `${window.location.origin}${window.location.pathname}?pedido=${created.id}`;
    byId("checkout-btn").classList.add("hidden");
    byId("track-order-result").innerHTML = `
      <article class="cart-item">
        <strong>✅ Pedido #${created.id} recebido!</strong>
        <p>${payload.item} · ${currency.format(payload.total)}</p>
        <p><a href="${trackLink}" target="_blank">🔗 Acompanhar pedido</a></p>
      </article>
    `;
    byId("track-order-result").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    byId("checkout-error").textContent = error.message || "Não foi possível finalizar o pedido.";
  }
}

function copyPix() {
  const cnpj = "66.686.680/0001-57";
  navigator.clipboard.writeText(cnpj).then(() => {
    const btn = byId("pix-copy-btn");
    btn.textContent = "Copiado!";
    setTimeout(() => { btn.textContent = "Copiar"; }, 2000);
  }).catch(() => {
    showToast("Chave PIX: 66.686.680/0001-57");
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
    byId("pix-upload-section") && byId("pix-receipt-input").closest("div") && (byId("pix-receipt-input").disabled = true);
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
      : payload;
    byId("settings-message").textContent = "Configurações salvas.";
    renderCustomerStore();
  } catch (error) {
    byId("settings-message").textContent = "Não foi possível salvar.";
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
    simulateDriverMovement();
    showToast("GPS indisponível neste navegador. Usei a simulação.");
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
      simulateDriverMovement();
      showToast("Permissão de GPS negada. Usei a simulação.");
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
  if (hash === "#pedir") return true;
  if (search.includes("driver_id=") || path.startsWith("/entregador")) return true;
  const urlParams = new URLSearchParams(search);
  const trackId = urlParams.get("pedido") || urlParams.get("order_id");
  if (trackId && !isNaN(Number(trackId))) return true;
  return false;
}

function restoreSession() {
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
byId("checkout-btn")?.addEventListener("click", checkoutCart);
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
byId("save-integrations-btn")?.addEventListener("click", saveIntegrations);
byId("save-pin-btn")?.addEventListener("click", saveNewPin);
byId("copy-driver-created-link")?.addEventListener("click", () => {
  const link = byId("driver-created-link").value;
  navigator.clipboard?.writeText(link);
  showToast("Link do entregador copiado.");
});
byId("recover-admin-btn")?.addEventListener("click", () => byId("recover-admin-dialog").showModal());
byId("recover-admin-save")?.addEventListener("click", recoverAdminAccess);
byId("create-zone-btn")?.addEventListener("click", createDeliveryZone);
byId("create-driver-btn")?.addEventListener("click", createDriver);
byId("confirm-cancel")?.addEventListener("click", confirmCancelOrder);
byId("create-ingredient-btn")?.addEventListener("click", createIngredient);
byId("add-recipe-row")?.addEventListener("click", addRecipeRow);
byId("recipe-item")?.addEventListener("change", () => renderRecipeRows(true));
byId("save-recipe-btn")?.addEventListener("click", saveRecipeIngredient);
byId("share-location-btn")?.addEventListener("click", () => {
  shareRealLocation();
});
byId("checkout-type")?.addEventListener("change", renderCart);
byId("checkout-address")?.addEventListener("input", renderCart);
byId("checkout-addon")?.addEventListener("change", renderCart);
// Pagamento sempre PIX, campo de comprovante sempre visível
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

byId("checkout-receipt")?.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  pixReceiptData = "";
  byId("receipt-preview").classList.add("hidden");
  byId("receipt-preview").style.backgroundImage = "";
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    pixReceiptData = reader.result;
    if (file.type.startsWith("image/")) {
      byId("receipt-preview").style.backgroundImage = `url("${pixReceiptData}")`;
      byId("receipt-preview").textContent = "";
    } else {
      byId("receipt-preview").textContent = file.name;
    }
    byId("receipt-preview").classList.remove("hidden");
  });
  reader.readAsDataURL(file);
});

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
  setInterval(simulateDriverMovement, 7000);
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
let _driverCurrentOrderId = null;
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
    byId("driver-public-name").textContent = `Ola, ${data.name}! 🛵`;
    showDriverOrders();
    loadDriverPublicOrders();
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
  document.querySelector(".app-layout") && document.querySelector(".app-layout").classList.add("hidden");
  
  // Verifica se ja tem sessao salva
  try {
    const saved = JSON.parse(localStorage.getItem("bortoliniDriver"));
    if (saved?.id && saved?.token) {
      _driverUserId = saved.id;
      _driverToken = saved.token;
      byId("driver-public-name").textContent = `Ola, ${saved.name || "Entregador"}! 🛵`;
      showDriverOrders();
      loadDriverPublicOrders();
      return;
    }
  } catch(e) {}
  
  showDriverLogin();
}

async function loadDriverPublicOrders() {
  if (!_driverUserId) return;
  try {
    const data = await fetch(`/api/public/driver/${_driverUserId}`, {
      headers: _driverToken ? {"Authorization": `Bearer ${_driverToken}`} : {}
    }).then(r => r.json());
    byId("driver-public-name").textContent = `Ola, ${data.driver_name || "Entregador"}! 🛵`;
    const list = byId("driver-public-orders");
    if (!data.orders || data.orders.length === 0) {
      list.innerHTML = '<p style="padding:1rem;color:var(--muted)">Nenhuma entrega ativa no momento.</p>';
      return;
    }
    list.innerHTML = data.orders.map(order => `
      <div class="driver-order-card">
        <div class="driver-order-header">
          <strong>Pedido #${order.id}</strong>
          <span class="status-pill">${order.status}</span>
        </div>
        <p><strong>Cliente:</strong> ${order.customer}</p>
        <p><strong>Endereço:</strong> ${order.address || "Não informado"}</p>
        <p><strong>Itens:</strong> ${order.item}</p>
        <p><strong>Total:</strong> R$ ${Number(order.total).toFixed(2)}</p>
        <div class="driver-order-actions">
          <a class="secondary btn-sm" href="https://maps.google.com/?q=${encodeURIComponent(order.address || '')}" target="_blank">📍 Ver no mapa</a>
          <button class="primary btn-sm" onclick="driverMarkDelivered(${order.id})">✅ Marcar entregue</button>
        </div>
      </div>
    `).join('');
    _driverCurrentOrderId = data.orders[0]?.id || null;
  } catch(e) {
    byId("driver-public-orders").innerHTML = '<p style="padding:1rem;color:var(--danger)">Erro ao carregar pedidos.</p>';
  }
}

async function driverMarkDelivered(orderId) {
  try {
    await fetch(`/api/public/driver/orders/${orderId}/deliver`, {
      method: "PATCH",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ status: "Entregue" })
    });
    showToast("Pedido marcado como entregue!");
    loadDriverPublicOrders();
  } catch(e) {
    showToast("Erro ao atualizar pedido.");
  }
}

function driverShareLocation() {
  if (!navigator.geolocation) { showToast("GPS não disponível."); return; }
  byId("driver-share-location-btn").classList.add("hidden");
  byId("driver-stop-location-btn").classList.remove("hidden");
  byId("driver-location-status").textContent = "📍 Compartilhando localização...";

  function sendLocation(pos) {
    const { latitude: lat, longitude: lng } = pos.coords;
    byId("driver-location-status").textContent = `📍 Localização ativa: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    if (_driverCurrentOrderId) {
      fetch(`/api/deliveries/${_driverCurrentOrderId}/location`, {
        method: "PATCH",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ lat, lng })
      }).catch(() => {});
    }
    // Atualiza localização do entregador independente de pedido
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
    () => { byId("driver-location-status").textContent = "⚠️ Erro ao obter GPS."; },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
  );
}

function driverStopLocation() {
  if (_driverLocationInterval !== null) {
    navigator.geolocation.clearWatch(_driverLocationInterval);
    _driverLocationInterval = null;
  }
  byId("driver-share-location-btn").classList.remove("hidden");
  byId("driver-stop-location-btn").classList.add("hidden");
  byId("driver-location-status").textContent = "📍 Localização pausada.";
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
    if (order.status === "Entrega" && order.driver_lat && order.driver_lng) {
      mapSection.classList.remove("hidden");
      byId("track-location-info").textContent = `Entregador: ${order.driver_name || "Em rota"} · atualizado ${order.last_location_at ? new Date(order.last_location_at).toLocaleTimeString("pt-BR") : "agora"}`;
      byId("track-map-link").href = `https://www.google.com/maps/search/?api=1&query=${order.driver_lat},${order.driver_lng}`;
      const point = mapPoint(order.driver_lat, order.driver_lng, 0);
      byId("track-map-area").innerHTML = `
        <div class="map-pin driver-pin" style="left:${point.left}%; top:${point.top}%">
          <strong>${order.driver_name || "Entregador"}</strong>
          <small>Pedido #${order.id}</small>
        </div>
      `;
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
  if (window.location.hash === "#pedir") {
    document.body.classList.add("public-customer-mode");
    byId("login-screen").classList.add("hidden");
    byId("app-shell").classList.remove("hidden");
    document.querySelectorAll(".view").forEach((view) => view.classList.remove("active-view"));
    byId("customer").classList.add("active-view");
    renderCustomerStore();
  }
}
window.addEventListener("hashchange", initCustomerPublicMode);
document.addEventListener("DOMContentLoaded", initCustomerPublicMode);
