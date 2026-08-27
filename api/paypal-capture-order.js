import { paypalConfigured, paypalRequest } from './lib/paypal.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const json = (res, status, data) => res.status(status).json(data);

async function sb(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...options, headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(options.headers || {}) } });
  const data = await response.json().catch(() => null); if (!response.ok) throw new Error(data?.message || data?.hint || 'Erro ao confirmar pagamento.'); return data;
}
async function rpc(name, body) { return sb(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body) }); }

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!SUPABASE_URL || !PUBLISHABLE || !SERVICE_ROLE || !paypalConfigured()) return json(res, 503, { error: 'PayPal ainda não está configurado.' });
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${token}` } });
    const user = await userResponse.json().catch(() => null); if (!userResponse.ok || !user?.id) return json(res, 401, { error: 'Sua sessão expirou. Entre novamente.' });
    const paypalOrderId = String(req.body?.paypalOrderId || ''); if (!paypalOrderId) return json(res, 400, { error: 'Pedido PayPal inválido.' });
    const rows = await sb(`payments?provider=eq.paypal&provider_payment_id=eq.${encodeURIComponent(paypalOrderId)}&select=id,order_id,orders!inner(user_id,order_number)`);
    const payment = rows?.[0]; if (!payment || payment.orders?.user_id !== user.id) return json(res, 404, { error: 'Pedido PayPal não encontrado.' });
    const captured = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, { method: 'POST', body: {} });
    const status = captured.status === 'COMPLETED' ? 'approved' : captured.status === 'PAYER_ACTION_REQUIRED' ? 'pending' : 'rejected';
    await rpc('process_paypal_payment', { p_order_id: payment.order_id, p_provider_payment_id: paypalOrderId, p_status: status, p_raw_status: String(captured.status || ''), p_metadata: captured });
    return json(res, 200, { status, orderNumber: payment.orders.order_number });
  } catch (error) {
    console.error('paypal capture order error', error);
    return json(res, 400, { error: error.message || 'Não foi possível concluir o pagamento PayPal.' });
  }
}
