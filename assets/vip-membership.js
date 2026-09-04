import { getSharedSession, supabase } from '/assets/auth.js';

const normalize = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
const shortDate = (value) => new Date(value).toLocaleDateString('pt-BR');

async function loadVipMembership() {
  const session = await getSharedSession();
  if (!session) return null;
  const { data } = await supabase
    .from('vip_memberships')
    .select('vip_name,starts_at,expires_at')
    .eq('user_id', session.user.id)
    .order('expires_at', { ascending: false })
    .limit(1);
  const membership = data?.[0] || null;
  return membership
    ? { ...membership, active: new Date(membership.expires_at).getTime() > Date.now() }
    : null;
}

function updateVipCards(membership) {
  document.querySelectorAll('#vip-grid [data-buy]').forEach((button) => {
    const selectedPlan =
      membership && normalize(button.dataset.name) === normalize(membership.vip_name);
    let label = 'Assinar VIP';
    let disabled = false;
    if (selectedPlan && membership.active) {
      label = `VIP ativo até ${shortDate(membership.expires_at)}`;
      disabled = true;
    } else if (selectedPlan) {
      label = 'Renovar VIP';
    }
    if (button.textContent !== label) button.textContent = label;
    button.disabled = disabled;
    button.title =
      selectedPlan && membership.active
        ? `Seu VIP vence em ${shortDate(membership.expires_at)}.`
        : '';
  });
}

function updateProfileBadge(membership) {
  const badge = document.querySelector('#vip-badge');
  if (!badge) return;
  if (membership?.active) {
    badge.textContent = `${membership.vip_name} · ativo até ${shortDate(membership.expires_at)}`;
  } else if (membership) {
    badge.textContent = `${membership.vip_name} expirado · renove seu VIP`;
  }
}

async function init() {
  const membership = await loadVipMembership();
  const grid = document.querySelector('#vip-grid');
  if (grid) {
    let queued = false;
    const refresh = () => {
      queued = false;
      updateVipCards(membership);
    };
    new MutationObserver(() => {
      if (!queued) {
        queued = true;
        setTimeout(refresh, 0);
      }
    }).observe(grid, { childList: true, subtree: true });
    refresh();
  }
  const profile = document.querySelector('#profile-content');
  if (profile) {
    new MutationObserver(() => updateProfileBadge(membership)).observe(profile, {
      attributes: true,
      attributeFilter: ['hidden'],
    });
    setTimeout(() => updateProfileBadge(membership), 0);
  }
}

init().catch(() => {});
