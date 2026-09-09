import crypto from 'node:crypto';

const servers = {
  1: {
    url: process.env.PALWORLD_SERVER_1_API_URL,
    username: process.env.PALWORLD_SERVER_1_API_USERNAME,
    password: process.env.PALWORLD_SERVER_1_ADMIN_PASSWORD,
  },
  2: {
    url: process.env.PALWORLD_SERVER_2_API_URL,
    username: process.env.PALWORLD_SERVER_2_API_USERNAME,
    password: process.env.PALWORLD_SERVER_2_ADMIN_PASSWORD,
  },
};
const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AUTOMATED_SYNC_KEY = process.env.PALWORLD_SYNC_CRON_SECRET;

function json(res, status, body, { privateResponse = false } = {}) {
  res.setHeader(
    'Cache-Control',
    privateResponse ? 'private, no-store' : 's-maxage=15, stale-while-revalidate=30'
  );
  return res.status(status).json(body);
}
function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function firstNumber(source, keys) {
  for (const key of keys) {
    const value = asNumber(source?.[key]);
    if (value !== null) return value;
  }
  return null;
}
function firstText(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}
function makeBaseUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.href.replace(/\/+$/, '') : null;
  } catch {
    return null;
  }
}
function normalized(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}
function profileNickname(profile, server) {
  return String(
    profile?.[`palworld_nickname_server_${server}`] || profile?.palworld_nickname || ''
  ).trim();
}

