const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const reply = (res, status, body) => res.status(status).json(body);
const clean = (value, length) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .trim()
    .slice(0, length);
const isUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const couponLimit = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000000)
    throw new Error('Informe um limite total entre 1 e 1.000.000 usos.');
  return limit;
};
const couponMinimum = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') return 0;
  const amount = Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000)
    throw new Error('Informe um valor mínimo entre R$ 0,00 e R$ 100.000,00.');
  return Math.round(amount * 100);
};

async function serviceFetch(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(data?.message || data?.hint || 'Não foi possível alterar o cargo.');
  return data;
}

export default async function handler(req, res) {
  const resource = req.query?.resource;
  const couponMode = resource === 'coupons';
  const ordersMode = resource === 'orders';
  const revenueMode = resource === 'revenue';
  if (couponMode && !['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method))
    return reply(res, 405, { error: 'Method not allowed' });
  if ((ordersMode || revenueMode) && req.method !== 'GET')
    return reply(res, 405, { error: 'Method not allowed' });
  if (!couponMode && !ordersMode && !revenueMode && req.method !== 'POST')
    return reply(res, 405, { error: 'Method not allowed' });
  if (!SUPABASE_URL || !PUBLISHABLE || !SERVICE_ROLE)
    return reply(res, 503, { error: 'A administração ainda não foi configurada.' });

  const token = String(req.headers.authorization || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  if (!token) return reply(res, 401, { error: 'Entre com Discord para continuar.' });

  try {
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${token}` },
    });
    const user = await userResponse.json().catch(() => null);
    if (!userResponse.ok || !user?.id)
      return reply(res, 401, { error: 'Sua sessão expirou. Entre novamente.' });

    const [profile] = await serviceFetch(
      `profiles?select=role&user_id=eq.${encodeURIComponent(user.id)}&limit=1`
    );

    if (revenueMode) {
      if (profile?.role !== 'owner')
        return reply(res, 403, { error: 'Somente Owner pode ver o faturamento.' });
      const rows = await serviceFetch('rpc/owner_revenue_summary', {
        method: 'POST',
        body: JSON.stringify({ p_actor_user_id: user.id }),
      });
      const summary = rows?.[0] || { total_cents: 0, approved_payments: 0, paying_customers: 0 };
      return reply(res, 200, {
        summary: {
          totalCents: Number(summary.total_cents || 0),
          approvedPayments: Number(summary.approved_payments || 0),
          payingCustomers: Number(summary.paying_customers || 0),
        },
      });
    }

    if (ordersMode) {
      if (!['owner', 'admin', 'support'].includes(profile?.role))
        return reply(res, 403, { error: 'Sua conta não possui acesso aos pedidos.' });
      const orders = await serviceFetch(
        'orders?select=id,user_id,status,order_number,palworld_nickname,server_number,created_at,order_items(name_snapshot,quantity,metadata)&order=created_at.desc&limit=500'
      );
      return reply(res, 200, { orders });
    }

    if (couponMode) {
      if (!['owner', 'admin'].includes(profile?.role))
        return reply(res, 403, { error: 'Apenas Owner ou Admin pode gerenciar cupons.' });
      if (req.method === 'GET') {
        const [coupons, redemptions] = await Promise.all([
          serviceFetch(
            'coupons?select=id,code,discount_type,discount_value,active,max_uses,min_order_cents,target_user_id,created_at&discount_type=eq.percent&deleted_at=is.null&order=created_at.desc'
          ),
          serviceFetch('coupon_redemptions?select=coupon_id,status'),
        ]);
        const usage = new Map();
        redemptions.forEach((row) => {
          const current = usage.get(row.coupon_id) || { redeemed: 0, reserved: 0 };
          if (row.status === 'redeemed') current.redeemed += 1;
          if (row.status === 'reserved') current.reserved += 1;
          usage.set(row.coupon_id, current);
        });
        return reply(res, 200, {
          coupons: coupons.map((coupon) => ({
            ...coupon,
            usage: usage.get(coupon.id) || { redeemed: 0, reserved: 0 },
          })),
        });
      }

      if (req.method === 'POST') {
        const code = clean(req.body?.code, 32).toUpperCase();
        const discountPercent = Number(req.body?.discountPercent);
        const maxUses = couponLimit(req.body?.maxUses);
        const minOrderCents = couponMinimum(req.body?.minOrder);
        const targetUserId = clean(req.body?.targetUserId, 80) || null;
        if (!/^[A-Z0-9_-]{3,32}$/.test(code))
          return reply(res, 400, {
            error: 'Use de 3 a 32 letras, números, hífen ou sublinhado no cupom.',
          });
        if (!Number.isInteger(discountPercent) || discountPercent < 1 || discountPercent > 90)
          return reply(res, 400, { error: 'Informe uma porcentagem entre 1% e 90%.' });
        if (targetUserId && !isUuid(targetUserId))
          return reply(res, 400, {
            error: 'Use o ID da conta do jogador para criar um cupom exclusivo.',
          });
        const rows = await serviceFetch('coupons', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            code,
            discount_type: 'percent',
            discount_value: discountPercent,
            max_uses: maxUses,
            min_order_cents: minOrderCents,
            max_uses_per_user: 1,
            target_user_id: targetUserId,
          }),
        });
        return reply(res, 201, { coupon: rows?.[0] });
      }

      const id = clean(req.body?.id, 80);
      if (!isUuid(id)) return reply(res, 400, { error: 'Cupom inválido.' });
      if (req.method === 'DELETE') {
        const rows = await serviceFetch(
          `coupons?id=eq.${encodeURIComponent(id)}&deleted_at=is.null`,
          {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ active: false, deleted_at: new Date().toISOString() }),
          }
        );
        if (!rows?.[0]) return reply(res, 404, { error: 'Cupom não encontrado ou já excluído.' });
        return reply(res, 200, { coupon: rows[0] });
      }
      const update = {};
      if (typeof req.body?.active === 'boolean') update.active = req.body.active;
      if (req.body?.discountPercent !== undefined) {
        const discountPercent = Number(req.body.discountPercent);
        if (!Number.isInteger(discountPercent) || discountPercent < 1 || discountPercent > 90)
          return reply(res, 400, { error: 'Informe uma porcentagem entre 1% e 90%.' });
        update.discount_value = discountPercent;
      }
      if (req.body?.maxUses !== undefined) update.max_uses = couponLimit(req.body.maxUses);
      if (req.body?.minOrder !== undefined)
        update.min_order_cents = couponMinimum(req.body.minOrder);
      if (req.body?.targetUserId !== undefined) {
        const targetUserId = clean(req.body.targetUserId, 80) || null;
        if (targetUserId && !isUuid(targetUserId))
          return reply(res, 400, {
            error: 'Use o ID da conta do jogador para criar um cupom exclusivo.',
          });
        update.target_user_id = targetUserId;
      }
      if (!Object.keys(update).length)
        return reply(res, 400, { error: 'Nenhuma alteração foi informada.' });
      const rows = await serviceFetch(`coupons?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(update),
      });
      return reply(res, 200, { coupon: rows?.[0] });
    }

    if (profile?.role !== 'owner')
      return reply(res, 403, { error: 'Somente Owner pode alterar cargos.' });

    const targetUserId = clean(req.body?.targetUserId, 80);
    const role = clean(req.body?.role, 24).toLowerCase();
    if (!isUuid(targetUserId)) return reply(res, 400, { error: 'Conta do jogador inválida.' });
    if (!['owner', 'admin', 'support', 'player'].includes(role))
      return reply(res, 400, { error: 'Cargo inválido.' });

    const result = await serviceFetch('rpc/admin_set_portal_role', {
      method: 'POST',
      body: JSON.stringify({
        p_actor_user_id: user.id,
        p_target_user_id: targetUserId,
        p_role: role,
      }),
    });
    return reply(res, 200, { role: String(result) });
  } catch (error) {
    const message = String(error?.message || '');
    if (message.includes('duplicate key'))
      return reply(res, 409, { error: 'Já existe um cupom com esse nome.' });
    if (message.includes('cannot change own role'))
      return reply(res, 400, {
        error: 'Você não pode alterar o seu próprio cargo por este painel.',
      });
    if (message.includes('last owner'))
      return reply(res, 400, { error: 'Não é possível rebaixar o último Owner do portal.' });
    if (message.includes('profile not found'))
      return reply(res, 404, { error: 'Perfil do jogador não encontrado.' });
    if (message.includes('owner required'))
      return reply(res, 403, { error: 'Somente Owner pode alterar cargos.' });
    if (message.includes('limite total') || message.includes('valor mínimo'))
      return reply(res, 400, { error: message });
    return reply(res, 500, { error: 'Não foi possível alterar o cargo agora.' });
  }
}
