const PALS_SOURCE = 'https://raw.githubusercontent.com/dgonzalez2019/PalworldBreeding/main/data/pals.json';
const ITEMS_SOURCE = 'https://raw.githubusercontent.com/Maurixs/palworld-crafting-calculator/refs/heads/main/palworld_items.json';
const PAL_ICON_BASE = 'https://palworld.gg/_ipx/q_80%26s_130x130/images/full_palicon/';
const ITEM_ICON_BASE = 'https://palworld.gg/_ipx/q_80%26s_96x96/images/items/';
const CATEGORY_FALLBACK_IMAGES = Object.freeze({
  weapons: 'https://palworld.gg/_ipx/q_80%26s_58x58/images/items/T_itemicon_Weapon_SkyBow.png',
  armor: 'https://palworld.gg/_ipx/q_80%26s_58x58/images/items/T_itemicon_Armor_AncientArmor.png'
});
const CACHE_MS = 15 * 60 * 1000;

const RARE_RESOURCE_KEYS = new Set([
  'PalSphere_Legend', 'PalSphere_Ultimate', 'PalSphere_Exotic', 'PalSphere_Ancient_1', 'PalSphere_Ancient_2',
  'StealIngot', 'Plastic', 'StainlessSteel', 'SkyislandIngot', 'WorldTreeIngot', 'ManganeseIngot',
  'CarbonFiber', 'Polymer', 'PalOil', 'PalCrystal_Ex', 'AncientParts2', 'AIcore', 'Bio_Battery',
  'Thermal_Core', 'Bio_Coolant', 'Wood_WorldTree'
]);

let cachedCatalog = null;
let cachedAt = 0;

function safeText(value, fallback = '') {
  return String(value ?? fallback).replace(/[\u0000-\u001f]/g, ' ').trim();
}

function itemImage(asset) {
  const filename = safeText(asset).replace(/^.*[\\/]/, '');
  if (!filename) return null;
  const assetName = /\.(?:png|webp|jpg|jpeg)$/i.test(filename) ? filename : `${filename}.png`;
  return `${ITEM_ICON_BASE}${encodeURIComponent(assetName)}`;
}

function proxiedImage(source, fallbackCategory = '') {
  const url = safeText(source);
  if (!url) return null;
  const fallback = fallbackCategory ? `&fallback=${encodeURIComponent(fallbackCategory)}` : '';
  return `/api/palworld-image?src=${encodeURIComponent(url)}${fallback}`;
}