async function readApi(baseUrl, credentials, path) {
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 7000),
    started = Date.now();
  try {
    const response = await fetch(`${baseUrl}/v1/api/${path}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
      },
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      data: await response.json().catch(() => null),
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchServer(number, { withPlayers = false } = {}) {
  const server = servers[number],
    baseUrl = makeBaseUrl(server?.url);
  if (!server || !baseUrl || !server.username || !server.password)
    return {
      server: number,
      configured: false,
      online: false,
      status: 'not_configured',
      updatedAt: new Date().toISOString(),
    };
  try {
    const requests = [readApi(baseUrl, server, 'info'), readApi(baseUrl, server, 'metrics')];
    if (withPlayers) requests.push(readApi(baseUrl, server, 'players'));
    const [infoResult, metricsResult, playersResult] = await Promise.all(requests);
    if (!infoResult.ok)
      return {
        server: number,
        configured: true,
        online: false,
        status: infoResult.status === 401 ? 'authorization_failed' : 'unreachable',
        updatedAt: new Date().toISOString(),
      };
    const info = infoResult.data || {},
      metrics = metricsResult.ok ? metricsResult.data : {};
    return {
      server: number,
      configured: true,
      online: true,
      status: 'online',
      name: String(info.servername || info.serverName || `Servidor ${number}`),
      description: String(info.description || ''),
      version: String(info.version || ''),
      playersOnline: firstNumber(metrics, [
        'currentplayernum',
        'currentPlayerNum',
        'playernum',
        'playerNum',
      ]),
      playersMax: firstNumber(metrics, [
        'maxplayernum',
        'maxPlayerNum',
        'maxplayers',
        'maxPlayers',
      ]),
      serverFps: firstNumber(metrics, ['serverfps', 'serverFps', 'fps']),
      apiLatencyMs: infoResult.latencyMs,
      updatedAt: new Date().toISOString(),
      playersResult: withPlayers ? playersResult : null,
    };
  } catch (error) {
    console.error('[palworld-status] failed', { server: number, message: error?.message });
    return {
      server: number,
      configured: true,
      online: false,
      status: 'unreachable',
      updatedAt: new Date().toISOString(),
    };
  }
}

function playerRows(data) {
  if (Array.isArray(data)) return data;
  for (const key of ['players', 'playerlist', 'playerList', 'data'])
    if (Array.isArray(data?.[key])) return data[key];
  return [];
}
function safeCharacter(row, server) {
  if (!row) return null;
  return {
    server,
    characterName: firstText(row, ['name', 'playerName', 'nickname', 'nickName']),
    level: firstNumber(row, ['level', 'playerLevel']),
    guild: firstText(row, ['guildName', 'guild', 'guild_name']),
    lastConnection: firstText(row, ['lastOnline', 'last_online', 'lastLogin', 'last_login']),
    playerId: firstText(row, ['playerId', 'player_id', 'uid']),
    ping: firstNumber(row, ['ping', 'latency']),
  };
}

function serviceHeaders(extra = {}) {
  return { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, ...extra };
}
async function readPlayerBindings(userId) {
  if (!SUPABASE_URL || !SERVICE_ROLE) return [];
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/player_server_bindings?user_id=eq.${encodeURIComponent(userId)}&select=*&order=server_number.asc`,
    { headers: serviceHeaders() }
  );
  if (!response.ok) {
    console.error('[palworld-player] binding read failed', { status: response.status });
    return [];
  }
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}
async function savePlayerBinding(userId, character) {
  if (!SUPABASE_URL || !SERVICE_ROLE || !character?.playerId) return null;
  const now = new Date().toISOString();
  const payload = {
    user_id: userId,
    server_number: character.server,
    player_id: character.playerId,
    nickname: character.characterName || 'Jogador',
    character_name: character.characterName || null,
    level: character.level,
    guild: character.guild || null,
    last_connection: character.lastConnection || null,
    last_seen_at: now,
    last_synced_at: now,
  };
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/player_server_bindings?on_conflict=user_id,server_number`,
    {
      method: 'POST',
      headers: serviceHeaders({
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      }),
      body: JSON.stringify(payload),
    }
  );
  if (!response.ok) {
    console.error('[palworld-player] binding save failed', {
      server: character.server,
      status: response.status,
    });
    return null;
  }
  const rows = await response.json().catch(() => []);
  return rows?.[0] || payload;
}

async function readServerBindings(serverNumber) {
  if (!SUPABASE_URL || !SERVICE_ROLE) return [];
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/player_server_bindings?server_number=eq.${encodeURIComponent(serverNumber)}&select=user_id,server_number,player_id,nickname,character_name,level,guild,last_connection`,
    { headers: serviceHeaders() }
  );
  if (!response.ok)
    throw new Error(
      `Não foi possível ler os vínculos do servidor ${serverNumber} (${response.status})`
    );
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}
async function saveServerSyncStatus(payload) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/server_sync_status?on_conflict=server_number`,
    {
      method: 'POST',
      headers: serviceHeaders({
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      }),
      body: JSON.stringify(payload),
    }
  );
  if (!response.ok)
    throw new Error(`Não foi possível registrar a sincronização (${response.status})`);
}
function secureEquals(received, expected) {
  const left = Buffer.from(String(received || '')),
    right = Buffer.from(String(expected || ''));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}
async function syncKnownPlayers(serverNumber) {
  const attemptedAt = new Date().toISOString();
  const result = await fetchServer(serverNumber, { withPlayers: true });
  if (!result.online) {
    await saveServerSyncStatus({
      server_number: serverNumber,
      last_attempt_at: attemptedAt,
      status: 'unreachable',
      online_player_count: 0,
      matched_bindings: 0,
      last_error: result.status || 'unreachable',
    });
    return { server: serverNumber, status: 'unreachable', matchedBindings: 0 };
  }
  if (!result.playersResult?.ok) {
    await saveServerSyncStatus({
      server_number: serverNumber,
      last_attempt_at: attemptedAt,
      status: 'degraded',
      online_player_count: result.playersOnline ?? 0,
      matched_bindings: 0,
      last_error: `players endpoint ${result.playersResult?.status || 'failed'}`,
    });
    return { server: serverNumber, status: 'degraded', matchedBindings: 0 };
  }
  const [bindings, players] = await Promise.all([
    readServerBindings(serverNumber),
    Promise.resolve(playerRows(result.playersResult.data)),
  ]);
  const bindingsByPlayerId = new Map();
  for (const binding of bindings) {
    const id = String(binding.player_id || '');
    if (!id) continue;
    const matching = bindingsByPlayerId.get(id) || [];
    matching.push(binding);
    bindingsByPlayerId.set(id, matching);
  }
  const now = new Date().toISOString(),
    updates = [];
  for (const row of players) {
    const character = safeCharacter(row, serverNumber),
      matches = bindingsByPlayerId.get(String(character?.playerId || '')) || [];
    for (const binding of matches) {
      updates.push({
        user_id: binding.user_id,
        server_number: serverNumber,
        player_id: binding.player_id,
        nickname: character.characterName || binding.nickname || 'Jogador',
        character_name: character.characterName || binding.character_name || null,
        level: character.level ?? binding.level ?? null,
        guild: character.guild || binding.guild || null,
        last_connection: character.lastConnection || binding.last_connection || null,
        last_seen_at: now,
        last_synced_at: now,
      });
    }
  }
  if (updates.length) {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/player_server_bindings?on_conflict=user_id,server_number`,
      {
        method: 'POST',
        headers: serviceHeaders({
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates',
        }),
        body: JSON.stringify(updates),
      }
    );
    if (!response.ok)
      throw new Error(
        `Não foi possível atualizar jogadores do servidor ${serverNumber} (${response.status})`
      );
  }
  await saveServerSyncStatus({
    server_number: serverNumber,
    last_attempt_at: attemptedAt,
    last_success_at: now,
    status: 'online',
    online_player_count: players.length,
    matched_bindings: updates.length,
    last_error: null,
  });
  return {
    server: serverNumber,
    status: 'online',
    onlinePlayers: players.length,
    matchedBindings: updates.length,
  };
}
function characterFromBinding(binding, server) {
  if (!binding) return null;
  return {
    server,
    characterName: binding.character_name || binding.nickname || '',
    level: binding.level ?? null,
    guild: binding.guild || '',
    lastConnection: binding.last_connection || '',
    playerId: binding.player_id || '',
    lastSyncedAt: binding.last_synced_at || null,
    source: 'snapshot',
  };
}

