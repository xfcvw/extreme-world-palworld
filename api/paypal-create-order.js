import { paypalConfigured, paypalRequest } from '../lib/paypal.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MV_UNIT_PRICE_CENTS = 50;
const json = (res, status, data) => res.status(status).json(data);

async function sb(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.hint || 'Erro ao preparar o pagamento.');
  return data;
}

async function currentUser(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('Faça login com Discord.');
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${token}` } });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id) throw new Error('Sua sessão expirou. Entre novamente.');
  return user;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!SUPABASE_URL || !PUBLISHABLE || !SERVICE_ROLE || !paypalConfigured()) return json(res, 503, { error: 'PayPal ainda não está configurado.' });
  try {
    const user = await currentUser(req);
    const productId = String(req.body?.productId || '');
    const currencyQuantity = Number(req.body?.currencyQuantity || 0);
    const products = await sb(`products?id=eq.${encodeURIComponent(productId)}&active=eq.true&product_type=eq.currency&select=*`);
    const product = products?.[0];
    if (!product) return json(res, 404, { error: 'Compra de moedas indisponível.' });
    if (!Number.isInteger(currencyQuantity) || currencyQuantity < 10 || currencyQuantity > 10000) return json(res, 400, { error: 'No PayPal, escolha entre 10 e 10.000 Moedas da Vitória.' });
    const usdCents = Math.round((currencyQuantity * MV_UNIT_PRICE_CENTS) / 5);
    const profiles = await sb(`profiles?user_id=eq.${user.id}&select=palworld_nickname,default_server`);
    const nick = profiles?.[0]?.palworld_nickname;
    if (!nick) return json(res, 400, { error: 'Cadastre seu NickName antes da compra.' });

    const itemName = `${currencyQuantity} Moedas da Vitória`;
    const internalOrder = (await sb('orders', { method: 'POST', body: JSON.stringify({ user_id: user.id, status: 'pending_payment', payment_method: 'paypal', subtotal_cents: 0, total_cents: 0, palworld_nickname: nick, server_number: Number(profiles?.[0]?.default_server) || 1, notes: `PayPal USD ${(usdCents / 100).toFixed(2)} · ${currencyQuantity} MV` }) }))?.[0];
    await sb('order_items', { method: 'POST', body: JSON.stringify({ order_id: internalOrder.id, product_id: product.id, name_snapshot: itemName, quantity: currencyQuantity, unit_price_cents: 0, metadata: { paypal_usd_cents: usdCents, currency_quantity: currencyQuantity, unit_price_cents: MV_UNIT_PRICE_CENTS } }) });
    const payment = (await sb('payments', { method: 'POST', body: JSON.stringify({ order_id: internalOrder.id, provider: 'paypal', status: 'pending', payment_method: 'paypal', amount_cents: usdCents, metadata: { currency: 'USD', integration: 'paypal_orders_v2', currency_quantity: currencyQuantity } }) }))?.[0];
    const paypalOrder = await paypalRequest('/v2/checkout/orders', { method: 'POST', body: { intent: 'CAPTURE', purchase_units: [{ reference_id: internalOrder.id, description: itemName.slice(0, 127), amount: { currency_code: 'USD', value: (usdCents / 100).toFixed(2) } }] } });
    await sb(`payments?id=eq.${payment.id}`, { method: 'PATCH', body: JSON.stringify({ provider_payment_id: paypalOrder.id, raw_status: paypalOrder.status, metadata: { currency: 'USD', paypal_order: paypalOrder } }) });
    return json(res, 200, { paypalOrderId: paypalOrder.id });
  } catch (error) {
    console.error('paypal create order error', error);
    return json(res, 400, { error: error.message || 'Não foi possível preparar o pagamento PayPal.' });
  }
}
