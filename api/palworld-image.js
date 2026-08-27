const ALLOWED_HOST = 'palworld.gg';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  let source;
  try {
    source = new URL(String(req.query?.src || ''));
  } catch {
    return res.status(400).json({ error: 'Imagem inválida.' });
  }

  if (source.protocol !== 'https:' || source.hostname !== ALLOWED_HOST || !source.pathname.includes('/images/items/')) {
    return res.status(400).json({ error: 'Origem de imagem não permitida.' });
  }

  try {
    const upstream = await fetch(source.toString(), {
      headers: { Accept: 'image/avif,image/webp,image/png,image/*,*/*;q=0.8', Referer: 'https://palworld.gg/' }
    });
    const type = upstream.headers.get('content-type') || '';
    if (!upstream.ok || !type.startsWith('image/')) return res.status(404).json({ error: 'Imagem indisponível.' });
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
    return res.status(200).send(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    return res.status(502).json({ error: 'Não foi possível carregar a imagem.' });
  }
}
