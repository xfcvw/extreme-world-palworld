const ALLOWED_HOST = 'palworld.gg';
const CATEGORY_FALLBACK_IMAGES = Object.freeze({
  weapons: 'https://palworld.gg/_ipx/q_80%26s_58x58/images/items/T_itemicon_Weapon_SkyBow.png',
  armor: 'https://palworld.gg/_ipx/q_80%26s_58x58/images/items/T_itemicon_Armor_AncientArmor.png'
});

function allowedSource(url) {
  return url.protocol === 'https:' && url.hostname === ALLOWED_HOST && url.pathname.includes('/images/items/');
}

async function loadImage(url) {
  const upstream = await fetch(url.toString(), {
    headers: { Accept: 'image/avif,image/webp,image/png,image/*,*/*;q=0.8', Referer: 'https://palworld.gg/' }
  });
  const type = upstream.headers.get('content-type') || '';
  if (!upstream.ok || !type.startsWith('image/')) return null;
  return { type, data: Buffer.from(await upstream.arrayBuffer()) };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  let source;
  try {
    source = new URL(String(req.query?.src || ''));
  } catch {
    return res.status(400).json({ error: 'Imagem inválida.' });
  }

  if (!allowedSource(source)) {
    return res.status(400).json({ error: 'Origem de imagem não permitida.' });
  }

  try {
    let image = await loadImage(source);
    if (!image) {
      const fallbackUrl = CATEGORY_FALLBACK_IMAGES[String(req.query?.fallback || '')];
      if (fallbackUrl) image = await loadImage(new URL(fallbackUrl));
    }
    if (!image) return res.status(404).json({ error: 'Imagem indisponível.' });
    res.setHeader('Content-Type', image.type);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
    return res.status(200).send(image.data);
  } catch {
    return res.status(502).json({ error: 'Não foi possível carregar a imagem.' });
  }
}
