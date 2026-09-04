import { applyCatalogOverrides, catalogSummary, getBaseGameCatalog } from '../lib/game-catalog.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const json = (res, status, data) => res.status(status).json(data);

async function serviceFetch(path) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.hint || 'catalog unavailable');
  return data || [];
}

async function loadOverrides() {
  if (!SUPABASE_URL || !SERVICE_ROLE) return [];
  return serviceFetch(
    'catalog_price_overrides?select=catalog_key,victory_coins_price,equipment_normal_price,equipment_legendary_price,pal_level_80_price,pal_level_255_price,pal_level_80_active,pal_level_255_active,active'
  );
}

async function loadPublicStoreCatalog() {
  if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error('catalog unavailable');
  const [vips, benefits, products] = await Promise.all([
    serviceFetch(
      'vip_plans?active=eq.true&select=id,name,slug,description,price_cents,featured,sort_order&order=sort_order.asc'
    ),
    serviceFetch('vip_benefits?select=vip_plan_id,benefit,sort_order&order=sort_order.asc'),
    serviceFetch(
      'products?active=eq.true&select=id,name,slug,description,product_type,price_cents,image_url,featured,metadata,vip_plan_id,currency_amount&order=price_cents.asc'
    ),
  ]);
  return { vips, benefits, products };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  try {
    if (String(req.query?.public || '') === '1') {
      const catalog = await loadPublicStoreCatalog();
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      return json(res, 200, catalog);
    }
    const [base, overrides] = await Promise.all([getBaseGameCatalog(), loadOverrides()]);
    const includeInactive = String(req.query?.includeInactive || '') === '1';
    const catalog = applyCatalogOverrides(base, overrides, { includeInactive });
    const category = String(req.query?.category || '').toLowerCase();
    const rows = ['pals', 'weapons', 'armor', 'resources'].includes(category)
      ? catalog.filter((item) => item.category === category)
      : catalog;
    // Preços são alterados pelo painel e precisam aparecer imediatamente para
    // quem acabou de salvar e para todos os jogadores na loja.
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return json(res, 200, {
      items: rows,
      summary: catalogSummary(catalog),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('game catalog error', error);
    return json(res, 503, {
      error: 'O catálogo está sendo atualizado. Tente novamente em instantes.',
    });
  }
}
