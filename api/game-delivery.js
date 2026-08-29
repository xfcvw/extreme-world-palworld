import crypto from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DELIVERY_SECRET = process.env.EXTREME_DELIVERY_SERVER_SECRET;

const json = (res, status, data) => res.status(status).json(data);

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function deliveryAgent(req) {
  const secret = req.headers['x-extreme-delivery-key'];
  const agentId = String(req.headers['x-extreme-delivery-agent'] || '').trim();
  if (!DELIVERY_SECRET || !safeEqual(secret, DELIVERY_SECRET)) return null;
  if (!/^[a-z0-9][a-z0-9_-]{2,79}$/i.test(agentId)) return null;
  return agentId;
}

async function serviceRpc(functionName, payload) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.hint || 'Falha na fila de entregas.');
  return data;
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_ROLE || !DELIVERY_SECRET) return json(res, 503, { error: 'Entrega automática não configurada.' });

  const agentId = deliveryAgent(req);
  if (!agentId) return json(res, 401, { error: 'Agente de entrega não autorizado.' });

  try {
    if (req.method === 'GET') {
      if (Number(req.query?.server) !== 1) return json(res, 400, { error: 'A entrega automática está disponível apenas no servidor Sem Wipe.' });
      const jobs = await serviceRpc('claim_next_game_delivery', { p_server_number: 1, p_agent_id: agentId });
      const job = Array.isArray(jobs) ? jobs[0] : jobs;
      if (!job) return res.status(204).end();
      return json(res, 200, { job });
    }

    const jobId = String(req.body?.jobId || '');
    const claimToken = String(req.body?.claimToken || '');
    const result = String(req.body?.result || '');
    const error = String(req.body?.error || '').slice(0, 500);
    if (!/^[0-9a-f-]{36}$/i.test(jobId) || !/^[0-9a-f-]{36}$/i.test(claimToken)) {
      return json(res, 400, { error: 'Identificador de entrega inválido.' });
    }
    if (!['delivered', 'deferred', 'failed'].includes(result)) return json(res, 400, { error: 'Resultado de entrega inválido.' });

    await serviceRpc('complete_game_delivery', {
      p_job_id: jobId,
      p_claim_token: claimToken,
      p_agent_id: agentId,
      p_result: result,
      p_error: error || null
    });
    return json(res, 200, { ok: true });
  } catch (error) {
    console.error('game delivery error', error);
    if (/delivery claim (is no longer active|not found)/i.test(String(error?.message || ''))) {
      return json(res, 409, { error: 'Resultado de entrega já foi processado.' });
    }
    return json(res, 500, { error: 'Não foi possível atualizar a entrega.' });
  }
}
