import { applyCatalogOverrides, catalogSummary, getBaseGameCatalog } from '../lib/game-catalog.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const json = (res, status, data) => res.status(status).json(data);

async function loadOverrides() {
  if (!SUPABASE_URL || !SERVICE_ROLE) return [];
  const response = await fetch(`${SUPABASE_URL}/rest/v1/catalog_price_overrides?select=catalog_key,victory_coins_price,equipment_normal_price,equipment_legendary_price,active`, {
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` }
  });
  if (!response.ok) throw new Error('catalog overrides unavailable');
  return response.json();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  try {
    const [base, overrides] = await Promise.all([getBaseGameCatalog(), loadOverrides()]);
    const includeInactive = String(req.query?.includeInactive || '') === '1';
    const catalog = applyCatalogOverrides(base, overrides, { includeInactive });
    const category = String(req.query?.category || '').toLowerCase();
    const rows = ['pals', 'weapons', 'armor', 'resources'].includes(category) ? catalog.filter(item => item.category === category) : catalog;
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
    return json(res, 200, { items: rows, summary: catalogSummary(catalog), updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('game catalog error', error);
    return json(res, 503, { error: 'O catálogo está sendo atualizado. Tente novamente em instantes.' });
  }
}
