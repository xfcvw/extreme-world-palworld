const clientId = () => process.env.PAYPAL_CLIENT_ID || '';
const clientSecret = () => process.env.PAYPAL_CLIENT_SECRET || '';
const apiBase = () => String(process.env.PAYPAL_ENV || 'live').toLowerCase() === 'sandbox'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com';

export function paypalConfigured() { return Boolean(clientId() && clientSecret()); }

export async function paypalAccessToken() {
  const credentials = Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64');
  const response = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) throw new Error(data?.error_description || 'Não foi possível conectar ao PayPal.');
  return data.access_token;
}

export async function paypalRequest(path, { method = 'GET', body } = {}) {
  const token = await paypalAccessToken();
  const response = await fetch(`${apiBase()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.details?.[0]?.description || 'O PayPal não conseguiu processar o pagamento.');
  return data;
}
