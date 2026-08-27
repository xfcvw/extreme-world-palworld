import { applyCatalogOverrides, getBaseGameCatalog } from '../lib/game-catalog.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const json = (res, status, data) => res.status(status).json(data);

async function serviceFetch(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.hint || 'Erro ao processar o pedido.');
  return data;
}

async function loadOverrides() {
  return serviceFetch('catalog_price_overrides?select=catalog_key,victory_coins_price,active');
}

function cleanRequestText(value, maxLength) {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, maxLength);
}

function readPalPreferences(value) {
  const requestedGender = String(value?.desiredGender || 'any');
  const gender = ['any', 'female', 'male'].includes(requestedGender) ? requestedGender : 'any';
  return {
    desired_gender: gender,
    desired_passives: cleanRequestText(value?.desiredPassives, 400),
    delivery_notes: cleanRequestText(value?.deliveryNotes, 500)
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!SUPABASE_URL || !PUBLISHABLE || !SERVICE_ROLE) return json(res, 503, { error: 'A carteira ainda não foi configurada.' });
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return json(res, 401, { error: 'Entre com Discord para comprar.' });
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${token}` } });
    const user = await userResponse.json().catch(() => null);
    if (!userResponse.ok || !user?.id) return json(res, 401, { error: 'Sua sessão expirou. Entre novamente.' });

    const catalogKey = String(req.body?.catalogKey || '');
    const serverNumber = Number(req.body?.serverNumber || 0);
    if (!catalogKey || ![1, 2].includes(serverNumber)) return json(res, 400, { error: 'Escolha um item e um servidor válidos.' });

    const [base, overrides] = await Promise.all([getBaseGameCatalog(), loadOverrides()]);
    const item = applyCatalogOverrides(base, overrides).find(row => row.key === catalogKey);
    if (!item) return json(res, 404, { error: 'Esse item não está disponível na loja.' });

    const requestedLevel = Number(req.body?.palLevel || 0);
    let selectedItem = item;
    if (item.category === 'pals') {
      if (![80, 255].includes(requestedLevel)) return json(res, 400, { error: 'Escolha o nível 80 ou 255 para o Pal.' });
      if (serverNumber === 2 && requestedLevel === 255) return json(res, 400, { error: 'No Extreme World com Wipe, Pals são entregues somente no nível 80.' });
      const priceByLevel = item.metadata?.price_by_level || {};
      const victoryCoins = Number(priceByLevel[requestedLevel]);
      if (!Number.isFinite(victoryCoins) || victoryCoins < 1) return json(res, 500, { error: 'O preço desse Pal ainda não foi configurado.' });
      const palPreferences = readPalPreferences(req.body?.palPreferences);
      selectedItem = {
        ...item,
        name: `${item.name} — Nível ${requestedLevel}`,
        victoryCoins,
        metadata: { ...item.metadata, level: requestedLevel, pal_preferences: palPreferences }
      };
    }
    if (['weapons', 'armor'].includes(item.category)) {
      const requestedTier = String(req.body?.equipmentTier || 'normal').toLowerCase();
      if (!['normal', 'legendary'].includes(requestedTier)) return json(res, 400, { error: 'Escolha a qualidade Normal ou Lendária.' });
      const victoryCoins = requestedTier === 'legendary' ? (item.category === 'weapons' ? 6 : 5) : item.category === 'weapons' ? 2 : 3;
      selectedItem = {
        ...item,
        name: `${item.name} — ${requestedTier === 'legendary' ? 'Lendária' : 'Normal'}`,
        victoryCoins,
        metadata: { ...item.metadata, equipment_tier: requestedTier }
      };
    }

    const result = await serviceFetch('rpc/create_catalog_order_with_victory_coins', {
      method: 'POST',
      body: JSON.stringify({
        p_user_id: user.id,
        p_catalog_key: selectedItem.key,
        p_name: selectedItem.name,
        p_category: selectedItem.category,
        p_victory_coins: selectedItem.victoryCoins,
        p_server_number: serverNumber,
        p_metadata: { ...selectedItem.metadata, source_url: item.sourceUrl, quantity_label: item.quantityLabel }
      })
    });
    return json(res, 200, { orderId: result, item: selectedItem.name, victoryCoins: selectedItem.victoryCoins });
  } catch (error) {
    console.error('catalog purchase error', error);
    const message = String(error?.message || '');
    if (message.includes('insufficient balance')) return json(res, 400, { error: 'Saldo insuficiente de Moedas da Vitória.' });
    if (message.includes('palworld nickname required')) return json(res, 400, { error: 'Cadastre seu NickName antes da compra.' });
    if (message.includes('wallet not found')) return json(res, 400, { error: 'Sua carteira ainda não está pronta. Atualize a página e tente novamente.' });
    return json(res, 500, { error: 'Não foi possível criar o pedido agora. Tente novamente.' });
  }
}
