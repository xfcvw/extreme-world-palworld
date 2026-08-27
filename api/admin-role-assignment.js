const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const reply = (res, status, body) => res.status(status).json(body);
const clean = (value, length) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, length);
const isUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

async function serviceFetch(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.hint || 'Não foi possível alterar o cargo.');
  return data;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return reply(res, 405, { error: 'Method not allowed' });
  if (!SUPABASE_URL || !PUBLISHABLE || !SERVICE_ROLE) return reply(res, 503, { error: 'A administração ainda não foi configurada.' });

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return reply(res, 401, { error: 'Entre com Discord para continuar.' });

  try {
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${token}` } });
    const user = await userResponse.json().catch(() => null);
    if (!userResponse.ok || !user?.id) return reply(res, 401, { error: 'Sua sessão expirou. Entre novamente.' });

    const [profile] = await serviceFetch(`profiles?select=role&user_id=eq.${encodeURIComponent(user.id)}&limit=1`);
    if (profile?.role !== 'owner') return reply(res, 403, { error: 'Somente Owner pode alterar cargos.' });

    const targetUserId = clean(req.body?.targetUserId, 80);
    const role = clean(req.body?.role, 24).toLowerCase();
    if (!isUuid(targetUserId)) return reply(res, 400, { error: 'Conta do jogador inválida.' });
    if (!['owner', 'admin', 'support', 'player'].includes(role)) return reply(res, 400, { error: 'Cargo inválido.' });

    const result = await serviceFetch('rpc/admin_set_portal_role', {
      method: 'POST',
      body: JSON.stringify({ p_actor_user_id: user.id, p_target_user_id: targetUserId, p_role: role })
    });
    return reply(res, 200, { role: String(result) });
  } catch (error) {
    const message = String(error?.message || '');
    if (message.includes('cannot change own role')) return reply(res, 400, { error: 'Você não pode alterar o seu próprio cargo por este painel.' });
    if (message.includes('last owner')) return reply(res, 400, { error: 'Não é possível rebaixar o último Owner do portal.' });
    if (message.includes('profile not found')) return reply(res, 404, { error: 'Perfil do jogador não encontrado.' });
    if (message.includes('owner required')) return reply(res, 403, { error: 'Somente Owner pode alterar cargos.' });
    return reply(res, 500, { error: 'Não foi possível alterar o cargo agora.' });
  }
}
