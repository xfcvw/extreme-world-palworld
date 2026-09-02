import crypto from 'node:crypto';

const SUPABASE_URL=process.env.SUPABASE_URL;
const PUBLISHABLE=process.env.SUPABASE_PUBLISHABLE_KEY;
const SERVICE_ROLE=process.env.SUPABASE_SERVICE_ROLE_KEY;
const MP_TOKEN=process.env.MERCADO_PAGO_ACCESS_TOKEN;
const MV_UNIT_PRICE_CENTS=50;
const json=(res,status,data)=>res.status(status).json(data);
const clientError=message=>Object.assign(new Error(message),{clientError:true});

async function sb(path,opts={}){
  const response=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{...opts,headers:{apikey:SERVICE_ROLE,Authorization:`Bearer ${SERVICE_ROLE}`,'Content-Type':'application/json',Prefer:'return=representation',...(opts.headers||{})}});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(data?.message||data?.hint||'Supabase error');
  return data;
}
async function rpc(name,body){
  const response=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:SERVICE_ROLE,Authorization:`Bearer ${SERVICE_ROLE}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(data?.message||'Supabase RPC error');
  return data;
}
function normalizeMpStatus(mp){
  const payment=mp?.transactions?.payments?.[0]||{},status=String(payment.status||mp?.status||'').toLowerCase(),detail=String(payment.status_detail||mp?.status_detail||'').toLowerCase();
  if(status==='processed'||detail==='accredited')return 'approved';
  if(['failed','rejected'].includes(status))return 'rejected';
  if(status==='cancelled')return 'cancelled';
  if(status==='refunded')return 'refunded';
  return ['processing','in_process'].includes(status)?'in_process':'pending';
}
function paymentMethodType(mp,fallback){
  const method=mp?.transactions?.payments?.[0]?.payment_method||{};
  return fallback==='pix'||method.id==='pix'||method.type==='bank_transfer'?'pix':'card';
}
async function resolveProduct(body){
  const products=await sb(`products?id=eq.${encodeURIComponent(body.productId)}&active=eq.true&select=*`);
  const product=products?.[0];
  if(!product||!product.price_cents)throw clientError('Produto indisponível.');
  if(product.metadata?.store_category)throw clientError('Itens da Loja do Servidor são adquiridos somente com Moedas da Vitória.');
  const isCurrency=product.product_type==='currency',requestedQuantity=Number(body.currencyQuantity);
  if(isCurrency&&(!Number.isInteger(requestedQuantity)||requestedQuantity<1||requestedQuantity>10000))throw clientError('Escolha entre 1 e 10.000 Moedas da Vitória.');
  const itemQuantity=isCurrency?requestedQuantity:1;
  return {product,isCurrency,itemQuantity,subtotalCents:isCurrency?itemQuantity*MV_UNIT_PRICE_CENTS:Number(product.price_cents),itemName:isCurrency?`${itemQuantity} Moedas da Vitória`:product.name};
}
async function quoteCoupon(code,userId,subtotalCents){
  const normalized=String(code||'').trim().toUpperCase();
  if(!normalized)return {coupon:null,discountCents:0,totalCents:subtotalCents};
  const value=await rpc('coupon_quote_for_user',{p_coupon_code:normalized,p_user_id:userId,p_subtotal_cents:subtotalCents});
  const discountCents=Number(value?.discount_cents||0);
  return {coupon:value?.code?{id:value.id,code:value.code,discountType:value.discount_type,discountValue:Number(value.discount_value),discountCents}:null,discountCents,totalCents:Math.max(1,subtotalCents-discountCents)};
}
const publicCouponError=message=>/cupom|pedido inválido para este cupom|valor maior/i.test(message);

async function reopenPendingPix(user, orderNumber){
  const number=Number(orderNumber);
  if(!Number.isInteger(number)||number<1)throw clientError('Pedido inválido.');
  const orders=await sb(`orders?user_id=eq.${encodeURIComponent(user.id)}&order_number=eq.${number}&select=id,order_number,status,payment_method,total_cents&limit=1`);
  const order=orders?.[0];
  if(!order)throw clientError('Pedido não encontrado.');
  if(order.status!=='pending_payment'||order.payment_method!=='pix')throw clientError('Este pedido não possui um Pix pendente para pagamento.');
  const payments=await sb(`payments?order_id=eq.${encodeURIComponent(order.id)}&provider=eq.mercado_pago&payment_method=eq.pix&provider_payment_id=not.is.null&select=id,provider_payment_id&order=created_at.desc&limit=1`);
  const payment=payments?.[0];
  if(!payment?.provider_payment_id)throw clientError('O código Pix deste pedido não está mais disponível.');
  const response=await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(payment.provider_payment_id)}`,{headers:{Authorization:`Bearer ${MP_TOKEN}`}});
  const mp=await response.json().catch(()=>({}));
  if(!response.ok)throw clientError('Não foi possível recuperar este Pix agora.');
  const normalized=normalizeMpStatus(mp);
  await rpc('process_mercado_pago_payment',{p_order_id:order.id,p_provider_payment_id:String(payment.provider_payment_id),p_status:normalized,p_payment_method:'pix',p_raw_status:String(mp.status_detail||mp.status||''),p_metadata:mp});
  if(['approved','rejected','cancelled','refunded'].includes(normalized))await rpc('finalize_coupon_redemption',{p_order_id:order.id,p_approved:normalized==='approved'}).catch(()=>{});
  const method=mp?.transactions?.payments?.[0]?.payment_method||{};
  if(!['pending','in_process'].includes(normalized))return {orderNumber:order.order_number,status:normalized};
  if(!method.ticket_url&&!method.qr_code&&!method.qr_code_base64&&!method.qr_code_based64)throw clientError('Este código Pix expirou. Faça um novo pedido para gerar outro pagamento.');
  return {orderNumber:order.order_number,status:normalized,pix:{ticketUrl:method.ticket_url||null,qrCode:method.qr_code||null,qrCodeBase64:method.qr_code_base64||method.qr_code_based64||null}};
}

