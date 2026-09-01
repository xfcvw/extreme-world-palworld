const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const json = (res, status, data) => res.status(status).json(data);

async function service(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.hint || 'Não foi possível salvar o cupom.');
  return data;
}

export default async function handler(req, res) {
  if (!['GET', 'POST', 'PATCH'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });
  if (!SUPABASE_URL || !PUBLISHABLE || !SERVICE_ROLE) return json(res, 503, { error: 'Configuração indisponível.' });
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${token}` } });
    const user = await userResponse.json().catch(() => null);
    if (!userResponse.ok || !user?.id) return json(res, 401, { error: 'Sessão inválida.' });
    const profiles = await service(`profiles?user_id=eq.${encodeURIComponent(user.id)}&select=role`);
    if (!['owner', 'admin'].includes(profiles?.[0]?.role)) return json(res, 403, { error: 'Apenas Owner ou Admin pode gerenciar cupons.' });

    if (req.method === 'GET') return json(res, 200, { coupons: await service('coupons?select=*&order=created_at.desc') });
    if (req.method === 'POST') {
      const code = String(req.body?.code || '').trim().toUpperCase();
      const discountPercent = Number(req.body?.discountPercent);
      if (!/^[A-Z0-9_-]{3,32}$/.test(code)) return json(res, 400, { error: 'Use de 3 a 32 letras, números, hífen ou sublinhado no cupom.' });
      if (!Number.isInteger(discountPercent) || discountPercent < 1 || discountPercent > 90) return json(res, 400, { error: 'Informe uma porcentagem entre 1% e 90%.' });
      const rows = await service('coupons', { method: 'POST', body: JSON.stringify({ code, discount_percent: discountPercent, created_by: user.id }) });
      return json(res, 201, { coupon: rows?.[0] });
    }
    const id = String(req.body?.id || '');
    if (!id) return json(res, 400, { error: 'Cupom inválido.' });
    const rows = await service(`coupons?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ active: Boolean(req.body?.active) }) });
    return json(res, 200, { coupon: rows?.[0] });
  } catch (error) {
    if (String(error.message).includes('duplicate key')) return json(res, 409, { error: 'Já existe um cupom com esse nome.' });
    return json(res, 500, { error: error.message || 'Não foi possível gerenciar cupons.' });
  }
}