async function authenticatedProfile(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !SUPABASE_URL || !PUBLISHABLE || !SERVICE_ROLE) return null;
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${token}` },
  });
  const user = await userResponse.json().catch(() => null);
  if (!userResponse.ok || !user?.id) return null;
  const profileResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(user.id)}&select=palworld_nickname,palworld_nickname_server_1,palworld_nickname_server_2,default_server`,
    { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } }
  );
  const profiles = await profileResponse.json().catch(() => []);
  return { userId: user.id, profile: profiles?.[0] || null };
}

async function currentPlayer(req, res) {
  const account = await authenticatedProfile(req);
  if (!account?.profile)
    return json(
      res,
      401,
      { error: 'Sua sessão expirou. Entre novamente.' },
      { privateResponse: true }
    );
  const { userId, profile } = account;
  const nickname = String(profile.palworld_nickname || '').trim();
  const numbers = [1];
  const [savedBindings, results] = await Promise.all([
    readPlayerBindings(userId),
    Promise.all(numbers.map((number) => fetchServer(number, { withPlayers: true }))),
  ]);
  const bindings = new Map(
    savedBindings.map((binding) => [Number(binding.server_number), binding])
  );
  const characters = [],
    serverLinks = [];
  for (const result of results) {
    let binding = bindings.get(result.server) || null;
    const rows = result.online ? playerRows(result.playersResult?.data) : [];
    let liveRow = null;
    if (binding) {
      liveRow = rows.find(
        (player) =>
          firstText(player, ['playerId', 'player_id', 'uid']) === String(binding.player_id)
      );
    } else if (profileNickname(profile, result.server)) {
      const matches = rows.filter(
        (player) =>
          normalized(firstText(player, ['name', 'playerName', 'nickname', 'nickName'])) ===
          normalized(profileNickname(profile, result.server))
      );
      if (matches.length === 1) liveRow = matches[0];
    }
    let character = liveRow
      ? safeCharacter(liveRow, result.server)
      : characterFromBinding(binding, result.server);
    if (liveRow && character?.playerId) {
      const saved = await savePlayerBinding(userId, character);
      if (saved) {
        binding = saved;
        bindings.set(result.server, saved);
        character = {
          ...character,
          lastSyncedAt: saved.last_synced_at || new Date().toISOString(),
          source: 'live',
        };
      }
    }
    const linked = Boolean(binding);
    if (character) characters.push(character);
    serverLinks.push({
      server: result.server,
      linked,
      online: Boolean(liveRow),
      serverAvailable: result.online,
      nickname: binding?.nickname || profileNickname(profile, result.server),
      character: character || null,
      lastSyncedAt: character?.lastSyncedAt || binding?.last_synced_at || null,
    });
  }
  const unavailable = results.every((result) => !result.online);
  const linkedCount = serverLinks.filter((link) => link.linked).length;
  return json(
    res,
    200,
    {
      found: characters.length > 0,
      unavailable,
      nickname,
      characters,
      serverLinks,
      servers: results.map(({ playersResult, ...server }) => server),
      updatedAt: new Date().toISOString(),
      message:
        unavailable && linkedCount === 0
          ? 'Não foi possível sincronizar seus dados no momento. Tente novamente em instantes.'
          : linkedCount
            ? 'Seu personagem está vinculado. O portal mantém a última leitura mesmo quando você está offline.'
            : nickname
              ? 'Entre uma vez no servidor com o NickName configurado para criar seu vínculo.'
              : 'Cadastre seu NickName do Palworld para iniciar a vinculação.',
    },
    { privateResponse: true }
  );
}

