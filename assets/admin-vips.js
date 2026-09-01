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
const date = (value) => new Date(value).toLocaleDateString("pt-BR");

async function mountVipStatus(buyersSection) {
  if (document.querySelector("#vip-status")) return;
  const session = await getSharedSession();
  if (!session) return;

  const section = document.createElement("section");
  section.id = "vip-status";
  section.className = "admin-panel";
  section.innerHTML = '<div class="admin-loading">Carregando status dos VIPs...</div>';
  buyersSection.before(section);

  const [{ data: profiles, error: profilesError }, { data: memberships, error: membershipsError }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("user_id,display_name,discord_username,palworld_nickname")
        .order("display_name")
        .limit(500),
      supabase
        .from("vip_memberships")
        .select("user_id,vip_name,starts_at,expires_at")
        .order("expires_at", { ascending: false })
        .limit(1000),
    ]);
  if (profilesError || membershipsError) {
    section.innerHTML = '<div class="admin-empty">Não foi possível carregar o status dos VIPs agora.</div>';
    return;
  }

  const now = Date.now();
  const activeVipByUser = new Map();
  const lastVipByUser = new Map();
  (memberships || []).forEach((membership) => {
    if (!lastVipByUser.has(membership.user_id)) lastVipByUser.set(membership.user_id, membership);
    if (new Date(membership.expires_at).getTime() > now && !activeVipByUser.has(membership.user_id)) {
      activeVipByUser.set(membership.user_id, membership);
    }
  });
  const rows = (profiles || [])
    .map((profile) => ({
      ...profile,
      vip: activeVipByUser.get(profile.user_id) || null,
      lastVip: lastVipByUser.get(profile.user_id) || null,
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

    section.innerHTML = `<div class="profile-section-title"><div><span class="eyebrow cyan">ASSINATURAS</span><h3>Status VIP</h3><p class="admin-panel-note">O VIP fica ativo por 30 dias após a confirmação da compra.</p></div><div class="admin-ticket-summary"><span class="admin-status">${vipCount} VIP${vipCount === 1 ? "" : "s"}</span><span class="admin-status">${rows.length - vipCount} sem VIP</span></div></div><div class="activity-toolbar" style="grid-template-columns:minmax(220px,1fr) 180px"><label>Buscar jogador<input data-vip-search placeholder="Jogador, Discord ou VIP"></label><label>Status<select data-vip-filter><option value="all">Todos</option><option value="vip">Somente VIP</option><option value="no-vip">Sem VIP</option></select></label></div><div class="admin-table">${visible.length ? visible.map((player) => { const name = player.display_name || player.discord_username || player.palworld_nickname || "Jogador"; const detail = player.discord_username ? `@${player.discord_username.replace(/^@/, "")}` : player.palworld_nickname || "Discord não informado"; const vipName = player.vip?.vip_name || (player.lastVip ? "Sem VIP ativo" : "Sem VIP ativo"); const vipDetail = player.vip ? `Vence em ${date(player.vip.expires_at)}` : player.lastVip ? `Último VIP venceu em ${date(player.lastVip.expires_at)}` : "Nenhuma compra VIP registrada"; return `<div class="vip-status-row"><div><b>${esc(name)}</b><small>${esc(detail)}</small></div><div><b>${esc(vipName)}</b><small>${esc(vipDetail)}</small></div><span class="admin-status">${player.vip ? "VIP ATIVO" : "SEM VIP"}</span></div>`; }).join("") : '<div class="admin-empty">Nenhum jogador encontrado neste filtro.</div>'}</div><div class="activity-pagination"><span>${filtered.length} resultado${filtered.length === 1 ? "" : "s"} · Página ${state.page} de ${totalPages}</span><div><button class="secondary-btn" data-vip-page="prev" ${state.page === 1 ? "disabled" : ""}>← Anterior</button><button class="secondary-btn" data-vip-page="next" ${state.page === totalPages ? "disabled" : ""}>Próxima →</button></div></div>`;

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
