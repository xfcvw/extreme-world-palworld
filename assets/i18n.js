const STORAGE_KEY = 'extreme-world-locale';
const CACHE_KEY = 'extreme-world-display-rates-v1';
const CACHE_MS = 6 * 60 * 60 * 1000;

const locales = {
  'pt-BR': { label: '🇧🇷 PT-BR · R$', locale: 'pt-BR', currency: 'BRL' },
  'en-US': { label: '🇺🇸 English · US$', locale: 'en-US', currency: 'USD' },
  'es-ES': { label: '🇪🇸 Español · €', locale: 'es-ES', currency: 'EUR' },
  'es-AR': { label: '🇦🇷 Español · AR$', locale: 'es-AR', currency: 'ARS' },
};

const words = {
  'pt-BR': {
    home: 'Home', marketplace: 'MarketPlace', servers: 'Servidores', packages: 'Pacotes', shop: 'Loja', map: 'Mapa', player: 'Jogador', login: 'Entrar com Discord', account: 'Minha conta',
    heroTag: 'SERVIDORES, LOJA E COMUNIDADE', heroText: 'Seu ponto central para assinar VIPs, gerenciar Moedas da Vitória, acompanhar pedidos e acessar sua conta do servidor.', heroShop: 'Abrir MarketPlace', heroDiscord: 'Conectar Discord',
    currencyLabel: 'Idioma e moeda de exibição', currencyNotice: 'Os preços são apenas uma conversão estimada. O pagamento final é sempre em R$ (BRL).', rateStatus: 'Cotação atualizada automaticamente.',
    marketTag: 'MARKETPLACE EXTREME WORLD', marketTitle: 'Escolha como evoluir', marketText: 'Planos VIP, banco de moedas e catálogo de Pals em uma experiência única.',
    shopTag: 'LOJA DO SERVIDOR', shopTitle: 'Itens prontos para entrega', shopText: 'Todos os Pals, armas e armaduras, além de recursos e esferas difíceis de conseguir. As compras usam somente Moedas da Vitória e entram na fila de entrega do servidor escolhido.', shopAll: '✦ Todos', shopSearch: 'Buscar Pal, arma, armadura ou recurso...',
    checkoutNote: 'Valor exibido em conversão estimada. A cobrança do Mercado Pago será em R$ (BRL).'
  },
  'en-US': {
    home: 'Home', marketplace: 'Marketplace', servers: 'Servers', packages: 'Packages', shop: 'Shop', map: 'Map', player: 'Player', login: 'Sign in with Discord', account: 'My account',
    heroTag: 'SERVERS, SHOP AND COMMUNITY', heroText: 'Your hub to subscribe to VIPs, manage Victory Coins, track orders and access your server account.', heroShop: 'Open Marketplace', heroDiscord: 'Connect Discord',
    currencyLabel: 'Language and display currency', currencyNotice: 'Prices are estimated conversions only. Final payment is always charged in Brazilian reais (BRL).', rateStatus: 'Exchange rates update automatically.',
    marketTag: 'EXTREME WORLD MARKETPLACE', marketTitle: 'Choose how to evolve', marketText: 'VIP plans, coin wallet and Pal catalog in one experience.',
    shopTag: 'SERVER SHOP', shopTitle: 'Items ready for delivery', shopText: 'Pals, weapons, armor, resources and hard-to-get spheres. Purchases use Victory Coins and enter the chosen server delivery queue.', shopAll: '✦ All', shopSearch: 'Search Pal, weapon, armor or resource...',
    checkoutNote: 'Displayed value is an estimated conversion. Mercado Pago charges in Brazilian reais (BRL).'
  },
  'es-ES': {
    home: 'Inicio', marketplace: 'Tienda', servers: 'Servidores', packages: 'Paquetes', shop: 'Tienda', map: 'Mapa', player: 'Jugador', login: 'Entrar con Discord', account: 'Mi cuenta',
    heroTag: 'SERVIDORES, TIENDA Y COMUNIDAD', heroText: 'Tu punto central para suscribirte a VIP, administrar Monedas de la Victoria, seguir pedidos y acceder a tu cuenta.', heroShop: 'Abrir tienda', heroDiscord: 'Conectar Discord',
    currencyLabel: 'Idioma y moneda de visualización', currencyNotice: 'Los precios son conversiones estimadas. El pago final siempre se cobra en reales brasileños (BRL).', rateStatus: 'Las cotizaciones se actualizan automáticamente.',
    marketTag: 'MARKETPLACE EXTREME WORLD', marketTitle: 'Elige cómo evolucionar', marketText: 'Planes VIP, cartera de monedas y catálogo de Pals en una sola experiencia.',
    shopTag: 'TIENDA DEL SERVIDOR', shopTitle: 'Artículos listos para entregar', shopText: 'Pals, armas, armaduras, recursos y esferas difíciles de conseguir. Las compras usan Monedas de la Victoria y entran en la cola de entrega del servidor elegido.', shopAll: '✦ Todos', shopSearch: 'Buscar Pal, arma, armadura o recurso...',
    checkoutNote: 'El valor mostrado es una conversión estimada. Mercado Pago cobra en reales brasileños (BRL).'
  },
  'es-AR': {
    home: 'Inicio', marketplace: 'Tienda', servers: 'Servidores', packages: 'Paquetes', shop: 'Tienda', map: 'Mapa', player: 'Jugador', login: 'Ingresar con Discord', account: 'Mi cuenta',
    heroTag: 'SERVIDORES, TIENDA Y COMUNIDAD', heroText: 'Tu centro para suscribirte a VIP, administrar Monedas de la Victoria, seguir pedidos y acceder a tu cuenta.', heroShop: 'Abrir tienda', heroDiscord: 'Conectar Discord',
    currencyLabel: 'Idioma y moneda de visualización', currencyNotice: 'Los precios son conversiones estimadas. El pago final siempre se cobra en reales brasileños (BRL).', rateStatus: 'Las cotizaciones se actualizan automáticamente.',
    marketTag: 'MARKETPLACE EXTREME WORLD', marketTitle: 'Elegí cómo evolucionar', marketText: 'Planes VIP, billetera de monedas y catálogo de Pals en una sola experiencia.',
    shopTag: 'TIENDA DEL SERVIDOR', shopTitle: 'Artículos listos para entregar', shopText: 'Pals, armas, armaduras, recursos y esferas difíciles de conseguir. Las compras usan Monedas de la Victoria y entran en la cola de entrega del servidor elegido.', shopAll: '✦ Todos', shopSearch: 'Buscar Pal, arma, armadura o recurso...',
    checkoutNote: 'El valor mostrado es una conversión estimada. Mercado Pago cobra en reales brasileños (BRL).'
  }
};

