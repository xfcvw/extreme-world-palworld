import { getSharedSession, supabase } from "/assets/auth.js";

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const normalize = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const coins = (value) => new Intl.NumberFormat("pt-BR").format(Number(value || 0));
const statusLabel = (status) =>
  ({
    paid: "Pago",
    awaiting_delivery: "Aguardando entrega",
    in_delivery: "Em entrega",
    delivered: "Entregue",
  })[status] || status;
const itemQuantity = (item) => {
  const selected = Number(item?.metadata?.quantity);
  const recorded = Number(item?.quantity);
  const pack = Number(item?.metadata?.pack_size);
  return (
    (Number.isInteger(selected) && selected > 0 && selected) ||
    (Number.isInteger(recorded) && recorded > 0 && recorded) ||
    (Number.isInteger(pack) && pack > 0 && pack) ||
    1
  );
};
const purchaseLabel = (item) =>
  `${item?.name_snapshot || "Pedido"} × ${coins(itemQuantity(item))}`;

async function replaceRecentActivity(section) {
  if (section.dataset.recentActivityReady) return;
  section.dataset.recentActivityReady = "true";

  const session = await getSharedSession();
  if (!session) return;
  const { data: orders, error } = await supabase
    .from("orders")
    .select("order_number,status,palworld_nickname,created_at,order_items(name_snapshot,quantity,metadata)")
    .in("status", ["paid", "awaiting_delivery", "in_delivery", "delivered"])
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    console.warn("Não foi possível carregar a atividade recente.", error.message);
    return;
  }

  const state = { query: "", page: 1 };
  const draw = () => {
    const query = normalize(state.query);
    const matching = (orders || []).filter((order) => {
      const itemNames = (order.order_items || [])
        .map((item) => item?.name_snapshot || "")
        .join(" ");
      return !query ||
        normalize(`${order.order_number} ${order.palworld_nickname || ""} ${itemNames}`).includes(query);
    });
    const perPage = 10;
    const totalPages = Math.max(1, Math.ceil(matching.length / perPage));
    state.page = Math.min(state.page, totalPages);
    const visible = matching.slice((state.page - 1) * perPage, state.page * perPage);

    section.innerHTML = `<div class="profile-section-title"><div><span class="eyebrow blue">HISTÓRICO</span><h3>Atividade recente</h3><p class="admin-panel-note">Compras concluídas e em andamento no portal.</p></div><span class="admin-status">${matching.length} pedido${matching.length === 1 ? "" : "s"}</span></div><div class="activity-toolbar" style="grid-template-columns:minmax(220px,1fr)"><label>Buscar compra ou jogador<input data-recent-activity-query placeholder="Item, NickName ou pedido"></label></div><div class="admin-table">${visible.length ? visible.map((order) => { const label = (order.order_items || []).map(purchaseLabel).join(" · ") || "Pedido"; return `<div class="admin-order-row"><b>#EW-${order.order_number}</b><div><b>${esc(label)}</b><small>${esc(order.palworld_nickname || "NickName não informado")}</small></div><div><small>${new Date(order.created_at).toLocaleString("pt-BR")}</small></div><span class="admin-status">${esc(statusLabel(order.status))}</span></div>`; }).join("") : '<div class="admin-empty">Nenhuma atividade encontrada com este filtro.</div>'}</div><div class="activity-pagination"><span>${matching.length} resultado${matching.length === 1 ? "" : "s"} · Página ${state.page} de ${totalPages}</span><div><button class="secondary-btn" data-recent-page="prev" ${state.page === 1 ? "disabled" : ""}>← Anterior</button><button class="secondary-btn" data-recent-page="next" ${state.page === totalPages ? "disabled" : ""}>Próxima →</button></div></div>`;

    const search = section.querySelector("[data-recent-activity-query]");
    search.value = state.query;
    search.oninput = (event) => {
      state.query = event.currentTarget.value;
      state.page = 1;
      draw();
    };
    section.querySelectorAll("[data-recent-page]").forEach((button) => {
      button.onclick = () => {
        state.page += button.dataset.recentPage === "next" ? 1 : -1;
        draw();
      };
    });
  };
  draw();
}

function findRecentActivity() {
  document.querySelectorAll("#admin-root .admin-panel").forEach((section) => {
    if (section.querySelector("h3")?.textContent.trim() === "Atividade recente") {
      replaceRecentActivity(section);
    }
  });
}

new MutationObserver(findRecentActivity).observe(document.querySelector("#admin-root"), {
  childList: true,
  subtree: true,
});
findRecentActivity();
