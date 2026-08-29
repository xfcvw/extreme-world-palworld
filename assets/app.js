import { SITE_ORIGIN, getSharedSession, supabase, syncDiscordRole } from '/assets/auth.js';

let session = null, profile = null, wallet = null, orders = [], pals = [], products = [], shopProducts = [], selectedClass = 'ALL', selectedShopCategory = 'all', shopQuery = '', shopPage = 1, palPage = 1, coinQuantity = 10;
let mpConfig = null, mp = null, cardFormInstance = null;
const $ = (s) => document.querySelector(s); const $$ = (s) => [...document.querySelectorAll(s)];
const brl = (c) => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((c||0)/100);
const coins = (n) => new Intl.NumberFormat('pt-BR').format(Number(n||0));
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Fonte única do conteúdo exibido. O banco continua sendo a fonte de verdade
// para a cobrança: só liberamos o checkout quando o produto cadastrado tiver o
// mesmo valor deste catálogo.
const VIP_CATALOG = [
  {slug:'vip-inicial', tier:'INICIAL', name:'VIP Inicial', priceCents:1500, accent:'#52d66f', icon:'🟢', items:['Escolha de 1 Pal da categoria D até C','10 Moedas da Vitória','20.000 de Ouro','5.000 Moedas de Cachorro']},
  {slug:'vip-avancado', tier:'AVANÇADO', name:'VIP Avançado', priceCents:3500, accent:'#50a9ff', icon:'🔵', items:['Escolha de 1 Pal da categoria C até A','15 Moedas da Vitória','30.000 de Ouro','10.000 Moedas de Cachorro','Transferência de 5 packs de até 100 itens entre servidores (não válido para Pals)','5% de desconto em compras acima de R$ 30']},
  {slug:'vip-extreme', tier:'EXTREME', name:'VIP Extreme', priceCents:6500, accent:'#ff9a35', icon:'🔥👑', featured:true, items:['Escolha de 1 casal de Pals da categoria A até S','Escolha de 1 Vendedor Lendário ou Normal','20 Moedas da Vitória','40.000 de Ouro','20.000 Moedas de Cachorro','Transferência de até 10 packs de 500 itens e até 10 Pals comprados','Pals nível 255 entram como nível 80 no servidor Hard','10% de desconto acima de R$ 50 e 1 cupom exclusivo de 50%','Passe livre em eventos com Bilhete de Batalha','Loot da Torre Mortal Kombat pode ir para o servidor Hard','Pal prêmio do Boss Global pode ir para o servidor Hard no nível 80']}
];

function toast(message){const el=$('#toast');el.textContent=message;el.hidden=false;clearTimeout(window.__toast);window.__toast=setTimeout(()=>el.hidden=true,3500)}
function modal(html){$('#modal-body').innerHTML=html;$('#modal').hidden=false}
function closeModal(){cardFormInstance=null;$('#modal').hidden=true}
$('#modal-close').onclick=closeModal;$('#modal').onclick=e=>{if(e.target.id==='modal')closeModal()};

async function signIn(){
  const redirectTo = SITE_ORIGIN;
  const { error } = await supabase.auth.signInWithOAuth({provider:'discord',options:{redirectTo}});
  if(error) toast(error.message);
}
$$('.direct-login').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();signIn()}));


async function loadCatalog(){
  const [{data:vips},{data:benefits},{data:productRows},gameCatalog] = await Promise.all([
    supabase.from('vip_plans').select('*').eq('active',true).order('sort_order'),
    supabase.from('vip_benefits').select('*').order('sort_order'),
    supabase.from('products').select('*').eq('active',true).order('price_cents'),
    fetch('/api/game-catalog',{cache:'no-store'}).then(async response=>response.ok?response.json():Promise.reject(new Error('catalog unavailable'))).catch(()=>null)
  ]);
  products=productRows||[];
  shopProducts=gameCatalog?.items||[];
  renderVips(vips||[],benefits||[],products);
  renderPackages(products.filter(product=>product.product_type==='package'&&product.metadata?.package_bundle===true));
  renderCoins(products.filter(p=>p.product_type==='currency'));
  renderShop();
  pals=shopProducts.filter(item=>shopCategory(item)==='pals').map(item=>({
    id:item.key,name:item.name,class:item.metadata?.pal_class||'D',image_url:item.imageUrl,catalogItem:item,
    prices:Object.entries(item.metadata?.price_by_level||{}).map(([level,victory_coins])=>({level:Number(level),victory_coins:Number(victory_coins)}))
  }));
  renderPals();
}
function renderPackages(rows){
  const target=$('#packages-grid');if(!target)return;
  const order=value=>Number(value.metadata?.display_order||999);
  target.innerHTML=rows.length?rows.sort((a,b)=>order(a)-order(b)).map(product=>`<article class="vip-card ${product.featured?'featured':''}"><span class="vip-tier">PACOTE CLÁSSICO</span><h3>${esc(product.name)}</h3><div class="price"><b>${brl(product.price_cents)}</b></div><ul class="benefits vip-item-list">${(Array.isArray(product.metadata?.benefits)?product.metadata.benefits:[]).map(benefit=>`<li>${esc(benefit)}</li>`).join('')}</ul><button class="card-cta" data-package-buy="${product.id}">Comprar pacote</button></article>`).join(''):'<div class="empty-state"><b>Nenhum pacote ativo</b><p>Os pacotes estarão disponíveis aqui quando forem ativados pela equipe.</p></div>';
  $$('[data-package-buy]').forEach(button=>button.onclick=()=>{const product=products.find(row=>row.id===button.dataset.packageBuy);checkout(product?.id,product?.name)});
}