function uniqueUrls(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizedName(value) {
  return safeText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toLowerCase();
}

function comparableName(value) {
  return normalizedName(value).replace(/\b(?:de|da|do|das|dos|e)\b/g, '').replace(/[^a-z0-9]/g, '');
}

function pageImageForName(pageImages, name) {
  if (!pageImages?.size) return null;
  const exact = pageImages.get(normalizedName(name));
  if (exact) return exact;
  const comparable = comparableName(name);
  for (const [pageName, image] of pageImages) {
    const candidate = comparableName(pageName);
    if (candidate === comparable || (candidate.length > 5 && (candidate.includes(comparable) || comparable.includes(candidate)))) return image;
  }
  return null;
}

// O ID da receita não é necessariamente o mesmo texto salvo no campo `icon`
// da base comunitária. No Palworld.gg, armas e armaduras usam o nome de asset
// oficial T_itemicon_Weapon_* / T_itemicon_Armor_*. Geramos primeiro essa URL
// e mantemos o ícone vindo da base como segunda tentativa para itens especiais.
function equipmentImages(item, key, category, pageImages, name) {
  const family = category === 'weapons' ? 'Weapon' : 'Armor';
  const rawIcon = safeText(item?.icon).replace(/^.*[\\/]/, '').replace(/\.(?:png|webp|jpg|jpeg)$/i, '');
  const officialAsset = `T_itemicon_${family}_${safeText(key)}`;
  const iconAsset = rawIcon.startsWith('T_itemicon_') ? rawIcon : rawIcon ? `T_itemicon_${family}_${rawIcon}` : '';
  const fromPalworldPage = pageImageForName(pageImages, name);
  return uniqueUrls([
    fromPalworldPage,
    itemImage(officialAsset),
    itemImage(iconAsset),
    itemImage(rawIcon),
    CATEGORY_FALLBACK_IMAGES[category]
  ]).map(url => proxiedImage(url, category));
}

function palImage(icon) {
  return icon ? `${PAL_ICON_BASE}${encodeURIComponent(`${icon}.png`)}` : null;
}

const PAL_CLASS_PRICES = Object.freeze({
  D: Object.freeze({ 80: 15, 255: 20 }),
  C: Object.freeze({ 80: 18, 255: 23 }),
  B: Object.freeze({ 80: 24, 255: 28 }),
  A: Object.freeze({ 80: 25, 255: 30 }),
  S: Object.freeze({ 80: 35, 255: 38 })
});

function palCombatScore(pal) {
  const stats = pal?.stats || {};
  return Number(stats.hp || 0) + Number(stats.attack || 0) + Number(stats.defense || 0)
    + Math.min(150, Number(stats.rideSpeed || 0) / 10) + Number(pal?.rarity || 0) * 16;
}

// Mantém todas as formas no catálogo e as separa em cinco faixas de poder.
// A faixa e os preços ficam na própria resposta da API; o navegador nunca
// decide o valor que será cobrado na carteira.
function assignPalClasses(pals) {
  const sorted = [...pals].sort((a, b) => palCombatScore(b) - palCombatScore(a) || Number(b.paldex || 0) - Number(a.paldex || 0));
  const total = Math.max(1, sorted.length);
  const byKey = new Map();
  sorted.forEach((pal, index) => {
    // Proporção das cinco listas de classe enviadas pela administração:
    // S 15, A 45, B 75, C 90 e D 74 (299 Pals no catálogo atual).
    const rank = Math.ceil(((index + 1) * 299) / total);
    const palClass = rank <= 15 ? 'S' : rank <= 60 ? 'A' : rank <= 135 ? 'B' : rank <= 225 ? 'C' : 'D';
    byKey.set(safeText(pal.key), palClass);
  });
  return byKey;
}

export function equipmentTier(item, key) {
  const names = Object.values(item?.names || {}).join(' ');
  const markers = [
    key,
    names,
    item?.rarity,
    item?.quality,
    item?.grade,
    item?.rank,
    item?.itemRank,
    item?.tier
  ].filter(value => value !== undefined && value !== null).join(' ').toLowerCase();

  if (/legendary|lend[áa]ri[oa]/i.test(markers)) return 'legendary';

  // Algumas versões da base de itens usam o sufixo 5 ou um campo de
  // qualidade/raridade 5 para a variação lendária.
  const qualityFields = [item?.rarity, item?.quality, item?.grade, item?.rank, item?.itemRank, item?.tier];
  if (qualityFields.some(value => Number(value) >= 5) || /(?:_|-|\s)5$/.test(String(key || ''))) return 'legendary';
  return 'normal';
}

export function equipmentPrice(item, category, key) {
  const legendary = equipmentTier(item, key) === 'legendary';
  if (category === 'weapons') return legendary ? 5 : 2;
  return legendary ? 5 : 3;
}

function resourceQuantity(key) {
  if (key.startsWith('PalSphere_')) return 20;
  if (['AncientParts2', 'AIcore', 'Bio_Battery', 'Thermal_Core'].includes(key)) return 10;
  return 50;
}

function resourcePrice(item, key) {
  const level = Number(item.level || 35);
  const quantity = resourceQuantity(key);
  const multiplier = key.startsWith('PalSphere_') ? 1.35 : 1;
  return Math.round((220 + level * 22 + quantity * 3) * multiplier);
}

function normalizePals(data) {
  const pals = Array.isArray(data?.pals) ? data.pals : [];
  const classes = assignPalClasses(pals);
  return pals.map(pal => {
    const palClass = classes.get(safeText(pal.key)) || 'D';
    const priceByLevel = PAL_CLASS_PRICES[palClass];
    return {
    key: `pal:${safeText(pal.key)}`,
    category: 'pals',
    name: safeText(pal.name),
    description: `Classe ${palClass} · escolha nível 80 ou 255 no momento da compra.`,
    quantityLabel: `Classe ${palClass}`,
    victoryCoins: priceByLevel[80],
    imageUrl: palImage(pal.icon),
    sourceUrl: 'https://palworld.gg/pt-BR/pals',
    metadata: {
      source: 'palworld.gg', pal_key: safeText(pal.key), paldex: Number(pal.paldex || 0),
      pal_class: palClass, price_by_level: priceByLevel, rarity: Number(pal.rarity || 1)
    }
  };
  }).filter(item => item.name && item.key !== 'pal:');
}

function localizedName(item) {
  return safeText(item?.names?.['pt-BR'] || item?.names?.en || 'Item');
}

function normalizeItems(data, pageImages = {}) {
  const rows = Object.entries(data || {});
  const equipment = rows.flatMap(([key, item]) => {
    const stationKind = safeText(item?.stationKind).toLowerCase();
    if (!['weapon', 'armor'].includes(stationKind)) return [];
    const category = stationKind === 'weapon' ? 'weapons' : 'armor';
    const name = localizedName(item);
    const imageUrls = equipmentImages(item, key, category, pageImages[category], name);
    return [{
      key: `${category === 'weapons' ? 'weapon' : 'armor'}:${key}`,
      category,
      name,
      description: `Equipamento ${equipmentTier(item, key) === 'legendary' ? 'Lendário' : 'Normal'} para entrega no servidor.`,
      quantityLabel: equipmentTier(item, key) === 'legendary' ? 'Lendária' : 'Normal',
      victoryCoins: equipmentPrice(item, category, key),
      imageUrl: imageUrls[0] || null,
      imageFallbackUrls: imageUrls.slice(1),
      sourceUrl: `https://palworld.gg/pt-BR/${category === 'weapons' ? 'weapons' : 'armor'}`,
      metadata: {
        source: 'palworld.gg', item_key: key, level: Number(item.level || 1), station_kind: stationKind,
        equipment_tier: equipmentTier(item, key)
      }
    }];
  });
  const resources = rows.flatMap(([key, item]) => {
    if (!RARE_RESOURCE_KEYS.has(key)) return [];
    const quantity = resourceQuantity(key);
    return [{
      key: `resource:${key}`,
      category: 'resources',
      name: localizedName(item),
      description: `Pacote de recurso raro para entrega no servidor.`,
      quantityLabel: `${quantity} unidades`,
      victoryCoins: resourcePrice(item, key),
      imageUrl: itemImage(item.icon),
      sourceUrl: 'https://palworld.gg/pt-BR/items',
      metadata: { source: 'palworld.gg', item_key: key, quantity, level: Number(item.level || 0) }
    }];
  });
  return [...equipment, ...resources];
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'ExtremeWorldCatalog/1.0' } });
    if (!response.ok) throw new Error(`catalog source responded ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPageImageMap(category) {
  const url = `https://palworld.gg/pt-BR/${category === 'weapons' ? 'weapons' : 'armor'}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'ExtremeWorldCatalog/1.0', Accept: 'text/html' } });
    if (!response.ok) throw new Error(`Palworld.gg responded ${response.status}`);
    const html = await response.text();
    const images = new Map();
    for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
      const alt = tag.match(/\balt=["']([^"']+)["']/i)?.[1];
      const src = tag.match(/\b(?:src|data-src)=["']([^"']+)["']/i)?.[1];
      if (!alt || !src || !/\/images\/items\//.test(src)) continue;
      images.set(normalizedName(alt), new URL(src.replace(/&amp;/g, '&'), 'https://palworld.gg').toString());
    }
    return images;
  } finally {
    clearTimeout(timer);
  }
}

