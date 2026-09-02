import { getSharedSession } from '/assets/auth.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
async function request(method,body){
  const session=await getSharedSession();
  const response=await fetch('/api/admin-role-assignment?resource=coupons',{method,headers:{Authorization:`Bearer ${session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'Não foi possível salvar o cupom.');
  return data;
}
function limitText(coupon){
  const usage=coupon.usage||{redeemed:0,reserved:0};
  return coupon.max_uses===null||coupon.max_uses===undefined?`${usage.redeemed} uso(s) confirmado(s)`:`${usage.redeemed}/${coupon.max_uses} uso(s) confirmado(s)`;
}
function couponCard(coupon){
  const usage=coupon.usage||{redeemed:0,reserved:0};
  const restriction=coupon.target_user_id?`Exclusivo para a conta ${coupon.target_user_id}`:'Disponível para todos os jogadores';
  return `<article class="coupon-card"><div class="coupon-card-head"><div><b>${esc(coupon.code)}</b><small>${limitText(coupon)}${usage.reserved?` · ${usage.reserved} em pagamento`:''}</small></div><span class="admin-status">${coupon.active?'ATIVO':'INATIVO'}</span></div><small class="coupon-restriction">${esc(restriction)} · Uso único por jogador.</small><form data-coupon-edit="${coupon.id}" class="coupon-form coupon-edit-form"><label>Desconto (%)<input name="discountPercent" type="number" min="1" max="90" value="${coupon.discount_value}" required></label><label>Limite de uso total<input name="maxUses" type="number" min="1" max="1000000" value="${coupon.max_uses??''}" placeholder="Sem limite"></label><label>Conta exclusiva (ID, opcional)<input name="targetUserId" maxlength="80" value="${coupon.target_user_id??''}" placeholder="UUID da conta"></label><button class="secondary-btn admin-action-btn">Salvar regras</button></form><button class="secondary-btn admin-action-btn" data-coupon-toggle="${coupon.id}" data-active="${coupon.active?'false':'true'}">${coupon.active?'Desativar':'Ativar'}</button></article>`;
}
async function mountCoupons(){
  const session=await getSharedSession();
  if(!session||document.querySelector('#coupons'))return;
  const buyers=document.querySelector('#buyers');if(!buyers)return;
  const section=document.createElement('section');
  section.id='coupons';section.className='admin-panel';section.innerHTML='<div class="admin-loading">Carregando cupons...</div>';buyers.before(section);
  const draw=async()=>{
    try{
      const {coupons=[]}=await request('GET'),active=coupons.filter(coupon=>coupon.active).length;
      section.innerHTML=`<div class="profile-section-title"><div><span class="eyebrow cyan">PROMOÇÕES</span><h3>Cupons de desconto</h3><p class="admin-panel-note">Configure desconto, limite de uso e a conta exclusiva. Todo cupom pode ser usado somente uma vez por jogador.</p></div><span class="admin-status">${active} ativo${active===1?'':'s'}</span></div><form data-coupon-create class="coupon-form coupon-create-form"><label>Código do cupom<input name="code" maxlength="32" placeholder="EX.: EXTREME10" required></label><label>Desconto (%)<input name="discountPercent" type="number" min="1" max="90" placeholder="10" required></label><label>Limite de uso total<input name="maxUses" type="number" min="1" max="1000000" placeholder="Sem limite"></label><label>Conta exclusiva (ID, opcional)<input name="targetUserId" maxlength="80" placeholder="UUID da conta"></label><button class="primary-btn admin-action-btn">Criar cupom</button></form><div class="coupon-list">${coupons.length?coupons.map(couponCard).join(''):'<div class="admin-empty">Nenhum cupom criado ainda.</div>'}</div>`;
      section.querySelector('[data-coupon-create]').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button'),data=new FormData(form);button.disabled=true;try{await request('POST',{code:data.get('code'),discountPercent:Number(data.get('discountPercent')),maxUses:data.get('maxUses'),targetUserId:data.get('targetUserId')});await draw()}catch(error){alert(error.message);button.disabled=false;}};
      section.querySelectorAll('[data-coupon-edit]').forEach(form=>form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button'),data=new FormData(form);button.disabled=true;try{await request('PATCH',{id:form.dataset.couponEdit,discountPercent:Number(data.get('discountPercent')),maxUses:data.get('maxUses'),targetUserId:data.get('targetUserId')});await draw()}catch(error){alert(error.message);button.disabled=false;}});
      section.querySelectorAll('[data-coupon-toggle]').forEach(button=>button.onclick=async()=>{try{await request('PATCH',{id:button.dataset.couponToggle,active:button.dataset.active==='true'});await draw()}catch(error){alert(error.message)}});
    }catch(error){section.innerHTML=`<div class="admin-empty">${esc(error.message)}</div>`;}
  };
  draw();
}
new MutationObserver(mountCoupons).observe(document.querySelector('#admin-root'),{childList:true,subtree:true});
mountCoupons();
