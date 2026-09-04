const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const reply = (res, status, body) => res.status(status).json(body);
const clean = (value, length) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .trim()
    .slice(0, length);

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
    throw new Error(data?.message || data?.hint || 'Não foi possível ajustar a carteira.');
  return data;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return reply(res, 405, { error: 'Method not allowed' });
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
    if (!['owner', 'admin'].includes(profile?.role))
      return reply(res, 403, { error: 'Somente Owner ou Admin pode ajustar moedas.' });

    const targetUserId = clean(req.body?.targetUserId, 80);
    const delta = Number(req.body?.delta);
    const reason = clean(req.body?.reason, 220);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        targetUserId
      )
    )
      return reply(res, 400, { error: 'Conta do jogador inválida.' });
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100000)
      return reply(res, 400, { error: 'Informe um ajuste inteiro entre -100.000 e 100.000 MV.' });

    const result = await serviceFetch('rpc/admin_adjust_victory_coins', {
      method: 'POST',
      body: JSON.stringify({
        p_admin_user_id: user.id,
        p_target_user_id: targetUserId,
        p_delta: delta,
        p_reason: reason,
      }),
    });
    return reply(res, 200, { balance: Number(result), delta });
  } catch (error) {
    const message = String(error?.message || '');
    if (message.includes('insufficient balance'))
      return reply(res, 400, { error: 'O ajuste deixaria a carteira negativa.' });
    if (message.includes('wallet not found'))
      return reply(res, 404, { error: 'Essa conta ainda não possui carteira.' });
    return reply(res, 500, { error: 'Não foi possível ajustar a carteira agora.' });
  }
}
