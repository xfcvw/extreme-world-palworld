const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const reply = (res, status, body) => res.status(status).json(body);

async function service(path) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || `Supabase ${response.status}`);
  return data;
}
function statusFor(row, now) {
  if (row.is_online) return 'online';
  const base = new Date(row.last_login_at || row.last_seen_at || row.first_seen_at).getTime();
  const hours = Math.max(0, (now - base) / 36e5);
  const limit = Number(row.server_number) === 1 ? 72 : 120;
  const warning = Number(row.server_number) === 1 ? 48 : 96;
  return hours >= limit ? 'critical' : hours >= warning ? 'attention' : 'normal';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return reply(res, 405, { error: 'Method not allowed' });
  if (!SUPABASE_URL || !PUBLISHABLE || !SERVICE_ROLE) return reply(res, 503, { error: 'A administração ainda não foi configurada.' });
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return reply(res, 401, { error: 'Entre com Discord para continuar.' });
  try {
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${token}` } });
    const user = await userResponse.json().catch(() => null);
    if (!userResponse.ok || !user?.id) return reply(res, 401, { error: 'Sua sessão expirou. Entre novamente.' });
    const [profile] = await service(`profiles?select=role&user_id=eq.${encodeURIComponent(user.id)}&limit=1`);
    if (!['owner', 'admin', 'support'].includes(profile?.role)) return reply(res, 403, { error: 'Sua conta não possui permissão para ver a atividade dos jogadores.' });
    const [players, agents] = await Promise.all([
      service('server_player_activity?select=*&order=last_seen_at.desc&limit=2000'),
      service('server_activity_agents?select=*')
    ]);
    const now = Date.now();
    const rows = (players || []).map((player) => ({ ...player, decay_status: statusFor(player, now) }));
    const summary = [1, 2].map((serverNumber) => {
      const entries = rows.filter((row) => Number(row.server_number) === serverNumber);
      return { serverNumber, total: entries.length, online: entries.filter((row) => row.decay_status === 'online').length, attention: entries.filter((row) => row.decay_status === 'attention').length, critical: entries.filter((row) => row.decay_status === 'critical').length };
    });
    return reply(res, 200, { generatedAt: new Date(now).toISOString(), players: rows, agents: agents || [], summary });
  } catch (error) {
    console.error('[admin-player-activity] failed', { message: error?.message });
    return reply(res, 500, { error: 'Não foi possível carregar o controle de atividade.' });
  }
}
