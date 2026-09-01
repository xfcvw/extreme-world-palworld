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
const vipStatusLabel = (status) =>
  ({
    paid: "Pago",
    awaiting_delivery: "Aguardando entrega",
    in_delivery: "Em entrega",
    delivered: "Entregue",
  })[status] || status;

async function mountVipStatus(buyersSection) {
  if (document.querySelector("#vip-status")) return;
  const session = await getSharedSession();
  if (!session) return;

  const section = document.createElement("section");
  section.id = "vip-status";
  section.className = "admin-panel";
  section.innerHTML = '<div class="admin-loading">Carregando status dos VIPs...</div>';
  buyersSection.before(section);

  const [{ data: profiles, error: profilesError }, { data: orders, error: ordersError }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("user_id,display_name,discord_username,palworld_nickname")
        .order("display_name")
        .limit(500),
      supabase
        .from("orders")
        .select("user_id,status,created_at,order_items(vip_plan_id,name_snapshot)")
        .in("status", ["paid", "awaiting_delivery", "in_delivery", "delivered"])
        .order("created_at", { ascending: false })
        .limit(1000),
    ]);
  if (profilesError || ordersError) {
    section.innerHTML = '<div class="admin-empty">Não foi possível carregar o status dos VIPs agora.</div>';
    return;
  }

  const activeVipByUser = new Map();
  (orders || []).forEach((order) => {
    const vipItem = (order.order_items || []).find((item) => item.vip_plan_id);
    if (vipItem && !activeVipByUser.has(order.user_id)) {
      activeVipByUser.set(order.user_id, {
        name: vipItem.name_snapshot || "VIP",
        status: order.status,
      });
    }
  });
  const rows = (profiles || [])
    .map((profile) => ({
      ...profile,
      vip: activeVipByUser.get(profile.user_id) || null,
    }))
    .sort((a, b) => Number(Boolean(b.vip)) - Number(Boolean(a.vip)) ||
      String(a.display_name || a.discord_username || "").localeCompare(
        String(b.display_name || b.discord_username || ""),
        "pt-BR",
      ));
  const state = { query: "", filter: "all", page: 1 };

  const draw = () => {
    const query = normalize(state.query);
    const filtered = rows.filter((player) => {
      const name = `${player.display_name || ""} ${player.discord_username || ""} ${player.palworld_nickname || ""} ${player.vip?.name || ""}`;
      return (state.filter === "all" ||
        (state.filter === "vip" && player.vip) ||
        (state.filter === "no-vip" && !player.vip)) &&
        (!query || normalize(name).includes(query));
    });
    const vipCount = rows.filter((player) => player.vip).length;
    const perPage = 12;
    const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
    state.page = Math.min(state.page, totalPages);
    const visible = filtered.slice((state.page - 1) * perPage, state.page * perPage);

    section.innerHTML = `<div class="profile-section-title"><div><span class="eyebrow cyan">ASSINATURAS</span><h3>Status VIP</h3><p class="admin-panel-note">Jogadores com uma compra VIP paga ou em processo de entrega são identificados como VIP ativo.</p></div><div class="admin-ticket-summary"><span class="admin-status">${vipCount} VIP${vipCount === 1 ? "" : "s"}</span><span class="admin-status">${rows.length - vipCount} sem VIP</span></div></div><div class="activity-toolbar" style="grid-template-columns:minmax(220px,1fr) 180px"><label>Buscar jogador<input data-vip-search placeholder="Jogador, Discord ou VIP"></label><label>Status<select data-vip-filter><option value="all">Todos</option><option value="vip">Somente VIP</option><option value="no-vip">Sem VIP</option></select></label></div><div class="admin-table">${visible.length ? visible.map((player) => { const name = player.display_name || player.discord_username || player.palworld_nickname || "Jogador"; const detail = player.discord_username ? `@${player.discord_username.replace(/^@/, "")}` : player.palworld_nickname || "Discord não informado"; return `<div class="admin-order-row"><div><b>${esc(name)}</b><small>${esc(detail)}</small></div><div><b>${esc(player.vip?.name || "Sem VIP ativo")}</b><small>${player.vip ? `Status: ${esc(vipStatusLabel(player.vip.status))}` : "Nenhuma compra VIP ativa"}</small></div><span class="admin-status">${player.vip ? "VIP ATIVO" : "SEM VIP"}</span></div>`; }).join("") : '<div class="admin-empty">Nenhum jogador encontrado neste filtro.</div>'}</div><div class="activity-pagination"><span>${filtered.length} resultado${filtered.length === 1 ? "" : "s"} · Página ${state.page} de ${totalPages}</span><div><button class="secondary-btn" data-vip-page="prev" ${state.page === 1 ? "disabled" : ""}>← Anterior</button><button class="secondary-btn" data-vip-page="next" ${state.page === totalPages ? "disabled" : ""}>Próxima →</button></div></div>`;

    const search = section.querySelector("[data-vip-search]");
    search.value = state.query;
    search.oninput = (event) => {
      state.query = event.currentTarget.value;
      state.page = 1;
      const cursor = event.currentTarget.selectionStart ?? state.query.length;
      draw();
      const nextSearch = section.querySelector("[data-vip-search]");
      nextSearch?.focus();
      nextSearch?.setSelectionRange(cursor, cursor);
    };
    const filter = section.querySelector("[data-vip-filter]");
    filter.value = state.filter;
    filter.onchange = (event) => {
      state.filter = event.currentTarget.value;
      state.page = 1;
      draw();
    };
    section.querySelectorAll("[data-vip-page]").forEach((button) => {
      button.onclick = () => {
        state.page += button.dataset.vipPage === "next" ? 1 : -1;
        draw();
      };
    });
  };
  draw();
}

function findBuyersSection() {
  const buyers = document.querySelector("#buyers");
  if (buyers) mountVipStatus(buyers);
}

new MutationObserver(findBuyersSection).observe(document.querySelector("#admin-root"), {
  childList: true,
  subtree: true,
});
findBuyersSection();
