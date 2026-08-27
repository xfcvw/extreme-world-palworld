import { SITE_ORIGIN, getSharedSession, supabase } from '/assets/auth.js';
const root=document.querySelector('#admin-root');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusLabel=s=>({pending_payment:'Aguardando pagamento',paid:'Pago',awaiting_delivery:'Aguardando entrega',in_delivery:'Em entrega',delivered:'Entregue',cancelled:'Cancelado',refunded:'Reembolsado'}[s]||s);
const toast=t=>{let el=document.querySelector('#admin-toast');if(!el){el=document.createElement('div');el.id='admin-toast';el.className='toast';document.body.appendChild(el)}el.textContent=t;el.hidden=false;setTimeout(()=>el.hidden=true,2600)};
const storeCategory=p=>String(p?.category||p?.metadata?.store_category||'').toLowerCase();
const palRequestSummary=order=>{const prefs=order?.order_items?.[0]?.metadata?.pal_preferences;if(!prefs)return '';const gender={female:'Fêmea',male:'Macho',any:'Sem preferência'}[prefs.desired_gender]||'Sem preferência';const parts=[`Sexo: ${gender}`];if(prefs.desired_passives)parts.push(`Passivas: ${prefs.desired_passives}`);if(prefs.delivery_notes)parts.push(`Obs.: ${prefs.delivery_notes}`);return parts.join(' · ')};
async function setDelivery(id,status){
  const {error}=await supabase.rpc('staff_set_order_delivery_status',{p_order_id:id,p_status:status});
  if(error)return toast(error.message);
  toast(status==='delivered'?'Pedido marcado como entregue.':'Pedido movido para entrega.');
  await render();
}
async function updateStoreProduct(key,form){
  const price=Math.round(Number(form.querySelector('[name="price"]').value.replace(',','.')));
  if(!Number.isInteger(price)||price<1)return toast('Informe um preço válido em Moedas da Vitória.');
  const {error}=await supabase.from('catalog_price_overrides').upsert({catalog_key:key,victory_coins_price:price,active:form.querySelector('[name="active"]').checked},{onConflict:'catalog_key'});
  if(error)return toast(error.message);
  toast('Item da loja atualizado.');
  await render();
}
async function adjustWallet(userId,form){
  const amount=Math.round(Number(form.querySelector('[name="amount"]').value));
  const direction=form.querySelector('[name="direction"]').value;
  const reason=String(form.querySelector('[name="reason"]').value||'').trim();
  if(!Number.isInteger(amount)||amount<1)return toast('Informe uma quantidade válida de MV.');
  if(!reason)return toast('Informe o motivo do ajuste.');
  const session=await getSharedSession();if(!session)return toast('Sua sessão expirou.');
  const button=form.querySelector('button');button.disabled=true;button.textContent='Salvando...';
  try{
    const response=await fetch('/api/admin-wallet-adjustment',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({targetUserId:userId,delta:direction==='credit'?amount:-amount,reason})});
    const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Não foi possível ajustar a carteira.');
    toast(`Carteira atualizada: ${coins(data.balance)} MV.`);await render();
  }catch(error){toast(error.message);button.disabled=false;button.textContent='Aplicar ajuste';}
}
async function render(){
  const session=await getSharedSession();
  if(!session){root.innerHTML='<div class="admin-panel"><h3>Acesso restrito</h3><p>Entre pelo portal usando Discord antes de abrir o painel administrativo.</p><button id="admin-login" class="primary-btn">Entrar com Discord</button></div>';document.querySelector('#admin-login').onclick=signIn;return}
  const {data:profile}=await supabase.from('profiles').select('*').eq('user_id',session.user.id).maybeSingle();
  if(!['owner','admin','support'].includes(profile?.role)){root.innerHTML='<div class="admin-panel"><h3>Sem permissão</h3><p>Sua conta não possui um cargo administrativo.</p></div>';return}
  const [{data:orders},{data:profiles},{data:products},{data:wallets},catalogResponse]=await Promise.all([
    supabase.from('orders').select('*,order_items(name_snapshot,metadata)').order('created_at',{ascending:false}).limit(500),
    supabase.from('profiles').select('user_id,display_name,discord_username,palworld_nickname,role').limit(500),
    supabase.from('products').select('*').order('product_type'),
    supabase.from('wallets').select('*').limit(500),
    fetch('/api/game-catalog?includeInactive=1',{cache:'no-store'}).then(async response=>response.ok?response.json():Promise.reject(new Error('catalog unavailable'))).catch(()=>null)
  ]);
  const pending=(orders||[]).filter(o=>['awaiting_delivery','in_delivery','paid'].includes(o.status));
  const paid=(orders||[]).filter(o=>['paid','awaiting_delivery','in_delivery','delivered'].includes(o.status));
  const storeProducts=catalogResponse?.items||[];
  const canManage=['owner','admin'].includes(profile.role);
  const walletByUser=new Map((wallets||[]).map(wallet=>[wallet.user_id,wallet]));
  const ordersByUser=new Map();(orders||[]).forEach(order=>ordersByUser.set(order.user_id,[...(ordersByUser.get(order.user_id)||[]),order]));
  root.innerHTML=`
    <article class="admin-stat-card"><span>PEDIDOS REGISTRADOS</span><b>${orders?.length||0}</b><small>Últimos 60 pedidos</small></article>
    <article class="admin-stat-card"><span>PLAYERS</span><b>${profiles?.length||0}</b><small>Contas no portal</small></article>
    <article class="admin-stat-card"><span>CATÁLOGO</span><b>${storeProducts.length||0}</b><small>Itens disponíveis na loja</small></article>
    <article class="admin-stat-card"><span>ENTREGAS PENDENTES</span><b>${pending.length}</b><small>Exigem ação da equipe</small></article>
    <section id="buyers" class="admin-panel"><div class="profile-section-title"><div><span class="eyebrow cyan">CLIENTES E CARTEIRAS</span><h3>Compradores e Moedas da Vitória</h3><p class="admin-panel-note">Cada ajuste é registrado com o responsável, valor e motivo. Owner e Admin podem creditar ou retirar MV.</p></div><span class="admin-status">${profiles?.length||0} contas</span></div><div class="buyer-admin-grid">${(profiles||[]).map(player=>{const playerOrders=ordersByUser.get(player.user_id)||[];const wallet=walletByUser.get(player.user_id);const purchases=playerOrders.slice(0,4).flatMap(order=>(order.order_items||[]).map(item=>item.name_snapshot)).filter(Boolean);return `<article class="buyer-admin-card"><div class="buyer-admin-head"><div><b>${esc(player.display_name||player.discord_username||'Jogador')}</b><small>${esc(player.discord_username?`@${player.discord_username.replace(/^@/,'')}`:player.palworld_nickname||'Discord não informado')}</small></div><span class="admin-status">${coins(wallet?.balance||0)} MV</span></div><p><b>Compras:</b> ${purchases.length?esc(purchases.join(' · ')):'Nenhuma compra registrada'}</p><small>${playerOrders.length} pedido(s) no portal</small>${canManage&&wallet?`<form class="wallet-adjust-form" data-wallet-form="${esc(player.user_id)}"><select name="direction"><option value="credit">Adicionar MV</option><option value="debit">Retirar MV</option></select><input name="amount" inputmode="numeric" min="1" placeholder="Quantidade" required><input name="reason" maxlength="220" placeholder="Motivo do ajuste" required><button class="secondary-btn admin-action-btn">Aplicar ajuste</button></form>`:''}</article>`}).join('')||'<div class="admin-empty">Nenhum jogador cadastrado ainda.</div>'}</div></section>
    <section id="catalog" class="admin-panel"><div class="profile-section-title"><div><span class="eyebrow cyan">CATÁLOGO</span><h3>Loja por Moedas da Vitória</h3><p class="admin-panel-note">O catálogo completo vem do Palworld.gg. Edite o preço em MV ou desative temporariamente um item; a alteração passa a valer na loja.</p></div><span class="admin-status">${storeProducts.length} itens</span></div><div class="store-admin-grid">${storeProducts.map(product=>`<form class="store-admin-item" data-store-form="${esc(product.key)}"><div><span class="admin-store-kind">${esc(storeCategory(product))}</span><b>${esc(product.name)}</b><small>${esc(product.quantityLabel||product.description||'')}</small></div><label>Preço (MV)<input name="price" inputmode="numeric" value="${coins(product.victoryCoins)}" ${canManage?'':'disabled'}></label><label class="admin-active"><input name="active" type="checkbox" ${product.active?'checked':''} ${canManage?'':'disabled'}> Ativo</label>${canManage?'<button class="secondary-btn admin-action-btn">Salvar</button>':'<span class="admin-status">Somente leitura</span>'}</form>`).join('')}</div></section>
    <section id="deliveries" class="admin-panel"><div class="profile-section-title"><div><span class="eyebrow cyan">OPERAÇÃO</span><h3>Fila de entrega</h3></div></div>${pending.length?`<div class="admin-table">${pending.map(o=>`<div class="admin-order-row"><b>#EW-${o.order_number}</b><div><b>${esc((o.order_items||[])[0]?.name_snapshot||'Pedido')}</b><small>${esc(o.palworld_nickname)} · Servidor ${o.server_number||'-'}${palRequestSummary(o)?`<br>${esc(palRequestSummary(o))}`:''}</small></div><div><small>${new Date(o.created_at).toLocaleString('pt-BR')}</small></div><div class="admin-actions"><span class="admin-status">${esc(statusLabel(o.status))}</span>${o.status!=='in_delivery'?`<button class="secondary-btn admin-action-btn" data-delivery="${o.id}" data-status="in_delivery">Em entrega</button>`:''}<button class="primary-btn admin-action-btn" data-delivery="${o.id}" data-status="delivered">Marcar entregue</button></div></div>`).join('')}</div>`:'<div class="admin-empty">Nenhum pedido aguardando entrega.</div>'}</section>
    <section class="admin-panel"><div class="profile-section-title"><div><span class="eyebrow blue">HISTÓRICO</span><h3>Atividade recente</h3></div></div>${paid.length?`<div class="admin-table">${paid.slice(0,10).map(o=>`<div class="admin-order-row"><b>#EW-${o.order_number}</b><div><b>${esc((o.order_items||[])[0]?.name_snapshot||'Pedido')}</b><small>${esc(o.palworld_nickname)}</small></div><div><small>${new Date(o.created_at).toLocaleString('pt-BR')}</small></div><span class="admin-status">${esc(statusLabel(o.status))}</span></div>`).join('')}</div>`:'<div class="admin-empty">Sem atividade recente.</div>'}</section>`;
  document.querySelectorAll('[data-delivery]').forEach(btn=>btn.onclick=()=>setDelivery(btn.dataset.delivery,btn.dataset.status));
  document.querySelectorAll('[data-store-form]').forEach(form=>form.onsubmit=event=>{event.preventDefault();updateStoreProduct(form.dataset.storeForm,form)});
  document.querySelectorAll('[data-wallet-form]').forEach(form=>form.onsubmit=event=>{event.preventDefault();adjustWallet(form.dataset.walletForm,form)});
}
async function signIn(){const {error}=await supabase.auth.signInWithOAuth({provider:'discord',options:{redirectTo:`${SITE_ORIGIN}/admin.html`}});if(error)toast(error.message)}
render();
