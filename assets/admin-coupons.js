import { getSharedSession } from '/assets/auth.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

async function request(method, body) {
  const session = await getSharedSession();
  const response = await fetch('/api/admin-role-assignment?resource=coupons', { method, headers: { Authorization: `Bearer ${session.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível salvar o cupom.');
  return data;
}

async function mountCoupons() {
  const session = await getSharedSession();
  if (!session || document.querySelector('#coupons')) return;
  const buyers = document.querySelector('#buyers');
  if (!buyers) return;
  const section = document.createElement('section');
  section.id = 'coupons';
  section.className = 'admin-panel';
  section.innerHTML = '<div class="admin-loading">Carregando cupons...</div>';
  buyers.before(section);
  const draw = async () => {
    try {
      const { coupons = [] } = await request('GET');
      section.innerHTML = `<div class="profile-section-title"><div><span class="eyebrow cyan">PROMOÇÕES</span><h3>Cupons de desconto</h3><p class="admin-panel-note">Valem para VIPs, pacotes e compra de Moedas da Vitória.</p></div><span class="admin-status">${coupons.filter(coupon => coupon.active).length} ativo${coupons.filter(coupon => coupon.active).length === 1 ? '' : 's'}</span></div><form data-coupon-create class="coupon-form"><label>Código do cupom<input name="code" maxlength="32" placeholder="EX.: EXTREME10" required></label><label>Desconto (%)<input name="discountPercent" type="number" min="1" max="90" placeholder="10" required></label><button class="primary-btn admin-action-btn">Criar cupom</button></form><div class="admin-table">${coupons.length ? coupons.map(coupon => `<div class="admin-order-row"><b>${esc(coupon.code)}</b><div><b>${coupon.discount_value}% de desconto</b><small>Criado em ${new Date(coupon.created_at).toLocaleString('pt-BR')}</small></div><span class="admin-status">${coupon.active ? 'ATIVO' : 'INATIVO'}</span><button class="secondary-btn admin-action-btn" data-coupon-toggle="${coupon.id}" data-active="${coupon.active ? 'false' : 'true'}">${coupon.active ? 'Desativar' : 'Ativar'}</button></div>`).join('') : '<div class="admin-empty">Nenhum cupom criado ainda.</div>'}</div>`;
      section.querySelector('[data-coupon-create]').onsubmit = async event => {
        event.preventDefault();
        const form = event.currentTarget, button = form.querySelector('button'), data = new FormData(form);
        button.disabled = true;
        try { await request('POST', { code: data.get('code'), discountPercent: Number(data.get('discountPercent')) }); await draw(); }
        catch (error) { alert(error.message); button.disabled = false; }
      };
      section.querySelectorAll('[data-coupon-toggle]').forEach(button => button.onclick = async () => { try { await request('PATCH', { id: button.dataset.couponToggle, active: button.dataset.active === 'true' }); await draw(); } catch (error) { alert(error.message); } });
    } catch (error) { section.innerHTML = `<div class="admin-empty">${esc(error.message)}</div>`; }
  };
  draw();
}

new MutationObserver(mountCoupons).observe(document.querySelector('#admin-root'), { childList: true, subtree: true });
mountCoupons();