async function adminPlayerSync(req, res) {
  const account = await authenticatedProfile(req);
  if (!account?.userId) return json(res, 401, { error: 'Entre com Discord para continuar.' });
  try {
    const profileResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(account.userId)}&select=role&limit=1`,
      { headers: serviceHeaders() }
    );
    const [profile] = await profileResponse.json().catch(() => []);
    if (!profileResponse.ok || !['owner', 'admin', 'support'].includes(profile?.role))
      return json(res, 403, {
        error: 'Sua conta não possui permissão para ver as sincronizações.',
      });
    const [bindingsResponse, statusResponse] = await Promise.all([
      fetch(
        `${SUPABASE_URL}/rest/v1/player_server_bindings?select=user_id,server_number,player_id,nickname,character_name,level,guild,last_connection,last_seen_at,last_synced_at&order=last_synced_at.desc&limit=2000`,
        { headers: serviceHeaders() }
      ),
      fetch(
        `${SUPABASE_URL}/rest/v1/server_sync_status?select=server_number,last_attempt_at,last_success_at,status,online_player_count,matched_bindings,last_error&order=server_number.asc`,
        { headers: serviceHeaders() }
      ),
    ]);
    const [bindings, serverStatus] = await Promise.all([
      bindingsResponse.json().catch(() => []),
      statusResponse.json().catch(() => []),
    ]);
    if (!bindingsResponse.ok) throw new Error(`Supabase ${bindingsResponse.status}`);
    return json(
      res,
      200,
      {
        bindings: Array.isArray(bindings) ? bindings : [],
        serverStatus: statusResponse.ok && Array.isArray(serverStatus) ? serverStatus : [],
        generatedAt: new Date().toISOString(),
      },
      { privateResponse: true }
    );
  } catch (error) {
    console.error('[admin-player-sync] failed', { message: error?.message });
    return json(
      res,
      500,
      { error: 'Não foi possível carregar as sincronizações.' },
      { privateResponse: true }
    );
  }
}

async function automatedSync(req, res) {
  const received = req.headers['x-extreme-sync-key'];
  if (!AUTOMATED_SYNC_KEY)
    return json(
      res,
      503,
      { error: 'A sincronização automática ainda não foi configurada.' },
      { privateResponse: true }
    );
  if (!secureEquals(received, AUTOMATED_SYNC_KEY))
    return json(res, 401, { error: 'Não autorizado.' }, { privateResponse: true });
  try {
    const results = await Promise.all(
      [1].map(async (server) => {
        try {
          return await syncKnownPlayers(server);
        } catch (error) {
          console.error('[automated-palworld-sync] server failed', {
            server,
            message: error?.message,
          });
          try {
            await saveServerSyncStatus({
              server_number: server,
              last_attempt_at: new Date().toISOString(),
              status: 'error',
              online_player_count: 0,
              matched_bindings: 0,
              last_error: 'Erro interno na sincronização',
            });
          } catch {}
          return { server, status: 'error', matchedBindings: 0 };
        }
      })
    );
    return json(
      res,
      200,
      { ok: true, servers: results, finishedAt: new Date().toISOString() },
      { privateResponse: true }
    );
  } catch (error) {
    console.error('[automated-palworld-sync] failed', { message: error?.message });
    return json(
      res,
      500,
      { error: 'Não foi possível concluir a sincronização.' },
      { privateResponse: true }
    );
  }
}

export default async function handler(req, res) {
  const mode = String(req.query?.mode || '');
  if (req.method === 'GET' && mode === 'automated-sync') return automatedSync(req, res);
  if (req.method === 'GET' && mode === 'admin-sync') return adminPlayerSync(req, res);
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  if (mode === 'me') {
    try {
      return await currentPlayer(req, res);
    } catch (error) {
      console.error('[palworld-player] failed', { message: error?.message });
      return json(
        res,
        200,
        {
          found: false,
          unavailable: true,
          message:
            'Não foi possível sincronizar seus dados no momento. Tente novamente em instantes.',
        },
        { privateResponse: true }
      );
    }
  }
  const number = Number(req.query?.server || 1);
  if (!servers[number]) return json(res, 400, { error: 'Servidor inválido' });
  const result = await fetchServer(number);
  return json(
    res,
    result.online ? 200 : result.status === 'authorization_failed' ? 503 : 502,
    result
  );
}