export async function getBaseGameCatalog() {
  if (cachedCatalog && Date.now() - cachedAt < CACHE_MS) return cachedCatalog;
  const [pals, items, weaponPage, armorPage] = await Promise.all([
    fetchJson(PALS_SOURCE),
    fetchJson(ITEMS_SOURCE),
    fetchPageImageMap('weapons').catch(() => new Map()),
    fetchPageImageMap('armor').catch(() => new Map())
  ]);
  cachedCatalog = [...normalizePals(pals), ...normalizeItems(items, { weapons: weaponPage, armor: armorPage })].sort((a, b) => {
    const categoryOrder = { pals: 0, weapons: 1, armor: 2, resources: 3 };
    return (categoryOrder[a.category] - categoryOrder[b.category]) || a.name.localeCompare(b.name, 'pt-BR');
  });
  cachedAt = Date.now();
  return cachedCatalog;
}

export function applyCatalogOverrides(catalog, overrides = [], { includeInactive = false } = {}) {
  const map = new Map((overrides || []).map(row => [row.catalog_key, row]));
  return catalog.filter(item => includeInactive || map.get(item.key)?.active !== false).map(item => {
    const override = map.get(item.key);
    const active = override?.active !== false;
    // Armas e armaduras seguem a tabela única da comunidade. Assim, um
    // preço antigo salvo no painel não consegue sobrescrever a regra atual.
    const fixedEquipmentPrice = ['weapons', 'armor'].includes(item.category);
    return override && !fixedEquipmentPrice && Number.isFinite(Number(override.victory_coins_price))
      ? { ...item, active, victoryCoins: Math.max(1, Math.round(Number(override.victory_coins_price))) }
      : { ...item, active };
  });
}

export function catalogSummary(catalog) {
  return catalog.reduce((summary, item) => {
    summary[item.category] = (summary[item.category] || 0) + 1;
    return summary;
  }, { pals: 0, weapons: 0, armor: 0, resources: 0 });
}
