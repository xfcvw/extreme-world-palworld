import crypto from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
// A mesma chave da ponte de entrega é usada para não deixar uma nova chave
// sensível exposta no servidor Windows.
const AGENT_SECRET = process.env.EXTREME_DELIVERY_SERVER_SECRET;

const reply = (res, status, data) => res.status(status).json(data);
const text = (value, length) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, length);
const validPlayerId = (value) => /^[A-Za-z0-9_:-]{1,180}$/.test(value);
function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function agentId(req) {
  const id = text(req.headers['x-extreme-delivery-agent'], 80);
  if (!AGENT_SECRET || !safeEqual(req.headers['x-extreme-delivery-key'], AGENT_SECRET)) return null;
  return /^[a-z0-9][a-z0-9_-]{2,79}$/i.test(id) ? id : null;
}
async function service(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.hint || `Supabase ${response.status}`);
  return data;
}
function playersFrom(value) {
  if (!Array.isArray(value)) return [];
  const byId = new Map();
  value.slice(0, 200).forEach((raw) => {
    const playerId = text(raw?.playerId, 180);
    const name = text(raw?.name, 80);
    if (validPlayerId(playerId) && name) byId.set(playerId, { playerId, name });
  });
  return [...byId.values()];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return reply(res, 405, { error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_ROLE || !AGENT_SECRET) return reply(res, 503, { error: 'Rastreamento ainda não configurado.' });
  const reporter = agentId(req);
  if (!reporter) return reply(res, 401, { error: 'Agente de atividade não autorizado.' });

  try {
    const serverNumber = Number(req.body?.serverNumber);
    if (![1, 2].includes(serverNumber)) return reply(res, 400, { error: 'Servidor inválido.' });
    const online = playersFrom(req.body?.players);
    const joined = new Set(playersFrom(req.body?.joins).map((player) => player.playerId));
    const left = playersFrom(req.body?.leaves);
    const now = new Date().toISOString();
    const [existingRows, bindings] = await Promise.all([
      service(`server_player_activity?server_number=eq.${serverNumber}&select=*`),
      service(`player_server_bindings?server_number=eq.${serverNumber}&select=user_id,player_id`)
    ]);
    const existing = new Map((existingRows || []).map((row) => [row.player_id, row]));
    const linked = new Map((bindings || []).map((row) => [row.player_id, row.user_id]));
    const writes = new Map();
    online.forEach((player) => {
      const previous = existing.get(player.playerId);
      writes.set(player.playerId, {
        server_number: serverNumber,
        player_id: player.playerId,
        last_known_name: player.name,
        linked_user_id: linked.get(player.playerId) || previous?.linked_user_id || null,
        first_seen_at: previous?.first_seen_at || now,
        last_login_at: joined.has(player.playerId) ? now : previous?.last_login_at || null,
        last_logout_at: previous?.last_logout_at || null,
        last_seen_at: now,
        is_online: true,
        updated_at: now
      });
    });
    left.forEach((player) => {
      const previous = existing.get(player.playerId);
      writes.set(player.playerId, {
        server_number: serverNumber,
        player_id: player.playerId,
        last_known_name: player.name || previous?.last_known_name || 'Jogador',
        linked_user_id: linked.get(player.playerId) || previous?.linked_user_id || null,
        first_seen_at: previous?.first_seen_at || now,
        last_login_at: previous?.last_login_at || null,
        last_logout_at: now,
        last_seen_at: previous?.last_seen_at || now,
        is_online: false,
        updated_at: now
      });
    });
    if (writes.size) await service('server_player_activity?on_conflict=server_number,player_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify([...writes.values()]) });
    await service('server_activity_agents?on_conflict=server_number', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ server_number: serverNumber, agent_id: reporter, player_count: online.length, last_report_at: now, updated_at: now }) });
    return reply(res, 200, { ok: true, serverNumber, online: online.length, joins: joined.size, leaves: left.length, observedAt: now });
  } catch (error) {
    console.error('[player-activity] failed', { message: error?.message });
    return reply(res, 500, { error: 'Não foi possível registrar a atividade do servidor.' });
  }
}