const storageGet = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const storageSet = (key, value) => { try { localStorage.setItem(key, value); } catch { /* armazenamento opcional */ } };
const savedLocale = storageGet(STORAGE_KEY);
let active = locales[savedLocale] ? savedLocale : 'pt-BR';
let rates = { BRL: 1 };
export const t = (key) => words[active]?.[key] || words['pt-BR'][key] || key;
export const displayPrice = (cents) => {
  const config = locales[active];
  const original = Number(cents || 0) / 100;
  // Until a cached or live rate is available, keep the known BRL amount instead
  // of briefly showing an inaccurate foreign-currency value at a 1:1 rate.
  if (active !== 'pt-BR' && !rates[config.currency]) return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(original);
  const value = original * Number(rates[config.currency] || 1);
  const result = new Intl.NumberFormat(config.locale, { style: 'currency', currency: config.currency }).format(value);
  return active === 'pt-BR' ? result : `≈ ${result}`;
};
export const isForeignLocale = () => active !== 'pt-BR';
export const paymentNoticeHtml = () => isForeignLocale() ? `<small class="currency-payment-note">${t('checkoutNote')}</small>` : '';

function translatePage() {
  document.documentElement.lang = active;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  const select = document.querySelector('#locale-selector');
  if (select) select.value = active;
}
function setupSelector() {
  const select = document.querySelector('#locale-selector');
  if (!select) return;
  select.innerHTML = Object.entries(locales).map(([code, item]) => `<option value="${code}">${item.label}</option>`).join('');
  select.onchange = () => { storageSet(STORAGE_KEY, select.value); window.location.reload(); };
}
async function loadRates() {
  if (!isForeignLocale()) return;
  try {
    const cached = JSON.parse(storageGet(CACHE_KEY) || 'null');
    if (cached?.savedAt && Date.now() - cached.savedAt < CACHE_MS) rates = cached.rates;
    const response = await fetch('https://open.er-api.com/v6/latest/BRL', { cache: 'no-store' });
    const data = await response.json();
    if (response.ok && data?.result === 'success' && data.rates?.USD && data.rates?.EUR && data.rates?.ARS) {
      rates = data.rates;
      storageSet(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), rates }));
    }
  } catch (error) { console.info('Cotação indisponível; mantendo a última conversão.', error); }
  window.dispatchEvent(new Event('ew:currency-rates-ready'));
}
setupSelector();
translatePage();
loadRates();
