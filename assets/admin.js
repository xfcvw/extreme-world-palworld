import { SITE_ORIGIN, getSharedSession, supabase } from "/assets/auth.js";
const root = document.querySelector("#admin-root");
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const coins = (value) =>
  new Intl.NumberFormat("pt-BR").format(Number(value || 0));
const inputCoins = (value) =>
  Number(String(value ?? "").replace(/[^0-9]/g, ""));
const roleLabel = (role) =>
  ({
    owner: "Owner",
    admin: "Admin",
    support: "Suporte",
    player: "Cliente / Jogador",
  })[role] || "Cliente / Jogador";
const statusLabel = (s) =>
  ({
    pending_payment: "Aguardando pagamento",
    paid: "Pago",
    awaiting_delivery: "Aguardando entrega",
    in_delivery: "Em entrega",
    delivered: "Entregue",
    cancelled: "Cancelado",
    refunded: "Reembolsado",
  })[s] || s;
const ticketStatusLabel = (status) =>
  ({
    open: "Aberto",
    in_progress: "Em atendimento",
    answered: "Respondido",
    closed: "Fechado",
  })[status] || status;
const ticketCategoryLabel = (category) =>
  category === "purchase" ? "Compra" : "Suporte";
const normalize = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
let ticketConsoleState = {
  query: "",
  category: "all",
  status: "all",
  page: 1,
  selectedId: null,
};
const catalogPaginationState = {
  pals: { page: 1, query: "" },
  armor: { page: 1, query: "" },
  weapons: { page: 1, query: "" },
  resources: { page: 1, query: "" },
};
const activityConsoleState = { server: "all", query: "", page: 1 };
const activityServerLabel = (number) => Number(number) === 2 ? "Com Wipe" : "Sem Wipe";
const activityDate = (value) => value ? new Date(value).toLocaleString("pt-BR") : "Ainda não sincronizado";
const toast = (t) => {
  let el = document.querySelector("#admin-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "admin-toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = t;
  el.hidden = false;
  setTimeout(() => (el.hidden = true), 2600);
};
const storeCategory = (p) =>
  String(p?.category || p?.metadata?.store_category || "").toLowerCase();
const palRequestSummary = (order) => {
  const prefs = order?.order_items?.[0]?.metadata?.pal_preferences;
  if (!prefs) return "";
  const gender =
    { female: "Fêmea", male: "Macho", any: "Sem preferência" }[
      prefs.desired_gender
    ] || "Sem preferência";
  const parts = [`Sexo: ${gender}`];
  if (prefs.desired_passives) parts.push(`Passivas: ${prefs.desired_passives}`);
  if (prefs.delivery_notes) parts.push(`Obs.: ${prefs.delivery_notes}`);
  return parts.join(" · ");
};
async function setDelivery(id, status) {
  const { error } = await supabase.rpc("staff_set_order_delivery_status", {
    p_order_id: id,
    p_status: status,
  });
  if (error) return toast(error.message);
  toast(
    status === "delivered"
      ? "Pedido marcado como entregue."
      : "Pedido movido para entrega.",
  );
  await render();
}
async function updateStoreProduct(key, form) {
  const category = form.dataset.category;
  const isEquipment = ["weapons", "armor"].includes(category);
  const isPal = category === "pals";
  const price = inputCoins(form.querySelector('[name="price"]')?.value);
  const legendaryPrice = inputCoins(
    form.querySelector('[name="legendaryPrice"]')?.value,
  );
  const level80Price = inputCoins(
    form.querySelector('[name="level80Price"]')?.value,
  );
  const level255Price = inputCoins(
    form.querySelector('[name="level255Price"]')?.value,
  );
  if (!isPal && (!Number.isInteger(price) || price < 1))
    return toast("Informe um preço Normal válido em Moedas da Vitória.");
  if (isEquipment && (!Number.isInteger(legendaryPrice) || legendaryPrice < 1))
    return toast("Informe um preço Lendário válido em Moedas da Vitória.");
  if (
    isPal &&
    (!Number.isInteger(level80Price) ||
      level80Price < 1 ||
      !Number.isInteger(level255Price) ||
      level255Price < 1)
  )
    return toast("Informe preços válidos para os níveis 80 e 255.");
  const payload = {
    catalog_key: key,
    victory_coins_price: isPal ? level80Price : price,
    active: form.querySelector('[name="active"]').checked,
  };
  if (isEquipment) {
    payload.equipment_normal_price = price;
    payload.equipment_legendary_price = legendaryPrice;
  }
  if (isPal) {
    payload.pal_level_80_price = level80Price;
    payload.pal_level_255_price = level255Price;
    payload.pal_level_80_active = form.querySelector(
      '[name="level80Active"]',
    ).checked;
    payload.pal_level_255_active = form.querySelector(
      '[name="level255Active"]',
    ).checked;
  }
  const { error } = await supabase
    .from("catalog_price_overrides")
    .upsert(payload, { onConflict: "catalog_key" });
  if (error) return toast(error.message);
  toast("Item da loja atualizado.");
  await render();
}
function renderCatalogCategory(category, items, canManage) {
  const label = {
    pals: "Pals",
    armor: "Armaduras",
    weapons: "Armas",
    resources: "Recursos",
  }[category];
  const rows = items.filter((item) => storeCategory(item) === category);
  return `<section class="admin-catalog-group" id="catalog-${category}"><div class="admin-catalog-group-head"><div><span class="eyebrow cyan">${label.toUpperCase()}</span><h3>${label}</h3><small>${rows.length} item(ns) nesta categoria</small></div><label class="admin-catalog-search">Buscar ${label.toLowerCase()}<input data-catalog-search="${category}" placeholder="Digite um nome"></label></div><div class="store-admin-grid" data-catalog-list="${category}">${
    rows
      .map((product) => {
        const pal = category === "pals",
          equipment = ["weapons", "armor"].includes(category),
          prices = product.metadata?.price_by_level || {},
          levels = product.metadata?.pal_levels_active || {},
          normal =
            product.metadata?.equipment_prices?.normal ??
            (category === "weapons" ? 2 : 3),
          legendary =
            product.metadata?.equipment_prices?.legendary ??
            (category === "weapons" ? 6 : 5);
        return `<form class="store-admin-item" data-store-form="${esc(product.key)}" data-category="${category}" data-catalog-name="${esc(product.name)}"><div><span class="admin-store-kind">${category}</span><b>${esc(product.name)}</b><small>${esc(product.quantityLabel || product.description || "")}</small></div>${pal ? `<label>Preço nível 80 (MV)<input name="level80Price" inputmode="numeric" value="${Number(prices[80] || product.victoryCoins)}" ${canManage ? "" : "disabled"}></label><label>Preço nível 255 (MV)<input name="level255Price" inputmode="numeric" value="${Number(prices[255] || product.victoryCoins)}" ${canManage ? "" : "disabled"}></label><label class="admin-active"><input name="level80Active" type="checkbox" ${levels[80] !== false ? "checked" : ""} ${canManage ? "" : "disabled"}> Nível 80</label><label class="admin-active"><input name="level255Active" type="checkbox" ${levels[255] !== false ? "checked" : ""} ${canManage ? "" : "disabled"}> Nível 255</label>` : equipment ? `<label>Preço normal (MV)<input name="price" inputmode="numeric" value="${Number(normal)}" ${canManage ? "" : "disabled"}></label><label>Preço lendário (MV)<input name="legendaryPrice" inputmode="numeric" value="${Number(legendary)}" ${canManage ? "" : "disabled"}></label>` : `<label>Preço (MV)<input name="price" inputmode="numeric" value="${Number(product.victoryCoins)}" ${canManage ? "" : "disabled"}></label>`}<label class="admin-active"><input name="active" type="checkbox" ${product.active ? "checked" : ""} ${canManage ? "" : "disabled"}> Ativo</label>${canManage ? '<button class="secondary-btn admin-action-btn">Salvar</button>' : '<span class="admin-status">Somente leitura</span>'}</form>`;
      })
      .join("") || '<div class="admin-empty">Nenhum item nesta categoria.</div>'
  }</div></section>`;
}
async function adjustWallet(userId, form) {
  const amount = Math.round(
    Number(form.querySelector('[name="amount"]').value),
  );
  const direction = form.querySelector('[name="direction"]').value;
  const reason = String(
    form.querySelector('[name="reason"]').value || "",
  ).trim();
  if (!Number.isInteger(amount) || amount < 1)
    return toast("Informe uma quantidade válida de MV.");
  if (!reason) return toast("Informe o motivo do ajuste.");
  const session = await getSharedSession();
  if (!session) return toast("Sua sessão expirou.");
  const button = form.querySelector("button");
  button.disabled = true;
  button.textContent = "Salvando...";
  try {
    const response = await fetch("/api/admin-wallet-adjustment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        targetUserId: userId,
        delta: direction === "credit" ? amount : -amount,
        reason,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(data.error || "Não foi possível ajustar a carteira.");
    toast(`Carteira atualizada: ${coins(data.balance)} MV.`);
    await render();
  } catch (error) {
    toast(error.message);
    button.disabled = false;
    button.textContent = "Aplicar ajuste";
  }
}
async function updateRole(userId, form) {
  const role = form.querySelector('[name="role"]').value;
  const session = await getSharedSession();
  if (!session) return toast("Sua sessão expirou.");
  const button = form.querySelector("button");
  button.disabled = true;
  button.textContent = "Salvando...";
  try {
    const response = await fetch("/api/admin-role-assignment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ targetUserId: userId, role }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(data.error || "Não foi possível alterar o cargo.");
    toast(`Cargo alterado para ${roleLabel(data.role)}.`);
    await render();
  } catch (error) {
    toast(error.message);
    button.disabled = false;
    button.textContent = "Salvar cargo";
  }
}
async function updateTicketStatus(ticketId, status) {
  const { error } = await supabase
    .from("support_tickets")
    .update({ status })
    .eq("id", ticketId);
  if (error) return toast(error.message);
  toast("Status do ticket atualizado.");
  await render();
}
async function replyToTicket(ticketId, form) {
  const body = String(form.querySelector('[name="body"]').value || "").trim();
  if (!body) return toast("Escreva uma resposta antes de enviar.");
  const session = await getSharedSession();
  if (!session) return toast("Sua sessão expirou.");
  const button = form.querySelector("button");
  button.disabled = true;
  button.textContent = "Enviando...";
  const { error } = await supabase
    .from("support_ticket_messages")
    .insert({ ticket_id: ticketId, author_id: session.user.id, body });
  if (error) {
    toast(error.message);
    button.disabled = false;
    button.textContent = "Responder";
    return;
  }
  await supabase
    .from("support_tickets")
    .update({ status: "answered" })
    .eq("id", ticketId);
  toast("Resposta enviada ao jogador.");
  await render();
}

function enhanceCatalogPagination(category) {
  const section = document.querySelector(`#catalog-${category}`);
  const list = section?.querySelector(`[data-catalog-list="${category}"]`);
  const search = section?.querySelector(`[data-catalog-search="${category}"]`);
  if (!section || !list || !search) return;

  const items = [...list.querySelectorAll("[data-catalog-name]")];
  if (!items.length) return;
  const state = catalogPaginationState[category];
  const controls = document.createElement("div");
  controls.className = "admin-catalog-pagination";
  list.insertAdjacentElement("afterend", controls);

  const draw = () => {
    const perPage = 12;
    const matchingItems = items.filter((item) =>
      normalize(item.dataset.catalogName).includes(normalize(state.query)),
    );
    const totalPages = Math.max(1, Math.ceil(matchingItems.length / perPage));
    state.page = Math.min(state.page, totalPages);
    const visibleItems = new Set(
      matchingItems.slice((state.page - 1) * perPage, state.page * perPage),
    );
    items.forEach((item) => (item.hidden = !visibleItems.has(item)));
    controls.innerHTML = `<span>${matchingItems.length} resultado${matchingItems.length === 1 ? "" : "s"} · Página ${state.page} de ${totalPages}</span><div><button class="secondary-btn" data-catalog-page="prev" ${state.page === 1 ? "disabled" : ""}>← Anterior</button><button class="secondary-btn" data-catalog-page="next" ${state.page === totalPages ? "disabled" : ""}>Próxima →</button></div>`;
    controls.querySelectorAll("[data-catalog-page]").forEach((button) => {
      button.onclick = () => {
        state.page += button.dataset.catalogPage === "next" ? 1 : -1;
        draw();
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      };
    });
  };

  search.value = state.query;
  search.oninput = (event) => {
    state.query = event.currentTarget.value;
    state.page = 1;
    draw();
  };
  draw();
}

function enhanceActivityConsole(activity) {
  const target = document.querySelector("#player-activity");
  if (!target) return;
  const players = Array.isArray(activity?.players) ? activity.players : [];
  const agents = new Map((activity?.agents || []).map((agent) => [Number(agent.server_number), agent]));
  const summary = new Map((activity?.summary || []).map((item) => [Number(item.serverNumber), item]));
  const draw = () => {
    const matching = players.filter((player) => {
      const text = normalize(`${player.last_known_name} ${player.player_id}`);
      return (activityConsoleState.server === "all" || String(player.server_number) === activityConsoleState.server) && (activityConsoleState.status === "all" || player.decay_status === activityConsoleState.status) && (!activityConsoleState.query || text.includes(normalize(activityConsoleState.query)));
    });
    const perPage = 12, totalPages = Math.max(1, Math.ceil(matching.length / perPage));
    activityConsoleState.page = Math.min(activityConsoleState.page, totalPages);
    const visible = matching.slice((activityConsoleState.page - 1) * perPage, activityConsoleState.page * perPage);
    const header = [1, 2].map((server) => {
      const item = summary.get(server) || { online: 0, attention: 0, critical: 0, total: 0 };
      const agent = agents.get(server);
      const fresh = agent?.last_report_at && Date.now() - new Date(agent.last_report_at).getTime() < 90000;
      return `<article class="activity-summary-card"><span>${activityServerLabel(server).toUpperCase()} · ${server === 1 ? "LIMITE 3 DIAS" : "LIMITE 5 DIAS"}</span><b>${item.online} online</b><small>${item.attention} em atenção · ${item.critical} crítico${item.critical === 1 ? "" : "s"}</small><em class="${fresh ? "fresh" : "stale"}">${fresh ? "● Agente ativo" : "◌ Aguardando agente"}</em></article>`;
    }).join("");
    target.innerHTML = `<div class="profile-section-title"><div><span class="eyebrow cyan">PROTEÇÃO DE BASES</span><h3>Atividade e decay</h3><p class="admin-panel-note">Atenção: 48h no Sem Wipe e 96h no Com Wipe. Crítico: 72h e 120h, respectivamente.</p></div><span class="admin-status">${players.length} jogador${players.length === 1 ? "" : "es"}</span></div><div class="activity-summary-grid">${header}</div><div class="activity-toolbar"><label>Buscar jogador<input data-activity-query placeholder="NickName ou ID"></label><label>Servidor<select data-activity-server><option value="all">Todos</option><option value="1">Sem Wipe</option><option value="2">Com Wipe</option></select></label><label>Status<select data-activity-status><option value="all">Todos</option><option value="online">Online</option><option value="attention">Atenção</option><option value="critical">Próximo do decay</option><option value="normal">Normal</option></select></label></div><div class="activity-list">${visible.length ? visible.map((player) => { const activityAt = player.last_login_at || player.last_seen_at || player.first_seen_at; return `<article class="activity-row"><div><span class="admin-store-kind">${activityServerLabel(player.server_number)}</span><b>${esc(player.last_known_name)}</b><small>ID: ${esc(player.player_id)}</small></div><div><small>Última entrada</small><b>${esc(activityDate(player.last_login_at))}</b><small>${player.last_login_at ? `Há ${activityAge(player.last_login_at)}` : `Visto em ${esc(activityDate(player.last_seen_at))}`}</small></div><div><small>Última saída</small><b>${esc(activityDate(player.last_logout_at))}</b></div><span class="activity-state ${esc(player.decay_status)}">${esc(activityStatusLabel(player.decay_status))}</span></article>`; }).join("") : '<div class="admin-empty">Nenhum jogador encontrado neste filtro. O histórico começa assim que o agente for iniciado.</div>'}</div><div class="activity-pagination"><span>${matching.length} resultado${matching.length === 1 ? "" : "s"} · Página ${activityConsoleState.page} de ${totalPages}</span><div><button class="secondary-btn" data-activity-page="prev" ${activityConsoleState.page === 1 ? "disabled" : ""}>← Anterior</button><button class="secondary-btn" data-activity-page="next" ${activityConsoleState.page === totalPages ? "disabled" : ""}>Próxima →</button></div></div>`;
    const query = target.querySelector("[data-activity-query]"), server = target.querySelector("[data-activity-server]"), status = target.querySelector("[data-activity-status]");
    query.value = activityConsoleState.query; server.value = activityConsoleState.server; status.value = activityConsoleState.status;
    query.oninput = (event) => { activityConsoleState.query = event.target.value; activityConsoleState.page = 1; draw(); };
    server.onchange = (event) => { activityConsoleState.server = event.target.value; activityConsoleState.page = 1; draw(); };
    status.onchange = (event) => { activityConsoleState.status = event.target.value; activityConsoleState.page = 1; draw(); };
    target.querySelectorAll("[data-activity-page]").forEach((button) => button.onclick = () => { activityConsoleState.page += button.dataset.activityPage === "next" ? 1 : -1; draw(); });
  };
  draw();
}

function enhanceSyncConsole(sync, profileByUser) {
  const target = document.querySelector("#player-activity");
  if (!target) return;
  const bindings = Array.isArray(sync?.bindings) ? sync.bindings : [];
  const draw = () => {
    const matching = bindings.filter((binding) => {
      const player = profileByUser.get(binding.user_id);
      const searchText = `${player?.display_name || ""} ${player?.discord_username || ""} ${binding.character_name || ""} ${binding.nickname || ""} ${binding.player_id || ""}`;
      return (activityConsoleState.server === "all" || String(binding.server_number) === activityConsoleState.server) && (!activityConsoleState.query || normalize(searchText).includes(normalize(activityConsoleState.query)));
    });
    const perPage = 12;
    const totalPages = Math.max(1, Math.ceil(matching.length / perPage));
    activityConsoleState.page = Math.min(activityConsoleState.page, totalPages);
    const visible = matching.slice((activityConsoleState.page - 1) * perPage, activityConsoleState.page * perPage);
    target.innerHTML = `<div class="profile-section-title"><div><span class="eyebrow cyan">DADOS DO PORTAL</span><h3>Últimas sincronizações</h3><p class="admin-panel-note">Dados já guardados pelo site quando um personagem é sincronizado. Isso não registra entradas ou saídas no servidor.</p></div><span class="admin-status">${bindings.length} vínculo${bindings.length === 1 ? "" : "s"}</span></div><div class="activity-toolbar"><label>Buscar jogador<input data-sync-query placeholder="Jogador, NickName ou ID"></label><label>Servidor<select data-sync-server><option value="all">Todos</option><option value="1">Sem Wipe</option><option value="2">Com Wipe</option></select></label></div><div class="activity-list">${visible.length ? visible.map((binding) => { const player = profileByUser.get(binding.user_id); const portalName = player?.display_name || player?.discord_username || "Jogador do portal"; return `<article class="activity-row"><div><span class="admin-store-kind">${activityServerLabel(binding.server_number)}</span><b>${esc(binding.character_name || binding.nickname || portalName)}</b><small>${esc(portalName)} · ID: ${esc(binding.player_id)}</small></div><div><small>Última sincronização do site</small><b>${esc(activityDate(binding.last_synced_at))}</b><small>${binding.level != null ? `Nível ${esc(binding.level)}` : "Nível não informado"}${binding.guild ? ` · ${esc(binding.guild)}` : ""}</small></div><div><small>Última conexão informada</small><b>${esc(binding.last_connection || "Não disponível")}</b></div></article>`; }).join("") : '<div class="admin-empty">Nenhum personagem vinculado ao portal neste filtro.</div>'}</div><div class="activity-pagination"><span>${matching.length} resultado${matching.length === 1 ? "" : "s"} · Página ${activityConsoleState.page} de ${totalPages}</span><div><button class="secondary-btn" data-sync-page="prev" ${activityConsoleState.page === 1 ? "disabled" : ""}>← Anterior</button><button class="secondary-btn" data-sync-page="next" ${activityConsoleState.page === totalPages ? "disabled" : ""}>Próxima →</button></div></div>`;
    const query = target.querySelector("[data-sync-query]");
    const server = target.querySelector("[data-sync-server]");
    query.value = activityConsoleState.query;
    server.value = activityConsoleState.server;
    query.oninput = (event) => { activityConsoleState.query = event.target.value; activityConsoleState.page = 1; draw(); };
    server.onchange = (event) => { activityConsoleState.server = event.target.value; activityConsoleState.page = 1; draw(); };
    target.querySelectorAll("[data-sync-page]").forEach((button) => button.onclick = () => { activityConsoleState.page += button.dataset.syncPage === "next" ? 1 : -1; draw(); });
  };
  draw();
}

function enhanceTicketConsole(
  ticketRows,
  ticketMessagesByTicket,
  profileByUser,
) {
  const target = document.querySelector("#tickets");
  if (!target) return;

  const getFilteredTickets = () => {
    const query = normalize(ticketConsoleState.query);
    return ticketRows.filter((ticket) => {
      const owner = profileByUser.get(ticket.user_id);
      const ownerText = `${owner?.display_name || ""} ${owner?.discord_username || ""} ${owner?.palworld_nickname || ""}`;
      return (
        (ticketConsoleState.category === "all" ||
          ticket.category === ticketConsoleState.category) &&
        (ticketConsoleState.status === "all" ||
          ticket.status === ticketConsoleState.status) &&
        (!query ||
          normalize(
            `${ticket.subject} ${ticket.description} ${ownerText}`,
          ).includes(query))
      );
    });
  };

  const draw = () => {
    const filtered = getFilteredTickets();
    const perPage = 20;
    const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
    ticketConsoleState.page = Math.min(ticketConsoleState.page, totalPages);
    const visible = filtered.slice(
      (ticketConsoleState.page - 1) * perPage,
      ticketConsoleState.page * perPage,
    );
    const selected =
      filtered.find((ticket) => ticket.id === ticketConsoleState.selectedId) ||
      visible[0] ||
      null;
    ticketConsoleState.selectedId = selected?.id || null;
    const pendingCount = ticketRows.filter((ticket) =>
      ["open", "in_progress"].includes(ticket.status),
    ).length;
    const selectedOwner = selected ? profileByUser.get(selected.user_id) : null;
    const selectedOwnerName =
      selectedOwner?.display_name ||
      selectedOwner?.discord_username ||
      "Jogador";
    const messages = selected
      ? ticketMessagesByTicket.get(selected.id) || []
      : [];

    target.innerHTML = `<div class="profile-section-title"><div><span class="eyebrow cyan">ATENDIMENTO</span><h3>Central de tickets</h3><p class="admin-panel-note">A fila mantém todos os chamados organizados. Abra apenas o ticket que deseja atender.</p></div><div class="admin-ticket-summary"><span class="admin-status">${pendingCount} em aberto</span><span class="admin-status">${ticketRows.length} total</span></div></div><div class="admin-ticket-toolbar"><label class="admin-ticket-search">Buscar ticket ou jogador<input id="ticket-search" value="${esc(ticketConsoleState.query)}" placeholder="Assunto, jogador ou Discord"></label><label>Categoria<select id="ticket-category-filter"><option value="all">Todas</option><option value="support" ${ticketConsoleState.category === "support" ? "selected" : ""}>Suporte</option><option value="purchase" ${ticketConsoleState.category === "purchase" ? "selected" : ""}>Compra</option></select></label><label>Status<select id="ticket-status-filter"><option value="all">Todos</option><option value="open" ${ticketConsoleState.status === "open" ? "selected" : ""}>Aberto</option><option value="in_progress" ${ticketConsoleState.status === "in_progress" ? "selected" : ""}>Em atendimento</option><option value="answered" ${ticketConsoleState.status === "answered" ? "selected" : ""}>Respondido</option><option value="closed" ${ticketConsoleState.status === "closed" ? "selected" : ""}>Fechado</option></select></label></div><div class="admin-ticket-workspace"><div class="admin-ticket-queue"><div class="admin-ticket-queue-head"><b>${filtered.length} resultado${filtered.length === 1 ? "" : "s"}</b><small>Página ${ticketConsoleState.page} de ${totalPages}</small></div><div class="admin-ticket-queue-list">${
      visible.length
        ? visible
            .map((ticket) => {
              const owner = profileByUser.get(ticket.user_id);
              const ticketMessages =
                ticketMessagesByTicket.get(ticket.id) || [];
              return `<button class="admin-ticket-row ${ticket.id === selected?.id ? "active" : ""}" data-ticket-open="${ticket.id}"><span class="admin-ticket-row-icon">${ticket.category === "purchase" ? "◈" : "✦"}</span><span class="admin-ticket-row-copy"><b>${esc(ticket.subject)}</b><small>${esc(owner?.display_name || owner?.discord_username || "Jogador")} · ${new Date(ticket.created_at).toLocaleString("pt-BR")}</small><em class="ticket-state ${esc(ticket.status)}">${ticketStatusLabel(ticket.status)}</em></span><span class="admin-ticket-row-count">${ticketMessages.length}</span></button>`;
            })
            .join("")
        : '<div class="admin-empty">Nenhum ticket encontrado com estes filtros.</div>'
    }</div><div class="admin-ticket-pagination"><button class="secondary-btn" data-ticket-page="prev" ${ticketConsoleState.page === 1 ? "disabled" : ""}>← Anterior</button><span>${ticketConsoleState.page} / ${totalPages}</span><button class="secondary-btn" data-ticket-page="next" ${ticketConsoleState.page === totalPages ? "disabled" : ""}>Próxima →</button></div></div><article class="admin-ticket-thread">${selected ? `<div class="admin-ticket-detail-head"><div><span class="admin-store-kind ${selected.category === "purchase" ? "purchase" : ""}">${ticketCategoryLabel(selected.category)}</span><h4>${esc(selected.subject)}</h4><p>${esc(selectedOwnerName)} · criado em ${new Date(selected.created_at).toLocaleString("pt-BR")}</p></div><form class="ticket-status-form" data-ticket-status="${selected.id}"><select name="status"><option value="open" ${selected.status === "open" ? "selected" : ""}>Aberto</option><option value="in_progress" ${selected.status === "in_progress" ? "selected" : ""}>Em atendimento</option><option value="answered" ${selected.status === "answered" ? "selected" : ""}>Respondido</option><option value="closed" ${selected.status === "closed" ? "selected" : ""}>Fechado</option></select><button class="secondary-btn admin-action-btn">Salvar</button></form></div><div class="admin-ticket-description"><b>Mensagem inicial</b><p>${esc(selected.description || "Sem descrição informada.")}</p></div><div class="admin-ticket-conversation">${messages.length ? messages.map((message) => `<article class="admin-ticket-message ${message.author_id === selected.user_id ? "player" : "staff"}"><div><b>${message.author_id === selected.user_id ? esc(selectedOwnerName) : "Equipe Extreme"}</b><small>${new Date(message.created_at).toLocaleString("pt-BR")}</small></div><p>${esc(message.body)}</p></article>`).join("") : '<div class="admin-ticket-no-messages">A conversa ainda não possui mensagens.</div>'}</div>${selected.status !== "closed" ? `<form class="admin-ticket-reply" data-ticket-reply="${selected.id}"><textarea name="body" maxlength="2000" placeholder="Responder ao jogador" required></textarea><button class="primary-btn admin-action-btn">Responder <span>→</span></button></form>` : '<p class="admin-ticket-closed">Ticket fechado. Altere o status para reabrir o atendimento.</p>'}` : '<div class="admin-ticket-empty-detail"><span>✦</span><b>Selecione um ticket</b><p>Escolha um chamado na fila ao lado para ver o histórico e responder ao jogador.</p></div>'}</article></div>`;

    target
      .querySelector("#ticket-search")
      ?.addEventListener("input", (event) => {
        ticketConsoleState.query = event.currentTarget.value;
        ticketConsoleState.page = 1;
        ticketConsoleState.selectedId = null;
        draw();
      });
    target
      .querySelector("#ticket-category-filter")
      ?.addEventListener("change", (event) => {
        ticketConsoleState.category = event.currentTarget.value;
        ticketConsoleState.page = 1;
        ticketConsoleState.selectedId = null;
        draw();
      });
    target
      .querySelector("#ticket-status-filter")
      ?.addEventListener("change", (event) => {
        ticketConsoleState.status = event.currentTarget.value;
        ticketConsoleState.page = 1;
        ticketConsoleState.selectedId = null;
        draw();
      });
    target.querySelectorAll("[data-ticket-open]").forEach((button) => {
      button.onclick = () => {
        ticketConsoleState.selectedId = button.dataset.ticketOpen;
        draw();
      };
    });
    target.querySelectorAll("[data-ticket-page]").forEach((button) => {
      button.onclick = () => {
        ticketConsoleState.page +=
          button.dataset.ticketPage === "next" ? 1 : -1;
        ticketConsoleState.selectedId = null;
        draw();
      };
    });
    target.querySelectorAll("[data-ticket-status]").forEach((form) => {
      form.onsubmit = (event) => {
        event.preventDefault();
        updateTicketStatus(
          form.dataset.ticketStatus,
          form.querySelector('[name="status"]').value,
        );
      };
    });
    target.querySelectorAll("[data-ticket-reply]").forEach((form) => {
      form.onsubmit = (event) => {
        event.preventDefault();
        replyToTicket(form.dataset.ticketReply, form);
      };
    });
  };

  draw();
}

async function render() {
  const session = await getSharedSession();
  if (!session) {
    root.innerHTML =
      '<div class="admin-panel"><h3>Acesso restrito</h3><p>Entre pelo portal usando Discord antes de abrir o painel administrativo.</p><button id="admin-login" class="primary-btn">Entrar com Discord</button></div>';
    document.querySelector("#admin-login").onclick = signIn;
    return;
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!["owner", "admin", "support"].includes(profile?.role)) {
    root.innerHTML =
      '<div class="admin-panel"><h3>Sem permissão</h3><p>Sua conta não possui um cargo administrativo.</p></div>';
    return;
  }
  const [
    { data: orders },
    { data: profiles },
    { data: products },
    { data: wallets },
    catalogResponse,
    { data: tickets },
    { data: ticketMessages },
    activityResponse,
  ] = await Promise.all([
    supabase
      .from("orders")
      .select("*,order_items(name_snapshot,metadata)")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("profiles")
      .select("user_id,display_name,discord_username,palworld_nickname,role")
      .limit(500),
    supabase.from("products").select("*").order("product_type"),
    supabase.from("wallets").select("*").limit(500),
    fetch("/api/game-catalog?includeInactive=1", { cache: "no-store" })
      .then(async (response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error("catalog unavailable")),
      )
      .catch(() => null),
    supabase
      .from("support_tickets")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("support_ticket_messages")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(1500),
    fetch("/api/palworld?mode=admin-sync", { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error("sync unavailable")))
      .catch(() => null),
  ]);
  const pending = (orders || []).filter((o) =>
    ["awaiting_delivery", "in_delivery", "paid"].includes(o.status),
  );
  const paid = (orders || []).filter((o) =>
    ["paid", "awaiting_delivery", "in_delivery", "delivered"].includes(
      o.status,
    ),
  );
  const storeProducts = catalogResponse?.items || [];
  const canManage = ["owner", "admin"].includes(profile.role);
  const walletByUser = new Map(
    (wallets || []).map((wallet) => [wallet.user_id, wallet]),
  );
  const profileByUser = new Map(
    (profiles || []).map((player) => [player.user_id, player]),
  );
  const ticketRows = tickets || [];
  const ticketMessagesByTicket = new Map();
  (ticketMessages || []).forEach((message) =>
    ticketMessagesByTicket.set(message.ticket_id, [
      ...(ticketMessagesByTicket.get(message.ticket_id) || []),
      message,
    ]),
  );
  const ordersByUser = new Map();
  (orders || []).forEach((order) =>
    ordersByUser.set(order.user_id, [
      ...(ordersByUser.get(order.user_id) || []),
      order,
    ]),
  );
  root.innerHTML = `
    <article class="admin-stat-card"><span>PEDIDOS REGISTRADOS</span><b>${orders?.length || 0}</b><small>Últimos 60 pedidos</small></article>
    <article class="admin-stat-card"><span>PLAYERS</span><b>${profiles?.length || 0}</b><small>Contas no portal</small></article>
    <article class="admin-stat-card"><span>CATÁLOGO</span><b>${storeProducts.length || 0}</b><small>Itens disponíveis na loja</small></article>
    <article class="admin-stat-card"><span>ENTREGAS PENDENTES</span><b>${pending.length}</b><small>Exigem ação da equipe</small></article>
    <section id="player-activity" class="admin-panel"><div class="admin-loading">Carregando atividade dos servidores...</div></section>
    <section id="buyers" class="admin-panel"><div class="profile-section-title"><div><span class="eyebrow cyan">CLIENTES E CARTEIRAS</span><h3>Compradores, MV e cargos</h3><p class="admin-panel-note">Owner pode definir cargos; Owner e Admin podem creditar ou retirar MV. Todas as alterações ficam registradas.</p></div><span class="admin-status">${profiles?.length || 0} contas</span></div><div class="buyer-admin-grid">${
      (profiles || [])
        .map((player) => {
          const playerOrders = ordersByUser.get(player.user_id) || [];
          const wallet = walletByUser.get(player.user_id);
          const purchases = playerOrders
            .slice(0, 4)
            .flatMap((order) =>
              (order.order_items || []).map((item) => item.name_snapshot),
            )
            .filter(Boolean);
          const canSetRole =
            profile.role === "owner" && player.user_id !== profile.user_id;
          return `<article class="buyer-admin-card"><div class="buyer-admin-head"><div><b>${esc(player.display_name || player.discord_username || "Jogador")}</b><small>${esc(player.discord_username ? `@${player.discord_username.replace(/^@/, "")}` : player.palworld_nickname || "Discord não informado")}</small></div><span class="admin-status">${coins(wallet?.balance || 0)} MV</span></div><p><b>Compras:</b> ${purchases.length ? esc(purchases.join(" · ")) : "Nenhuma compra registrada"}</p><small>${playerOrders.length} pedido(s) no portal · Cargo: ${esc(roleLabel(player.role))}</small>${canSetRole ? `<form class="role-adjust-form" data-role-form="${esc(player.user_id)}"><select name="role"><option value="player" ${player.role === "player" ? "selected" : ""}>Cliente / Jogador</option><option value="support" ${player.role === "support" ? "selected" : ""}>Suporte</option><option value="admin" ${player.role === "admin" ? "selected" : ""}>Admin</option><option value="owner" ${player.role === "owner" ? "selected" : ""}>Owner</option></select><button class="secondary-btn admin-action-btn">Salvar cargo</button></form>` : ""}${canManage && wallet ? `<form class="wallet-adjust-form" data-wallet-form="${esc(player.user_id)}"><select name="direction"><option value="credit">Adicionar MV</option><option value="debit">Retirar MV</option></select><input name="amount" inputmode="numeric" min="1" placeholder="Quantidade" required><input name="reason" maxlength="220" placeholder="Motivo do ajuste" required><button class="secondary-btn admin-action-btn">Aplicar ajuste</button></form>` : ""}</article>`;
        })
        .join("") ||
      '<div class="admin-empty">Nenhum jogador cadastrado ainda.</div>'
    }</div></section>
    <section id="catalog" class="admin-panel"><div class="profile-section-title"><div><span class="eyebrow cyan">CATÁLOGO</span><h3>Loja por Moedas da Vitória</h3><p class="admin-panel-note">Pals, armaduras, armas e recursos têm controles independentes. Pals usam preço e ativação separados para os níveis 80 e 255.</p></div><span class="admin-status">${storeProducts.length} itens</span></div>${["pals", "armor", "weapons", "resources"].map((category) => renderCatalogCategory(category, storeProducts, canManage)).join("")}</section>
    <section id="deliveries" class="admin-panel"><div class="profile-section-title"><div><span class="eyebrow cyan">OPERAÇÃO</span><h3>Fila de entrega</h3></div></div>${pending.length ? `<div class="admin-table">${pending.map((o) => `<div class="admin-order-row"><b>#EW-${o.order_number}</b><div><b>${esc((o.order_items || [])[0]?.name_snapshot || "Pedido")}</b><small>${esc(o.palworld_nickname)} · Servidor ${o.server_number || "-"}${palRequestSummary(o) ? `<br>${esc(palRequestSummary(o))}` : ""}</small></div><div><small>${new Date(o.created_at).toLocaleString("pt-BR")}</small></div><div class="admin-actions"><span class="admin-status">${esc(statusLabel(o.status))}</span>${o.status !== "in_delivery" ? `<button class="secondary-btn admin-action-btn" data-delivery="${o.id}" data-status="in_delivery">Em entrega</button>` : ""}<button class="primary-btn admin-action-btn" data-delivery="${o.id}" data-status="delivered">Marcar entregue</button></div></div>`).join("")}</div>` : '<div class="admin-empty">Nenhum pedido aguardando entrega.</div>'}</section>
    <section id="tickets" class="admin-panel"><div class="profile-section-title"><div><span class="eyebrow cyan">ATENDIMENTO</span><h3>Tickets de suporte e compra</h3><p class="admin-panel-note">Apenas a equipe administrativa vê todos os chamados. Os jogadores veem somente os próprios tickets.</p></div><span id="admin-ticket-filter-count" class="admin-status">${ticketRows.length} tickets</span></div><div class="admin-ticket-filters"><label>Categoria<select id="ticket-category-filter"><option value="all">Todas</option><option value="support">Suporte</option><option value="purchase">Compra</option></select></label><label>Status<select id="ticket-status-filter"><option value="all">Todos</option><option value="open">Aberto</option><option value="in_progress">Em atendimento</option><option value="answered">Respondido</option><option value="closed">Fechado</option></select></label></div>${
      ticketRows.length
        ? `<div class="admin-ticket-list">${ticketRows
            .map((ticket) => {
              const owner = profileByUser.get(ticket.user_id);
              const messages = ticketMessagesByTicket.get(ticket.id) || [];
              return `<article class="admin-ticket-card" data-ticket-category="${esc(ticket.category)}" data-ticket-current-status="${esc(ticket.status)}"><div class="admin-ticket-head"><div><span class="admin-store-kind">${ticket.category === "purchase" ? "COMPRA" : "SUPORTE"}</span><b>${esc(ticket.subject)}</b><small>${esc(owner?.display_name || owner?.discord_username || "Jogador")} · ${new Date(ticket.created_at).toLocaleString("pt-BR")} · ${messages.length} mensagem(ns)</small></div><form class="ticket-status-form" data-ticket-status="${ticket.id}"><select name="status"><option value="open" ${ticket.status === "open" ? "selected" : ""}>Aberto</option><option value="in_progress" ${ticket.status === "in_progress" ? "selected" : ""}>Em atendimento</option><option value="answered" ${ticket.status === "answered" ? "selected" : ""}>Respondido</option><option value="closed" ${ticket.status === "closed" ? "selected" : ""}>Fechado</option></select><button class="secondary-btn admin-action-btn">Salvar status</button></form></div><div class="admin-ticket-description"><b>Descrição</b><p>${esc(ticket.description || "Sem descrição informada.")}</p></div><div class="admin-ticket-messages">${messages.map((message) => `<div class="admin-ticket-message ${message.author_id === ticket.user_id ? "player" : ""}"><b>${message.author_id === ticket.user_id ? "Jogador" : "Equipe"}</b><small>${new Date(message.created_at).toLocaleString("pt-BR")}</small><p>${esc(message.body)}</p></div>`).join("") || "<small>A conversa ainda não possui mensagens.</small>"}</div>${ticket.status !== "closed" ? `<form class="admin-ticket-reply" data-ticket-reply="${ticket.id}"><textarea name="body" maxlength="2000" placeholder="Responder ao jogador" required></textarea><button class="primary-btn admin-action-btn">Responder</button></form>` : '<small class="admin-ticket-closed">Ticket fechado. Altere o status para reabrir o atendimento.</small>'}</article>`;
            })
            .join("")}</div>`
        : '<div class="admin-empty">Nenhum ticket criado ainda.</div>'
    }</section>
    <section class="admin-panel"><div class="profile-section-title"><div><span class="eyebrow blue">HISTÓRICO</span><h3>Atividade recente</h3></div></div>${
      paid.length
        ? `<div class="admin-table">${paid
            .slice(0, 10)
            .map(
              (o) =>
                `<div class="admin-order-row"><b>#EW-${o.order_number}</b><div><b>${esc((o.order_items || [])[0]?.name_snapshot || "Pedido")}</b><small>${esc(o.palworld_nickname)}</small></div><div><small>${new Date(o.created_at).toLocaleString("pt-BR")}</small></div><span class="admin-status">${esc(statusLabel(o.status))}</span></div>`,
            )
            .join("")}</div>`
        : '<div class="admin-empty">Sem atividade recente.</div>'
    }</section>`;
  document
    .querySelectorAll("[data-delivery]")
    .forEach(
      (btn) =>
        (btn.onclick = () =>
          setDelivery(btn.dataset.delivery, btn.dataset.status)),
    );
  document.querySelectorAll("[data-store-form]").forEach(
    (form) =>
      (form.onsubmit = (event) => {
        event.preventDefault();
        updateStoreProduct(form.dataset.storeForm, form);
      }),
  );
  document.querySelectorAll("[data-wallet-form]").forEach(
    (form) =>
      (form.onsubmit = (event) => {
        event.preventDefault();
        adjustWallet(form.dataset.walletForm, form);
      }),
  );
  document.querySelectorAll("[data-role-form]").forEach(
    (form) =>
      (form.onsubmit = (event) => {
        event.preventDefault();
        updateRole(form.dataset.roleForm, form);
      }),
  );
  document.querySelectorAll("[data-ticket-status]").forEach(
    (form) =>
      (form.onsubmit = (event) => {
        event.preventDefault();
        updateTicketStatus(
          form.dataset.ticketStatus,
          form.querySelector('[name="status"]').value,
        );
      }),
  );
  document.querySelectorAll("[data-ticket-reply]").forEach(
    (form) =>
      (form.onsubmit = (event) => {
        event.preventDefault();
        replyToTicket(form.dataset.ticketReply, form);
      }),
  );
  document.querySelectorAll("[data-catalog-search]").forEach(
    (field) =>
      (field.oninput = () => {
        const query = String(field.value || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();
        document
          .querySelectorAll(
            `[data-catalog-list="${field.dataset.catalogSearch}"] [data-catalog-name]`,
          )
          .forEach((item) => {
            item.hidden = !String(item.dataset.catalogName || "")
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase()
              .includes(query);
          });
      }),
  );
  ["pals", "armor", "weapons", "resources"].forEach(enhanceCatalogPagination);
  enhanceSyncConsole(activityResponse, profileByUser);
  const applyTicketFilters = () => {
    const category =
        document.querySelector("#ticket-category-filter")?.value || "all",
      status = document.querySelector("#ticket-status-filter")?.value || "all";
    let visible = 0;
    document.querySelectorAll(".admin-ticket-card").forEach((card) => {
      const show =
        (category === "all" || card.dataset.ticketCategory === category) &&
        (status === "all" || card.dataset.ticketCurrentStatus === status);
      card.hidden = !show;
      if (show) visible++;
    });
    const count = document.querySelector("#admin-ticket-filter-count");
    if (count)
      count.textContent = `${visible} ticket${visible === 1 ? "" : "s"}`;
  };
  ["#ticket-category-filter", "#ticket-status-filter"].forEach((selector) => {
    const field = document.querySelector(selector);
    if (field) field.onchange = applyTicketFilters;
  });
  enhanceTicketConsole(ticketRows, ticketMessagesByTicket, profileByUser);
}
async function signIn() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: { redirectTo: `${SITE_ORIGIN}/admin.html` },
  });
  if (error) toast(error.message);
}
render().catch((error) => {
  console.error("Falha ao carregar o painel administrativo:", error);
  root.innerHTML =
    '<div class="admin-panel"><h3>Não foi possível carregar os dados</h3><p>Atualize a página. Se o problema continuar, a equipe pode verificar o erro pelo console do navegador.</p></div>';
});