function renderGameServerStatus(server,data){
  const card=$(`[data-game-server="${server}"]`);if(!card)return;
  const status=card.querySelector('[data-server-status]'),players=card.querySelector('[data-server-players]'),serverStatus=card.querySelector('[data-server-state]'),version=card.querySelector('[data-server-version]'),latency=card.querySelector('[data-server-latency]'),updated=card.querySelector('[data-server-updated]'),title=card.querySelector('[data-server-title]');
  if(data?.online){
    if(title)title.textContent=server===1?'Extreme World sem Wipe':'Extreme World com Wipe';
    status.textContent='Online';status.className='status-badge online';
    players.textContent=data.playersOnline===null?'Online':`${data.playersOnline}${data.playersMax!==null?`/${data.playersMax}`:''}`;
    serverStatus.textContent='Online';version.textContent=data.version||'Conectado';if(latency)latency.textContent=data.apiLatencyMs===null?'—':`${data.apiLatencyMs} ms`;if(updated)updated.textContent=`Atualizado: ${new Date(data.updatedAt).toLocaleTimeString('pt-BR')}`;return;
  }
  status.className='status-badge pending';
  status.textContent='Indisponível';serverStatus.textContent='Sem resposta';
  players.textContent='—';version.textContent='—';if(latency)latency.textContent='—';if(updated)updated.textContent='Status indisponível no momento';
}
async function loadGameServerStatus(){
  const results=await Promise.all([1,2].map(async server=>{try{const response=await fetch(`/api/palworld?server=${server}`,{cache:'no-store'});return [server,await response.json()]}catch{return [server,null]}}));
  results.forEach(([server,data])=>renderGameServerStatus(server,data));
}
function renderVips(vips, benefits, productRows){
  const normalise = value => String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  $('#vip-grid').innerHTML=VIP_CATALOG.map(plan=>{
    const dbPlan=vips.find(v=>normalise(v.slug)===plan.slug||normalise(v.name)===normalise(plan.name));
    const product=dbPlan&&productRows.find(p=>p.product_type==='vip'&&p.vip_plan_id===dbPlan.id);
    const checkoutReady=product&&Number(product.price_cents)===plan.priceCents;
    return `<article class="vip-card vip-official ${plan.featured?'featured':''}" style="--accent:${plan.accent}"><div class="vip-card-top"><span class="vip-tier">${plan.icon} VIP ${plan.tier}</span>${plan.featured?'<span class="vip-popular">MAIS COMPLETO</span>':''}</div><h3>${esc(plan.name)}</h3><div class="price"><b>${brl(plan.priceCents)}</b> <span>/ mês</span></div><ul class="benefits vip-item-list">${plan.items.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>${checkoutReady?`<button class="card-cta" data-buy="${product.id}" data-name="${esc(plan.name)}">Assinar VIP</button>`:'<button class="card-cta card-cta-muted" data-vip-unavailable="${esc(plan.name)}">Em configuração</button>'}</article>`;
  }).join('');
  $('#vip-extra').innerHTML=`<div class="vip-benefit-panel vip-renewal"><div><span class="eyebrow blue">BENEFÍCIO DE RENOVAÇÃO</span><h3>Avançado e Extreme renovam suas escolhas.</h3><p>A cada renovação, o membro pode escolher novamente os Pals e itens de transferência, sempre respeitando os limites do plano.</p></div><div class="vip-rule-note"><b>Regras oficiais</b><p>Todos os benefícios, transferências, descontos e recompensas estão sujeitos às regras oficiais do servidor.</p></div></div><div class="vip-price-summary"><span>VIP Inicial <b>R$ 15</b></span><span>VIP Avançado <b>R$ 35</b></span><span>VIP Extreme <b>R$ 65</b></span></div>`;
  $$('[data-buy]').forEach(b=>b.onclick=()=>checkout(b.dataset.buy,b.dataset.name));
  $$('[data-vip-unavailable]').forEach(b=>b.onclick=()=>toast(`${b.dataset.vipUnavailable} está sendo sincronizado com o checkout seguro.`));
}
const MV_UNIT_PRICE_CENTS=50;
function mvPrice(quantity){return Math.max(1,Number(quantity)||1)*MV_UNIT_PRICE_CENTS}
function renderCoins(items){
  const product=items.find(item=>item.product_type==='currency');
  if(!product){$('#coins-grid').innerHTML='<div class="loading-card dark">A compra de Moedas da Vitória está sendo configurada.</div>';return}
  coinQuantity=Math.max(1,Math.min(10000,Math.floor(Number(coinQuantity)||1)));
  const total=mvPrice(coinQuantity);
  $('#coins-grid').innerHTML=`<article class="coin-card unit-coin-card"><div class="coin-icon">🪙</div><span class="eyebrow cyan">COMPRE A QUANTIDADE QUE QUISER</span><h3>${coins(coinQuantity)} Moedas da Vitória</h3><p>R$ 0,50 por moeda. O total é calculado antes do pagamento e as moedas entram na carteira após a aprovação.</p><div class="coin-stepper" aria-label="Quantidade de Moedas da Vitória"><button type="button" data-coin-change="-1" aria-label="Diminuir quantidade">−</button><output>${coins(coinQuantity)} MV</output><button type="button" data-coin-change="1" aria-label="Aumentar quantidade">+</button></div><footer><div><small>Valor total</small><strong>${brl(total)}</strong></div><button class="buy-btn" data-coin="${product.id}">Pix / Cartão</button></footer></article>`;
  $$('[data-coin-change]').forEach(button=>button.onclick=()=>{coinQuantity=Math.max(1,Math.min(10000,coinQuantity+Number(button.dataset.coinChange)));renderCoins(items)});
  $$('[data-coin]').forEach(button=>button.onclick=()=>checkout(button.dataset.coin,`${coins(coinQuantity)} Moedas da Vitória`,coinQuantity));
}
const STORE_CATEGORY_LABELS={pals:'Pal',weapons:'Arma',armor:'Armadura',resources:'Recurso'};
const STORE_CATEGORY_EMOJIS={pals:'🐾',weapons:'⚔',armor:'🛡',resources:'⛏'};
function shopCategory(product){return String(product?.category||product?.metadata?.store_category||'').toLowerCase()}
function renderShop(){
  const target=$('#shop-grid'); if(!target)return;
  const normalizedQuery=shopQuery.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const rows=shopProducts.filter(product=>{
    const category=shopCategory(product);
    const searchable=`${product.name||''} ${product.description||''} ${category}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    return category && (selectedShopCategory==='all'||category===selectedShopCategory) && (!normalizedQuery||searchable.includes(normalizedQuery));
  });
  const perPage=selectedShopCategory==='pals'?20:32, totalPages=Math.max(1,Math.ceil(rows.length/perPage));
  shopPage=Math.min(shopPage,totalPages);
  const visible=rows.slice((shopPage-1)*perPage,shopPage*perPage);
  const count=$('#shop-count');if(count)count.textContent=rows.length?`${coins(rows.length)} itens disponíveis`:'Nenhum item encontrado';
  target.innerHTML=visible.length?visible.map(product=>{
    const category=shopCategory(product), label=STORE_CATEGORY_LABELS[category]||'Item', emoji=STORE_CATEGORY_EMOJIS[category]||'✦';
    const quantity=product.quantityLabel?`<span class="shop-quantity">${esc(product.quantityLabel)}</span>`:'';
    const source=product.sourceUrl?`<a class="shop-source" href="${esc(product.sourceUrl)}" target="_blank" rel="noopener">Referência Palworld.gg ↗</a>`:'';
    const fallbacks=(Array.isArray(product.imageFallbackUrls)?product.imageFallbackUrls:[]).filter(Boolean).join('|');
    const image=product.imageUrl?`<img src="${esc(product.imageUrl)}" data-fallbacks="${esc(fallbacks)}" alt="${esc(product.name)}" loading="lazy" onerror="const next=(this.dataset.fallbacks||'').split('|').filter(Boolean);if(next.length){this.src=next.shift();this.dataset.fallbacks=next.join('|')}else{this.hidden=true;this.nextElementSibling.hidden=false}"><span class="shop-fallback-icon" hidden>${emoji}</span>`:`<span class="shop-fallback-icon">${emoji}</span>`;
    const equipmentPrices=product.metadata?.equipment_prices||{};
    const normalEquipmentPrice=Number(equipmentPrices.normal||(category==='weapons'?2:3));
    const legendaryEquipmentPrice=Number(equipmentPrices.legendary||(category==='weapons'?6:5));
    const equipmentPrice=category==='weapons'||category==='armor'?`${coins(normalEquipmentPrice)}–${coins(legendaryEquipmentPrice)} MV`: `${coins(product.victoryCoins)} MV`;
    return `<article class="shop-card shop-${esc(category)}"><div class="shop-card-top"><span class="shop-category">${emoji} ${label}</span>${quantity}</div><div class="shop-image">${image}</div><h3>${esc(product.name)}</h3><p>${esc(product.description||'Item para entrega no servidor.')}</p><footer><div><small>Entrega no jogo</small><strong>${equipmentPrice}</strong></div><button class="buy-btn" data-shop-buy="${esc(product.key)}">Comprar</button></footer>${source}</article>`;
  }).join(''):`<div class="empty-state"><b>Nenhum item nesta categoria</b><p>Tente outro termo ou escolha uma categoria diferente.</p></div>`;
  const pagination=$('#shop-pagination');
  if(pagination)pagination.innerHTML=rows.length>perPage?`<button data-page="${shopPage-1}" ${shopPage===1?'disabled':''}>← Anterior</button><span>Página ${shopPage} de ${totalPages}</span><button data-page="${shopPage+1}" ${shopPage===totalPages?'disabled':''}>Próxima →</button>`:'';
  $$('[data-shop-buy]').forEach(button=>button.onclick=()=>openShopPurchase(shopProducts.find(item=>item.key===button.dataset.shopBuy)));
  $$('[data-page]').forEach(button=>button.onclick=()=>{shopPage=Number(button.dataset.page);renderShop()});
}
$$('#shop-filters button').forEach(button=>button.onclick=()=>{selectedShopCategory=button.dataset.shopCategory;shopPage=1;$$('#shop-filters button').forEach(item=>item.classList.toggle('active',item===button));renderShop()});
$('#shop-search').oninput=event=>{shopQuery=event.target.value||'';shopPage=1;renderShop()};

function openShopPurchase(item){
  if(!item)return toast('Item indisponível.');
  if(!session){toast('Entre com Discord para comprar com Moedas da Vitória.');signIn();return}
  if(!profile?.palworld_nickname)return openOnboarding();
  if(shopCategory(item)==='pals')return openCatalogPalPurchase(item);
  const isEquipment=['weapons','armor'].includes(shopCategory(item));
  const equipmentPrices=item.metadata?.equipment_prices||{};
  const normalPrice=Number(equipmentPrices.normal||(shopCategory(item)==='weapons'?2:3));
  const legendaryPrice=Number(equipmentPrices.legendary||(shopCategory(item)==='weapons'?6:5));
  const tierControl=isEquipment?`<label>Qualidade<select name="equipmentTier"><option value="normal">Normal — ${normalPrice} MV</option><option value="legendary">Lendária — ${legendaryPrice} MV</option></select></label>`:'';
  modal(`<span class="eyebrow blue">MOEDAS DA VITÓRIA</span><h2>${esc(item.name)}</h2><p>${isEquipment?'Escolha a qualidade.':'Serão descontadas '+`<b>${coins(item.victoryCoins)} Moedas da Vitória</b>.`} O pedido entra na fila para entrega manual de um ADM.</p><form id="shop-buy" class="form"><label>Servidor<select name="server"><option value="1" ${profile.default_server===1?'selected':''}>Extreme World sem Wipe</option><option value="2" ${profile.default_server===2?'selected':''}>Extreme World com Wipe</option></select></label>${tierControl}<button class="full-btn"></button></form>`);
  const form=$('#shop-buy'),button=form.querySelector('button'),tierSelect=form.querySelector('[name="equipmentTier"]');
  const syncEquipmentPrice=()=>{const price=tierSelect?.value==='legendary'?legendaryPrice:(isEquipment?normalPrice:item.victoryCoins);button.textContent=`Comprar por ${coins(price)} MV`};
  if(tierSelect)tierSelect.onchange=syncEquipmentPrice;syncEquipmentPrice();
  form.onsubmit=async event=>{
    event.preventDefault();button.disabled=true;button.textContent='Criando pedido...';
    try{
      const serverNumber=Number(new FormData(event.target).get('server'));
      const equipmentTier=tierSelect?.value;
      const response=await fetch('/api/catalog-purchase',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({catalogKey:item.key,serverNumber,equipmentTier})});
      const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Não foi possível criar o pedido.');
      closeModal();toast('Pedido criado! Aguarde a entrega do ADM.');await loadAccount();
    }catch(error){toast(error.message);button.disabled=false;syncEquipmentPrice()}
  };
}
function openCatalogPalPurchase(item){
  const prices=item.metadata?.price_by_level||{};
  const levelsActive=item.metadata?.pal_levels_active||{};
  const priceFor=level=>Number(prices[level]||0);
  const defaultServer=profile?.default_server===2?2:1;
  modal(`<span class="eyebrow blue">COMPRAR PAL</span><h2>${esc(item.name)}</h2><p>Classe <b>${esc(item.metadata?.pal_class||'D')}</b>. Confira o nível e o valor antes de confirmar: a entrega é manual por um ADM após o desconto da carteira.</p><form id="catalog-pal-buy" class="form"><label>Servidor<select name="server"><option value="1" ${defaultServer===1?'selected':''}>Extreme World sem Wipe</option><option value="2" ${defaultServer===2?'selected':''}>Extreme World com Wipe</option></select></label><label>Nível<select name="level"><option value="80" data-level-active="${levelsActive[80]!==false}">Nível 80 — ${coins(priceFor(80))} MV</option><option value="255" data-level-active="${levelsActive[255]!==false}">Nível 255 — ${coins(priceFor(255))} MV</option></select><small id="pal-level-note"></small></label><fieldset class="pal-request-fields"><legend>Preferências para entrega</legend><label>Sexo desejado<select name="desiredGender"><option value="any">Sem preferência</option><option value="female">Fêmea</option><option value="male">Macho</option></select></label><label>Passivas desejadas<textarea name="desiredPassives" maxlength="400" placeholder="Ex.: Corredor, Lenda, Ferocidade..."></textarea></label><label>Outras observações<textarea name="deliveryNotes" maxlength="500" placeholder="Descreva aqui qualquer outro detalhe importante para a entrega."></textarea></label><small>Os pedidos dependem da disponibilidade e serão analisados pela equipe.</small></fieldset><button class="full-btn" type="submit"></button></form>`);
  const form=$('#catalog-pal-buy'), serverSelect=form.querySelector('[name="server"]'), levelSelect=form.querySelector('[name="level"]'), note=$('#pal-level-note'), button=form.querySelector('button');
  const syncLevel=()=>{
    const isWipe=Number(serverSelect.value)===2;
    const level80=levelSelect.querySelector('option[value="80"]');
    const level255=levelSelect.querySelector('option[value="255"]');
    level80.disabled=level80.dataset.levelActive!=='true';
    level255.disabled=isWipe||level255.dataset.levelActive!=='true';
    if(levelSelect.selectedOptions[0]?.disabled){const available=[...levelSelect.options].find(option=>!option.disabled);if(available)levelSelect.value=available.value;}
    const noneAvailable=[...levelSelect.options].every(option=>option.disabled);
    note.textContent=noneAvailable?'Nenhum nível deste Pal está disponível no momento.':isWipe?'No servidor com Wipe, Pals são entregues somente no nível 80.':'';
    button.disabled=noneAvailable;
    button.textContent=`Comprar por ${coins(priceFor(Number(levelSelect.value)))} MV`;
  };
  serverSelect.onchange=syncLevel;levelSelect.onchange=syncLevel;syncLevel();
  form.onsubmit=async event=>{
    event.preventDefault();button.disabled=true;button.textContent='Criando pedido...';
    try{
      const values=new FormData(form),serverNumber=Number(values.get('server')),palLevel=Number(values.get('level'));
      const palPreferences={desiredGender:values.get('desiredGender'),desiredPassives:values.get('desiredPassives'),deliveryNotes:values.get('deliveryNotes')};
      const response=await fetch('/api/catalog-purchase',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({catalogKey:item.key,serverNumber,palLevel,palPreferences})});
      const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Não foi possível criar o pedido.');
      closeModal();toast('Pedido criado! Aguarde a entrega do ADM.');await loadAccount();
    }catch(error){toast(error.message);button.disabled=false;syncLevel()}
  };
}
function renderPals(){
  const q=($('#pal-search').value||'').toLowerCase(); const rows=pals.filter(p=>(selectedClass==='ALL'||p.class===selectedClass)&&p.name.toLowerCase().includes(q));
  const perPage=15,totalPages=Math.max(1,Math.ceil(rows.length/perPage));palPage=Math.min(palPage,totalPages);const visible=rows.slice((palPage-1)*perPage,palPage*perPage);
  $('#pal-grid').innerHTML=visible.length?visible.map(p=>`<article class="pal-card"><span class="pal-class">${esc(p.class)}</span>${p.image_url?`<img src="${esc(p.image_url)}" alt="${esc(p.name)}">`:'<div style="width:62px;height:62px;border-radius:12px;background:#f3f7fd;display:grid;place-items:center">🐲</div>'}<h3>${esc(p.name)}</h3><p>${p.prices.map(x=>`Nv. ${x.level}: ${coins(x.victory_coins)} MV`).join(' · ')}</p><button class="buy-btn" style="margin-top:14px" data-pal="${p.id}">Escolher</button></article>`).join(''):`<div class="empty-state"><b>Catálogo de Pals em preparação</b><p>${pals.length?'Nenhum Pal encontrado nesse filtro.':'A estrutura já está pronta. Os Pals serão cadastrados pelo painel administrativo.'}</p></div>`;
  const pagination=$('#pal-pagination');if(pagination)pagination.innerHTML=rows.length>perPage?`<button data-pal-page="${palPage-1}" ${palPage===1?'disabled':''}>← Anterior</button><span>Página ${palPage} de ${totalPages}</span><button data-pal-page="${palPage+1}" ${palPage===totalPages?'disabled':''}>Próxima →</button>`:'';
  $$('[data-pal]').forEach(b=>b.onclick=()=>openPal(pals.find(p=>p.id===b.dataset.pal)));
  $$('[data-pal-page]').forEach(button=>button.onclick=()=>{palPage=Number(button.dataset.palPage);renderPals();$('#pals').scrollIntoView({behavior:'smooth'})});
}
$('#pal-search').oninput=()=>{palPage=1;renderPals()};$$('#class-filters button').forEach(b=>b.onclick=()=>{$$('#class-filters button').forEach(x=>x.classList.remove('active'));b.classList.add('active');selectedClass=b.dataset.class;palPage=1;renderPals()});

async function getMpConfig(){
  if(mpConfig)return mpConfig;
  const r=await fetch('/api/config',{cache:'no-store'});mpConfig=await r.json();return mpConfig;
}
async function loadMpSdk(){
  if(window.MercadoPago)return;
  await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://sdk.mercadopago.com/js/v2';s.onload=resolve;s.onerror=()=>reject(new Error('Falha ao carregar Mercado Pago.js'));document.head.appendChild(s)});
}
function paymentResultHtml(d){
  const label=d.status==='approved'?'Pagamento aprovado':d.status==='rejected'?'Pagamento recusado':'Pagamento em processamento';
  return `<span class="eyebrow blue">PEDIDO #EW-${esc(d.orderNumber)}</span><h2>${label}</h2><p>${d.status==='approved'?'A confirmação foi registrada.':d.status==='rejected'?'Confira os dados e tente novamente.':'Acompanhe o status pelo seu perfil.'}</p><a class="full-btn payment-link" href="/perfil.html">Ver meus pedidos</a>`;
}
async function callCheckout(payload){
  const r=await fetch('/api/checkout',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify(payload)});
  const d=await r.json();if(!r.ok)throw new Error(d.error||'Não foi possível processar o pagamento.');return d;
}
function showPixResult(d){
  const pix=d.pix||{};
  if(!pix.qrCode&&!pix.qrCodeBase64&&!pix.ticketUrl){modal(paymentResultHtml(d));return}
  modal(`<span class="eyebrow blue">PIX • PEDIDO #EW-${esc(d.orderNumber)}</span><h2>Escaneie o QR Code</h2><p>Depois do pagamento, o Mercado Pago avisará a Extreme World automaticamente.</p><div class="pix-box">${pix.qrCodeBase64?`<img class="pix-qr" src="data:image/png;base64,${pix.qrCodeBase64}" alt="QR Code Pix">`:''}${pix.qrCode?`<label>Pix Copia e Cola<textarea id="pix-code" readonly>${esc(pix.qrCode)}</textarea></label><button id="copy-pix" class="full-btn">Copiar código Pix</button>`:''}${pix.ticketUrl?`<a class="payment-link" target="_blank" rel="noopener" href="${esc(pix.ticketUrl)}">Abrir instruções do Pix ↗</a>`:''}</div><a class="ghost-payment-link" href="/perfil.html">Acompanhar pedido</a>`);
  if($('#copy-pix'))$('#copy-pix').onclick=async()=>{await navigator.clipboard.writeText($('#pix-code').value);toast('Código Pix copiado.')};
}
async function initCardForm(product,currencyQuantity=0){
  const cfg=await getMpConfig();
  if(!cfg.cardEnabled||!cfg.mercadoPagoPublicKey){
    $('#card-area').innerHTML='<div class="payment-warning">Cartão ainda não está ativo. Adicione <b>MERCADO_PAGO_PUBLIC_KEY</b> nas variáveis da Vercel e faça um redeploy.</div>';
    return;
  }
  await loadMpSdk();
  mp=mp||new window.MercadoPago(cfg.mercadoPagoPublicKey);
  const defaultEmail=session?.user?.email||'';
  const totalCents=currencyQuantity?mvPrice(currencyQuantity):product.price_cents;
  $('#card-area').innerHTML=`<form id="form-checkout" class="payment-form"><label>Número do cartão<div id="form-checkout__cardNumber" class="mp-field"></div></label><div class="payment-columns"><label>Validade<div id="form-checkout__expirationDate" class="mp-field"></div></label><label>CVV<div id="form-checkout__securityCode" class="mp-field"></div></label></div><label>Nome do titular<input id="form-checkout__cardholderName" type="text" autocomplete="cc-name"></label><div class="payment-columns"><label>Emissor<select id="form-checkout__issuer"></select></label><label>Parcelas<select id="form-checkout__installments"></select></label></div><div class="payment-columns"><label>Documento<select id="form-checkout__identificationType"></select></label><label>Número<input id="form-checkout__identificationNumber" inputmode="numeric"></label></div><label>E-mail<input id="form-checkout__cardholderEmail" type="email" value="${esc(defaultEmail)}" required></label><button id="form-checkout__submit" class="full-btn" type="submit">Pagar ${brl(totalCents)}</button><progress id="mp-progress" value="0" class="payment-progress">Carregando...</progress></form>`;
  cardFormInstance=mp.cardForm({
    amount:(totalCents/100).toFixed(2),iframe:true,
    form:{
      id:'form-checkout',
      cardNumber:{id:'form-checkout__cardNumber',placeholder:'Número do cartão'},
      expirationDate:{id:'form-checkout__expirationDate',placeholder:'MM/AA'},
      securityCode:{id:'form-checkout__securityCode',placeholder:'CVV'},
      cardholderName:{id:'form-checkout__cardholderName',placeholder:'Nome como no cartão'},
      issuer:{id:'form-checkout__issuer',placeholder:'Banco emissor'},
      installments:{id:'form-checkout__installments',placeholder:'Parcelas'},
      identificationType:{id:'form-checkout__identificationType',placeholder:'Tipo'},
      identificationNumber:{id:'form-checkout__identificationNumber',placeholder:'Documento'},
      cardholderEmail:{id:'form-checkout__cardholderEmail',placeholder:'E-mail'}
    },
    callbacks:{
      onFormMounted:error=>{if(error)toast('Não foi possível carregar o formulário de cartão.')},
      onSubmit:async event=>{
        event.preventDefault();
        const btn=$('#form-checkout__submit');btn.disabled=true;btn.textContent='Processando...';
        try{
          const d=cardFormInstance.getCardFormData();
          const result=await callCheckout({productId:product.id,currencyQuantity,serverNumber:profile.default_server||1,paymentMethod:'card',cardToken:d.token,paymentMethodId:d.paymentMethodId,installments:Number(d.installments)||1,payerEmail:d.cardholderEmail,identificationType:d.identificationType,identificationNumber:d.identificationNumber});
          modal(paymentResultHtml(result));
        }catch(e){toast(e.message);btn.disabled=false;btn.textContent=`Pagar ${brl(totalCents)}`}
      },
      onFetching:()=>{const p=$('#mp-progress');if(p)p.removeAttribute('value');return()=>{if(p)p.setAttribute('value','0')}}
    }
  });
}
async function checkout(productId,name,currencyQuantity=0){
  if(!session){toast('Entre com Discord para comprar.');signIn();return}
  if(!profile?.palworld_nickname){return openOnboarding()}
  const product=products.find(p=>p.id===productId);
  if(!product)return toast('Produto indisponível.');
  const email=session.user.email||'';
  const totalCents=currencyQuantity?mvPrice(currencyQuantity):product.price_cents;
  modal(`<span class="eyebrow blue">CHECKOUT TRANSPARENTE</span><h2>${esc(name||product.name)}</h2><p>Total: <b>${brl(totalCents)}</b>. Escolha como deseja pagar sem sair da Extreme World.</p><div class="payment-tabs"><button id="pay-pix" class="payment-tab active">PIX</button><button id="pay-card" class="payment-tab">Cartão</button></div><div id="payment-area"><form id="pix-form" class="payment-form"><label>E-mail para o pagamento<input name="email" type="email" value="${esc(email)}" required></label><button class="full-btn">Gerar Pix de ${brl(totalCents)}</button></form></div>`);
  const activate=(kind)=>{$$('.payment-tab').forEach(x=>x.classList.toggle('active',x.id===`pay-${kind}`));};
  $('#pay-pix').onclick=()=>{activate('pix');$('#payment-area').innerHTML=`<form id="pix-form" class="payment-form"><label>E-mail para o pagamento<input name="email" type="email" value="${esc(email)}" required></label><button class="full-btn">Gerar Pix de ${brl(totalCents)}</button></form>`;bindPix(product,currencyQuantity)};
  $('#pay-card').onclick=()=>{activate('card');$('#payment-area').innerHTML='<div id="card-area" class="payment-loading">Carregando formulário seguro...</div>';initCardForm(product,currencyQuantity).catch(e=>{$('#card-area').innerHTML=`<div class="payment-warning">${esc(e.message)}</div>`})};
  bindPix(product,currencyQuantity);
}
function bindPix(product,currencyQuantity=0){
  const form=$('#pix-form');if(!form)return;
  const totalCents=currencyQuantity?mvPrice(currencyQuantity):product.price_cents;
  form.onsubmit=async e=>{e.preventDefault();const btn=form.querySelector('button');btn.disabled=true;btn.textContent='Gerando Pix...';try{const f=new FormData(form);const result=await callCheckout({productId:product.id,currencyQuantity,serverNumber:profile.default_server||1,paymentMethod:'pix',payerEmail:String(f.get('email')||'')});showPixResult(result)}catch(err){toast(err.message);btn.disabled=false;btn.textContent=`Gerar Pix de ${brl(totalCents)}`}}
}

function openPal(p){openShopPurchase(p?.catalogItem)}

async function loadAccount(){
  if(!session)return;
  const uid=session.user.id;
  const [{data:p},{data:w},{data:o}] = await Promise.all([
    supabase.from('profiles').select('*').eq('user_id',uid).maybeSingle(),
    supabase.from('wallets').select('*').eq('user_id',uid).maybeSingle(),
    supabase.from('orders').select('id,order_number,status,payment_method,total_cents,victory_coins_total,created_at').eq('user_id',uid).order('created_at',{ascending:false}).limit(10)
  ]);
  profile=p;wallet=w;orders=o||[];renderAuth();if(profile&&!profile.palworld_nickname)openOnboarding();
  syncDiscordRole(session).then(result=>{
    if(profile&&result?.role&&profile.role!==result.role){profile.role=result.role;renderAuth();}
  }).catch(error=>console.info('Sincronização de cargos pendente:',error.message));
}
function renderAuth(){
  const logged=!!session;$('#login-btn').hidden=logged;$('#account-btn').hidden=!logged;$('#wallet-pill').hidden=!logged;const adminLink=$('#admin-nav-link');if(adminLink)adminLink.hidden=!['owner','admin'].includes(profile?.role);if(logged){$('#wallet-balance').textContent=coins(wallet?.balance||0);const show=$('#wallet-showcase-value');if(show)show.textContent=`${coins(wallet?.balance||0)} Moedas da Vitória`;}else{const show=$('#wallet-showcase-value');if(show)show.textContent='Entre com Discord para consultar seu saldo';}
}
function openOnboarding(){
  modal(`<span class="eyebrow blue">PRIMEIRO ACESSO</span><h2>Vincule seu player</h2><p>Seu Discord já está conectado. Falta só o NickName usado dentro do Palworld.</p><form id="onboarding" class="form"><label>NickName no Palworld<input name="nick" required maxlength="80" value="${esc(profile?.palworld_nickname||'')}" placeholder="Ex.: ExtremePlayer"></label><label>Servidor principal<select name="server"><option value="1">Extreme World sem Wipe</option><option value="2" ${profile?.default_server===2?'selected':''}>Extreme World com Wipe</option></select></label><button class="full-btn">Salvar perfil</button></form>`);
  $('#onboarding').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const {error}=await supabase.from('profiles').update({palworld_nickname:String(f.get('nick')).trim(),default_server:Number(f.get('server'))}).eq('user_id',session.user.id);if(error)return toast(error.message);closeModal();toast('Perfil vinculado com sucesso.');await loadAccount()};
}
$('#account-btn').onclick=()=>location.href='/perfil.html';$('#wallet-pill').onclick=()=>location.href='/perfil.html';

// Não aguardamos consultas ao Supabase dentro deste callback: ele roda no
// bloqueio da própria autenticação e isso pode travar a restauração da sessão.
function applyAuthState(nextSession){
  session=nextSession;
  if(session)loadAccount().catch(error=>console.error('Falha ao carregar conta:',error));
  else{profile=wallet=null;orders=[];renderAuth()}
}
supabase.auth.onAuthStateChange((_event,nextSession)=>setTimeout(()=>applyAuthState(nextSession),0));
(async()=>{session=await getSharedSession();await Promise.all([loadCatalog(),loadGameServerStatus()]);if(session)await loadAccount();else renderAuth();setInterval(loadGameServerStatus,45000);})();
