import { SITE_ORIGIN, getSharedSession, supabase, syncDiscordRole } from '/assets/auth.js';
const $=s=>document.querySelector(s);const $$=s=>[...document.querySelectorAll(s)];const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const coins=n=>new Intl.NumberFormat('pt-BR').format(Number(n||0));
function toast(message){const el=$('#toast');el.textContent=message;el.hidden=false;clearTimeout(window.__t);window.__t=setTimeout(()=>el.hidden=true,3200)}
function closePaymentModal(){$('#profile-payment-modal').hidden=true}
function showPendingPix(data){
  const pix=data?.pix||{};
  $('#profile-payment-modal-body').innerHTML=`<span class="eyebrow blue">PIX • PEDIDO #EW-${esc(data.orderNumber)}</span><h2>Finalize seu pagamento</h2><p>Use o QR Code ou copie o código Pix. Depois da aprovação, o pedido será atualizado automaticamente.</p><div class="pix-box">${pix.qrCodeBase64?`<img class="pix-qr" src="data:image/png;base64,${pix.qrCodeBase64}" alt="QR Code Pix do pedido">`:''}${pix.qrCode?`<label>Pix Copia e Cola<textarea id="profile-pix-code" readonly>${esc(pix.qrCode)}</textarea></label><button id="profile-copy-pix" class="full-btn">Copiar código Pix</button>`:''}${pix.ticketUrl?`<a class="payment-link" target="_blank" rel="noopener" href="${esc(pix.ticketUrl)}">Abrir instruções do Pix ↗</a>`:''}</div>`;
  $('#profile-payment-modal').hidden=false;
  if($('#profile-copy-pix'))$('#profile-copy-pix').onclick=async()=>{await navigator.clipboard.writeText($('#profile-pix-code').value);toast('Código Pix copiado.')};
}
async function reopenPix(orderNumber,activeSession,button){
  button.disabled=true;button.textContent='Abrindo Pix...';
  try{
    const response=await fetch(`/api/checkout?orderNumber=${encodeURIComponent(orderNumber)}`,{headers:{Authorization:`Bearer ${activeSession.access_token}`},cache:'no-store'});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'Não foi possível abrir o Pix.');
    if(!data.pix){toast(data.status==='approved'?'Este pagamento já foi aprovado.':'Este Pix não está mais pendente.');scheduleProfileLoad();return;}
    showPendingPix(data);
  }catch(error){toast(error.message)}finally{button.disabled=false;button.textContent='Pagar com Pix';}
}
const statusLabel=s=>({pending_payment:'Aguardando pagamento',paid:'Pago',awaiting_delivery:'Aguardando entrega',in_delivery:'Em entrega',delivered:'Entregue',cancelled:'Cancelado',refunded:'Reembolsado'}[s]||s);
const txLabel=t=>({purchase_credit:'Compra de moedas',purchase_debit:'Compra com moedas',admin_credit:'Crédito de ADM',admin_debit:'Débito de ADM',refund:'Reembolso',bonus:'Bônus',adjustment:'Ajuste'}[t]||t);
const serverLabel=number=>Number(number)===2?'Extreme World com Wipe':'Extreme World sem Wipe';
const dateTime=value=>value?new Date(value).toLocaleString('pt-BR'):'—';
const itemQuantity=item=>{const selected=Number(item?.metadata?.quantity),recorded=Number(item?.quantity),pack=Number(item?.metadata?.pack_size);return(Number.isInteger(selected)&&selected>0&&selected)||(Number.isInteger(recorded)&&recorded>0&&recorded)||(Number.isInteger(pack)&&pack>0&&pack)||1};
const purchaseLabel=item=>`${item?.name_snapshot||'Pedido'} × ${coins(itemQuantity(item))}`;
async function signIn(){const {error}=await supabase.auth.signInWithOAuth({provider:'discord',options:{redirectTo:`${SITE_ORIGIN}/perfil.html`}});if(error)toast(error.message)}
$('#profile-login').onclick=event=>{event.preventDefault();signIn()};
$('#profile-logout').onclick=async()=>{await supabase.auth.signOut();location.href='/'};
$('#profile-payment-close').onclick=closePaymentModal;$('#profile-payment-modal').onclick=event=>{if(event.target.id==='profile-payment-modal')closePaymentModal()};
function renderCharacterSync(data){
  const target=$('#player-sync-result'),caption=$('#player-sync-caption'),updated=$('#player-sync-updated');if(!target)return;
  updated.textContent=data?.updatedAt?`Atualizado: ${dateTime(data.updatedAt)}`:'';
  const links=Array.isArray(data?.serverLinks)?data.serverLinks:[];
  if(links.length){
    caption.textContent=data?.message||'O portal usa o ID do personagem depois do primeiro vínculo.';
    target.className='profile-world-empty profile-character-grid';
    target.innerHTML=links.map(link=>{
      const character=link.character;
      if(character)return `<article class="profile-character-card"><span class="eyebrow cyan">${esc(serverLabel(link.server))}</span><b>${esc(character.characterName||link.nickname||data.nickname)}</b><small>Nível ${character.level??'—'}${character.guild?` · Guilda: ${esc(character.guild)}`:''}</small><small class="character-state ${link.online?'online':'saved'}">${link.online?'● Conectado agora':'◌ Personagem vinculado · última leitura salva'}</small><small>${character.lastSyncedAt?`Última sincronização: ${esc(dateTime(character.lastSyncedAt))}`:character.lastConnection?`Última conexão: ${esc(character.lastConnection)}`:'Dados atualizados pela API do servidor.'}</small></article>`;
      const detail=link.serverAvailable?(link.nickname?`Entre neste servidor uma vez com o NickName “${esc(link.nickname)}”.`:'Informe o NickName deste servidor no seu perfil.'):'Servidor indisponível; tentaremos vincular quando a API voltar.';
      return `<article class="profile-character-card is-waiting"><span class="eyebrow cyan">${esc(serverLabel(link.server))}</span><b>Aguardando vínculo</b><small>${detail}</small><small>Depois de identificado, o personagem continuará visível aqui mesmo offline.</small></article>`;
    }).join('');
    return;
  }
  target.className='profile-world-empty';
  target.innerHTML=`<span>${data?.unavailable?'!':'◌'}</span><b>${data?.unavailable?'Sincronização indisponível':'Personagem não localizado agora'}</b><small>${esc(data?.message||'Não foi possível sincronizar seus dados no momento. Tente novamente em instantes.')}</small>`;
  caption.textContent=data?.unavailable?'Tentaremos novamente automaticamente.':'O vínculo usa os NickNames informados no seu perfil.';
}
function renderServerStatus(number,data){
  const card=$(`[data-profile-server="${number}"]`);if(!card)return;
  const info=card.querySelector('[data-profile-server-info]'),dot=card.querySelector('[data-profile-server-dot]');
  if(data?.online){info.textContent=`Online · ${data.playersOnline??'—'}/${data.playersMax??'—'} jogadores · API ${data.apiLatencyMs??'—'} ms`;dot.className='status-dot online-dot';return}
  info.textContent='Status indisponível no momento';dot.className='status-dot pending-dot';
}
async function syncGameData(activeSession){
  if(!activeSession)return;
  try{const response=await fetch('/api/palworld?mode=me',{headers:{Authorization:`Bearer ${activeSession.access_token}`},cache:'no-store'});const data=await response.json().catch(()=>({}));renderCharacterSync(data)}catch{renderCharacterSync({unavailable:true,message:'Não foi possível sincronizar seus dados no momento. Tente novamente em instantes.'})}
  const results=await Promise.all([1,2].map(async number=>{try{const response=await fetch(`/api/palworld?server=${number}`,{cache:'no-store'});return [number,await response.json()]}catch{return [number,null]}}));
  results.forEach(([number,data])=>renderServerStatus(number,data));const stamp=$('#profile-server-updated');if(stamp)stamp.textContent=`Última atualização: ${dateTime(new Date().toISOString())}`;
}
async function load(){try{const session=await getSharedSession();if(!session){$('#profile-loading').innerHTML='<b>Entre com Discord para acessar sua Central do Jogador.</b><br><button id="profile-retry-login" class="discord-btn" style="margin-top:18px">Entrar com Discord</button>';$('#profile-retry-login').onclick=signIn;return}
await syncDiscordRole(session).catch(error=>console.info('Sincronização de cargos pendente:',error.message));
$('#profile-login').hidden=true;$('#profile-logout').hidden=false;const uid=session.user.id;
const [{data:p,error:pe},{data:w},{data:o},{data:t}]=await Promise.all([
supabase.from('profiles').select('*').eq('user_id',uid).maybeSingle(),supabase.from('wallets').select('*').eq('user_id',uid).maybeSingle(),supabase.from('orders').select('id,order_number,status,payment_method,total_cents,victory_coins_total,created_at,order_items(name_snapshot,vip_plan_id,quantity,metadata)').eq('user_id',uid).order('created_at',{ascending:false}).limit(20),supabase.from('wallet_transactions').select('*').eq('user_id',uid).order('created_at',{ascending:false}).limit(30)]);
if(pe){$('#profile-loading').textContent=pe.message;return}
$('#profile-loading').hidden=true;$('#profile-content').hidden=false;$('#profile-wallet').hidden=false;$('#profile-wallet span').textContent=coins(w?.balance||0);$('#profile-balance').textContent=coins(w?.balance||0);$('#profile-nick').textContent=p?.palworld_nickname||'Não informado';$('#profile-server').textContent=p?.default_server?`Servidor ${p.default_server}`:'Não definido';$('#profile-name').textContent=p?.display_name||p?.discord_username||'Player';$('#profile-discord').textContent=p?.discord_username?`@${p.discord_username.replace(/^@/,'')}`:'Conta Discord vinculada';$('#role-badge').textContent=(p?.role||'player').toUpperCase();const avatar=p?.discord_avatar_url||session.user.user_metadata?.avatar_url||'';if(avatar)$('#profile-avatar').src=avatar;else $('#profile-avatar').src='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="160" height="160"%3E%3Crect width="100%25" height="100%25" rx="28" fill="%231267ff"/%3E%3Ctext x="50%25" y="58%25" text-anchor="middle" font-size="56" fill="white" font-family="Arial"%3EEW%3C/text%3E%3C/svg%3E';
syncGameData(session);
const vipOrder=(o||[]).find(x=>(x.order_items||[]).some(i=>i.vip_plan_id)&&['awaiting_delivery','in_delivery','delivered','paid'].includes(x.status));if(vipOrder){const item=(vipOrder.order_items||[]).find(i=>i.vip_plan_id);$('#vip-badge').textContent=`${item?.name_snapshot||'VIP'} · ${statusLabel(vipOrder.status)}`}
const form=$('#profile-form');form.nick.value=p?.palworld_nickname||'';form.nickServer1.value=p?.palworld_nickname_server_1||'';form.nickServer2.value=p?.palworld_nickname_server_2||'';form.server.value=String(p?.default_server||1);form.bio.value=p?.bio||'';form.onsubmit=async e=>{e.preventDefault();const f=new FormData(form);const {error}=await supabase.from('profiles').update({palworld_nickname:String(f.get('nick')).trim(),palworld_nickname_server_1:String(f.get('nickServer1')||'').trim()||null,palworld_nickname_server_2:String(f.get('nickServer2')||'').trim()||null,default_server:Number(f.get('server')),bio:String(f.get('bio')||'').trim()}).eq('user_id',uid);if(error)return toast(error.message);toast('Perfil atualizado.');setTimeout(()=>location.reload(),500)};
$('#orders-count').textContent=String((o||[]).length);$('#profile-orders').innerHTML=(o||[]).length?(o||[]).map(x=>`<div class="order-row"><span><b>#EW-${x.order_number}</b><br><small>${new Date(x.created_at).toLocaleString('pt-BR')}</small></span><span><b>${esc(purchaseLabel((x.order_items||[])[0]))}</b><br><small>${esc(statusLabel(x.status))}</small>${x.status==='pending_payment'&&x.payment_method==='pix'?`<button class="order-payment-action" data-reopen-pix="${x.order_number}">Pagar com Pix</button>`:''}</span></div>`).join(''):'<div class="empty-state"><b>Nenhum pedido ainda</b><p>Suas compras aparecerão aqui.</p></div>';
$$('[data-reopen-pix]').forEach(button=>button.onclick=()=>reopenPix(button.dataset.reopenPix,session,button));
$('#wallet-history').innerHTML=(t||[]).length?(t||[]).map(x=>`<div class="transaction-row"><div><b>${esc(txLabel(x.transaction_type))}</b><small>${new Date(x.created_at).toLocaleString('pt-BR')}</small></div><strong class="${Number(x.amount)>=0?'positive':'negative'}">${Number(x.amount)>=0?'+':''}${coins(x.amount)} MV</strong></div>`).join(''):'<div class="empty-state"><b>Sem movimentações</b><p>Compras e ajustes da carteira aparecerão aqui.</p></div>';
}catch(error){console.error('Falha ao carregar o perfil:',error);$('#profile-loading').innerHTML='<b>Não foi possível recuperar sua sessão.</b><br><button id="profile-retry-login" class="discord-btn" style="margin-top:18px">Entrar com Discord</button>';$('#profile-retry-login').onclick=signIn;}}
// O callback de autenticação é executado dentro do bloqueio interno do
// Supabase. Consultar sessão/banco diretamente nele pode deixar a tela presa
// em "Carregando". Por isso, a atualização é sempre agendada para depois.
let profileLoadScheduled=false;
function scheduleProfileLoad(){
  if(profileLoadScheduled)return;
  profileLoadScheduled=true;
  setTimeout(()=>{profileLoadScheduled=false;load()},0);
}
supabase.auth.onAuthStateChange(()=>scheduleProfileLoad());
scheduleProfileLoad();
setInterval(async()=>{const current=await getSharedSession();if(current)syncGameData(current)},45000);
