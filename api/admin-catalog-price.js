const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const reply = (res, status, body) => res.status(status).json(body);

async function serviceFetch(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(data?.message || data?.hint || "Não foi possível atualizar o item.");
  return data;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 100000
    ? number
    : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return reply(res, 405, { error: "Method not allowed" });
  if (!SUPABASE_URL || !PUBLISHABLE || !SERVICE_ROLE)
    return reply(res, 503, { error: "A administração ainda não foi configurada." });

  const token = String(req.headers.authorization || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) return reply(res, 401, { error: "Entre com Discord para continuar." });

  try {
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${token}` },
    });
    const user = await userResponse.json().catch(() => null);
    if (!userResponse.ok || !user?.id)
      return reply(res, 401, { error: "Sua sessão expirou. Entre novamente." });

    const [profile] = await serviceFetch(
      `profiles?select=role&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,
    );
    if (!["owner", "admin"].includes(profile?.role))
      return reply(res, 403, { error: "Somente Owner ou Admin pode alterar preços." });

    const catalogKey = String(req.body?.catalog_key || "").trim();
    const victoryCoins = positiveInteger(req.body?.victory_coins_price);
    if (!/^(pal|weapon|armor|resource):[a-z0-9:_-]{1,170}$/i.test(catalogKey))
      return reply(res, 400, { error: "Item do catálogo inválido." });
    if (!victoryCoins)
      return reply(res, 400, { error: "Informe um preço válido em Moedas da Vitória." });

    const payload = {
      catalog_key: catalogKey,
      victory_coins_price: victoryCoins,
      active: Boolean(req.body?.active),
    };
    const optionalPrices = [
      "equipment_normal_price",
      "equipment_legendary_price",
      "pal_level_80_price",
      "pal_level_255_price",
    ];
    for (const field of optionalPrices) {
      if (req.body?.[field] === undefined) continue;
      const value = positiveInteger(req.body[field]);
      if (!value) return reply(res, 400, { error: "Um dos preços informados é inválido." });
      payload[field] = value;
    }
    for (const field of ["pal_level_80_active", "pal_level_255_active"]) {
      if (req.body?.[field] !== undefined) payload[field] = Boolean(req.body[field]);
    }

    const [item] = await serviceFetch("catalog_price_overrides?on_conflict=catalog_key", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify([payload]),
    });
    return reply(res, 200, { item });
  } catch (error) {
    console.error("admin catalog price error", error);
    return reply(res, 500, { error: "Não foi possível atualizar o item agora." });
  }
}