export default async function handler(req,res){
  if(!['POST','GET'].includes(req.method))return json(res,405,{error:'Method not allowed'});
  if(!SUPABASE_URL||!PUBLISHABLE||!SERVICE_ROLE||!MP_TOKEN)return json(res,503,{error:'Pagamento ainda não foi configurado na Vercel.'});
  let internalOrder=null,providerCreated=false;
  try{
    const access=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    if(!access)return json(res,401,{error:'Faça login com Discord.'});
    const userResponse=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:PUBLISHABLE,Authorization:`Bearer ${access}`}});
    const user=await userResponse.json().catch(()=>null);
    if(!userResponse.ok||!user?.id)return json(res,401,{error:'Sessão inválida.'});
    if(req.method==='GET')return json(res,200,await reopenPendingPix(user,req.query?.orderNumber));
    const input=req.body||{},item=await resolveProduct(input),couponCode=String(input.couponCode||'').trim().toUpperCase();
    if(input.intent==='quote'){
      const quote=await quoteCoupon(couponCode,user.id,item.subtotalCents);
      return json(res,200,{productName:item.itemName,subtotalCents:item.subtotalCents,...quote});
    }
    const paymentMethod=input.paymentMethod||'pix';
    if(!['pix','card'].includes(paymentMethod))throw clientError('Forma de pagamento inválida.');
    const profiles=await sb(`profiles?user_id=eq.${encodeURIComponent(user.id)}&select=palworld_nickname,default_server`),profile=profiles?.[0];
    if(!profile?.palworld_nickname)throw clientError('Cadastre seu NickName antes da compra.');
    const email=String(input.payerEmail||user.email||'').trim();
    if(!email)throw clientError('Informe um e-mail válido para o pagamento.');
    if(paymentMethod==='card'&&(!input.cardToken||!input.paymentMethodId))throw clientError('Dados do cartão incompletos.');
    internalOrder=(await sb('orders',{method:'POST',body:JSON.stringify({user_id:user.id,status:'pending_payment',payment_method:paymentMethod,subtotal_cents:item.subtotalCents,discount_cents:0,total_cents:item.subtotalCents,coupon_code:null,coupon_id:null,palworld_nickname:profile.palworld_nickname,server_number:Number(input.serverNumber)||profile.default_server||1})}))?.[0];
    let quote={coupon:null,discountCents:0,totalCents:item.subtotalCents};
    if(couponCode){
      const value=await rpc('reserve_coupon_for_order',{p_coupon_code:couponCode,p_user_id:user.id,p_order_id:internalOrder.id,p_subtotal_cents:item.subtotalCents}),discountCents=Number(value?.discount_cents||0);
      quote={coupon:{id:value.id,code:value.code,discountType:value.discount_type,discountValue:Number(value.discount_value),discountCents},discountCents,totalCents:Math.max(1,item.subtotalCents-discountCents)};
      await sb(`orders?id=eq.${encodeURIComponent(internalOrder.id)}`,{method:'PATCH',body:JSON.stringify({coupon_id:quote.coupon.id,coupon_code:quote.coupon.code,discount_cents:quote.discountCents,total_cents:quote.totalCents})});
    }
    await sb('order_items',{method:'POST',body:JSON.stringify({order_id:internalOrder.id,product_id:item.product.id,vip_plan_id:item.product.vip_plan_id||null,name_snapshot:item.itemName,quantity:item.itemQuantity,unit_price_cents:item.isCurrency?MV_UNIT_PRICE_CENTS:item.product.price_cents,metadata:{...(item.isCurrency?{currency_quantity:item.itemQuantity,unit_price_cents:MV_UNIT_PRICE_CENTS}:{}),...(quote.coupon?{coupon_code:quote.coupon.code,discount_type:quote.coupon.discountType,discount_value:quote.coupon.discountValue}:{})}})});
    const paymentPayload={
      order_id:internalOrder.id,provider:'mercado_pago',provider_payment_id:null,status:'pending',payment_method:paymentMethod,amount_cents:quote.totalCents,
      metadata:{integration:'checkout_transparente_orders',subtotal_cents:item.subtotalCents,discount_cents:quote.discountCents,...(quote.coupon?{coupon_code:quote.coupon.code,discount_type:quote.coupon.discountType,discount_value:quote.coupon.discountValue}:{}),...(item.isCurrency?{currency_quantity:item.itemQuantity,unit_price_cents:MV_UNIT_PRICE_CENTS}:{})}
    };
    const paymentRows=await sb('payments',{method:'POST',body:JSON.stringify(paymentPayload)});
    const paymentRow=paymentRows?.[0];
    const payment=paymentMethod==='pix'?{amount:(quote.totalCents/100).toFixed(2),payment_method:{id:'pix',type:'bank_transfer'}}:{amount:(quote.totalCents/100).toFixed(2),payment_method:{id:String(input.paymentMethodId),type:'credit_card',token:String(input.cardToken),installments:Math.max(1,Number(input.installments)||1)}};
    const payer={email};
    if(input.identificationType&&input.identificationNumber)payer.identification={type:String(input.identificationType),number:String(input.identificationNumber).replace(/\D/g,'')};
    const mpResponse=await fetch('https://api.mercadopago.com/v1/orders',{method:'POST',headers:{Authorization:`Bearer ${MP_TOKEN}`,'Content-Type':'application/json','X-Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({type:'online',external_reference:internalOrder.id,processing_mode:'automatic',total_amount:payment.amount,payer,transactions:{payments:[payment]}})});
    const mp=await mpResponse.json().catch(()=>({}));
    if(!mpResponse.ok){
      await sb(`payments?id=eq.${paymentRow.id}`,{method:'PATCH',body:JSON.stringify({status:'rejected',raw_status:String(mp?.code||mp?.error||'request_error'),metadata:mp})}).catch(()=>{});
      await sb(`orders?id=eq.${internalOrder.id}`,{method:'PATCH',body:JSON.stringify({status:'cancelled'})}).catch(()=>{});
      await rpc('release_coupon_reservation',{p_order_id:internalOrder.id}).catch(()=>{});
      return json(res,400,{error:mp?.message||mp?.error||'O Mercado Pago recusou a criação do pagamento.'});
    }
    providerCreated=true;
    const providerId=String(mp.id||'');
    await sb(`payments?id=eq.${paymentRow.id}`,{method:'PATCH',body:JSON.stringify({provider_payment_id:providerId||null,raw_status:String(mp.status||''),metadata:mp})});
    const normalized=normalizeMpStatus(mp);
    await rpc('process_mercado_pago_payment',{p_order_id:internalOrder.id,p_provider_payment_id:providerId,p_status:normalized,p_payment_method:paymentMethodType(mp,paymentMethod),p_raw_status:String(mp.status_detail||mp.status||''),p_metadata:mp});
    if(['approved','rejected','cancelled','refunded'].includes(normalized))await rpc('finalize_coupon_redemption',{p_order_id:internalOrder.id,p_approved:normalized==='approved'});
    const mpPayment=mp?.transactions?.payments?.[0]||{},method=mpPayment.payment_method||{};
    return json(res,200,{orderNumber:internalOrder.order_number,mercadoPagoOrderId:providerId,status:normalized,rawStatus:mp.status||mpPayment.status||'',statusDetail:mp.status_detail||mpPayment.status_detail||'',paymentMethod,coupon:quote.coupon?{code:quote.coupon.code,discountType:quote.coupon.discountType,discountValue:quote.coupon.discountValue,discountCents:quote.discountCents}:null,pix:paymentMethod==='pix'?{ticketUrl:method.ticket_url||null,qrCode:method.qr_code||null,qrCodeBase64:method.qr_code_base64||method.qr_code_based64||null}:null});
  }catch(error){
    console.error(error);
    if(internalOrder&&!providerCreated){await rpc('release_coupon_reservation',{p_order_id:internalOrder.id}).catch(()=>{});await sb(`orders?id=eq.${encodeURIComponent(internalOrder.id)}`,{method:'PATCH',body:JSON.stringify({status:'cancelled'})}).catch(()=>{});}
    const message=String(error?.message||'');
    if(error?.clientError||publicCouponError(message))return json(res,400,{error:message});
    return json(res,500,{error:'Não foi possível processar o pagamento agora.'});
  }
}
