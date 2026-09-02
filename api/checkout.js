import crypto from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MP_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN;
const MV_UNIT_PRICE_CENTS = 50;

const json=(res,status,data)=>res.status(status).json(data);

async function sb(path,opts={}){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{
    ...opts,
    headers:{
      apikey:SERVICE_ROLE,
      Authorization:`Bearer ${SERVICE_ROLE}`,
      'Content-Type':'application/json',
      Prefer:'return=representation',
      ...(opts.headers||{})
    }
  });
  const d=await r.json().catch(()=>null);
  if(!r.ok) throw new Error(d?.message||d?.hint||'Supabase error');
  return d;
}

async function rpc(name,body){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{
    method:'POST',
    headers:{apikey:SERVICE_ROLE,Authorization:`Bearer ${SERVICE_ROLE}`,'Content-Type':'application/json'},
    body:JSON.stringify(body)
  });
  const d=await r.json().catch(()=>null);
  if(!r.ok) throw new Error(d?.message||'Supabase RPC error');
  return d;
}

function normalizeMpStatus(mp){
  const payment=mp?.transactions?.payments?.[0]||{};
  const status=String(payment.status||mp?.status||'').toLowerCase();
  const detail=String(payment.status_detail||mp?.status_detail||'').toLowerCase();
  if(status==='processed' || detail==='accredited') return 'approved';
  if(['failed','rejected'].includes(status)) return 'rejected';
  if(status==='cancelled') return 'cancelled';
  if(status==='refunded') return 'refunded';
  if(['processing','in_process'].includes(status)) return 'in_process';
  return 'pending';
}

function paymentMethodType(mp,fallback){
  const pm=mp?.transactions?.payments?.[0]?.payment_method||{};
  if(fallback==='pix' || pm.id==='pix' || pm.type==='bank_transfer') return 'pix';
  return 'card';
}

export default async function handler(req,res){
  if(req.method!=='POST') return json(res,405,{error:'Method not allowed'});
  if(!SUPABASE_URL||!PUBLISHABLE||!SERVICE_ROLE||!MP_TOKEN) return json(res,503,{error:'Pagamento ainda não foi configurado na Vercel.'});

  let internalOrder=null;
  try{
    const access=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    if(!access) return json(res,401,{error:'Faça login com Discord.'});

    const ur=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:PUBLISHABLE,Authorization:`Bearer ${access}`}});
    const user=await ur.json();
    if(!ur.ok||!user.id) return json(res,401,{error:'Sessão inválida.'});

    const {
      productId,
      currencyQuantity,
      serverNumber,
      paymentMethod='pix',
      payerEmail,
      cardToken,
      paymentMethodId,
      installments=1,
      identificationType,
      identificationNumber,
      couponCode
    }=req.body||{};

    if(!['pix','card'].includes(paymentMethod)) return json(res,400,{error:'Forma de pagamento inválida.'});

    const products=await sb(`products?id=eq.${encodeURIComponent(productId)}&active=eq.true&select=*`);
    const product=products?.[0];
    if(!product||!product.price_cents) return json(res,404,{error:'Produto indisponível.'});
    if(product.metadata?.store_category) return json(res,400,{error:'Itens da Loja do Servidor são adquiridos somente com Moedas da Vitória.'});
    const isCurrency=product.product_type==='currency';
    const requestedQuantity=Number(currencyQuantity);
    if(isCurrency&&(!Number.isInteger(requestedQuantity)||requestedQuantity<1||requestedQuantity>10000)){
      return json(res,400,{error:'Escolha entre 1 e 10.000 Moedas da Vitória.'});
    }
    const itemQuantity=isCurrency?requestedQuantity:1;
    const subtotalCents=isCurrency?itemQuantity*MV_UNIT_PRICE_CENTS:Number(product.price_cents);
    const normalizedCoupon=String(couponCode||'').trim().toUpperCase();
    let coupon=null;
    if(normalizedCoupon){
      const coupons=await sb(`coupons?code=eq.${encodeURIComponent(normalizedCoupon)}&active=eq.true&discount_type=eq.percentage&select=code,discount_value`);
      coupon=coupons?.[0]||null;
      if(!coupon) return json(res,400,{error:'Cupom inválido ou desativado.'});
    }
    const discountCents=coupon?Math.round(subtotalCents*Number(coupon.discount_value)/100):0;
    const totalCents=Math.max(1,subtotalCents-discountCents);
    const itemName=isCurrency?`${itemQuantity} Moedas da Vitória`:product.name;

    const profiles=await sb(`profiles?user_id=eq.${user.id}&select=palworld_nickname,default_server`);
    const nick=profiles?.[0]?.palworld_nickname;
    if(!nick) return json(res,400,{error:'Cadastre seu NickName antes da compra.'});

    const email=String(payerEmail||user.email||'').trim();
    if(!email) return json(res,400,{error:'Informe um e-mail válido para o pagamento.'});

    if(paymentMethod==='card' && (!cardToken||!paymentMethodId)){
      return json(res,400,{error:'Dados do cartão incompletos.'});
    }

    internalOrder=(await sb('orders',{method:'POST',body:JSON.stringify({
      user_id:user.id,
      status:'pending_payment',
      payment_method:paymentMethod,
      subtotal_cents:subtotalCents,
      discount_cents:discountCents,
      total_cents:totalCents,
      coupon_code:coupon?.code||null,
      palworld_nickname:nick,
      server_number:Number(serverNumber)||profiles?.[0]?.default_server||1
    })}))?.[0];

    await sb('order_items',{method:'POST',body:JSON.stringify({
      order_id:internalOrder.id,
      product_id:product.id,
      vip_plan_id:product.vip_plan_id||null,
      name_snapshot:itemName,
      quantity:itemQuantity,
      unit_price_cents:isCurrency?MV_UNIT_PRICE_CENTS:product.price_cents,
      metadata:{...(isCurrency?{currency_quantity:itemQuantity,unit_price_cents:MV_UNIT_PRICE_CENTS}:{}),...(coupon?{coupon_code:coupon.code,discount_percent:Number(coupon.discount_value)}:{})}
    })});

    const paymentRow=(await sb('payments',{method:'POST',body:JSON.stringify({
      order_id:internalOrder.id,
      provider:'mercado_pago',
      provider_payment_id:null,
      status:'pending',
      payment_method:paymentMethod,
      amount_cents:totalCents,
      metadata:{integration:'checkout_transparente_orders',subtotal_cents:subtotalCents,discount_cents:discountCents,...(coupon?{coupon_code:coupon.code,discount_percent:Number(coupon.discount_value)}:{}),...(isCurrency?{currency_quantity:itemQuantity,unit_price_cents:MV_UNIT_PRICE_CENTS}:{})}
    })}))?.[0];

    const amount=(totalCents/100).toFixed(2);
    const payment={amount,payment_method:{}};
    if(paymentMethod==='pix'){
      payment.payment_method={id:'pix',type:'bank_transfer'};
    } else {
      payment.payment_method={
        id:String(paymentMethodId),
        type:'credit_card',
        token:String(cardToken),
        installments:Math.max(1,Number(installments)||1)
      };
    }

    const payer={email};
    if(identificationType&&identificationNumber){
      payer.identification={type:String(identificationType),number:String(identificationNumber).replace(/\D/g,'')};
    }

    const body={
      type:'online',
      external_reference:internalOrder.id,
      processing_mode:'automatic',
      total_amount:amount,
      payer,
      transactions:{payments:[payment]}
    };

    const idempotency=crypto.randomUUID();
    const mpRes=await fetch('https://api.mercadopago.com/v1/orders',{
      method:'POST',
      headers:{
        Authorization:`Bearer ${MP_TOKEN}`,
        'Content-Type':'application/json',
        'X-Idempotency-Key':idempotency
      },
      body:JSON.stringify(body)
    });
    const mp=await mpRes.json().catch(()=>({}));
    if(!mpRes.ok){
      console.error('Mercado Pago order error',mp);
      await sb(`payments?id=eq.${paymentRow.id}`,{method:'PATCH',body:JSON.stringify({status:'rejected',raw_status:String(mp?.code||mp?.error||'request_error'),metadata:mp})}).catch(()=>{});
      await sb(`orders?id=eq.${internalOrder.id}`,{method:'PATCH',body:JSON.stringify({status:'cancelled'})}).catch(()=>{});
      return json(res,400,{error:mp?.message||mp?.error||'O Mercado Pago recusou a criação do pagamento.'});
    }

    const providerId=String(mp.id||'');
    await sb(`payments?id=eq.${paymentRow.id}`,{method:'PATCH',body:JSON.stringify({
      provider_payment_id:providerId||null,
      raw_status:String(mp.status||''),
      metadata:mp
    })});

    const normalized=normalizeMpStatus(mp);
    await rpc('process_mercado_pago_payment',{
      p_order_id:internalOrder.id,
      p_provider_payment_id:providerId,
      p_status:normalized,
      p_payment_method:paymentMethodType(mp,paymentMethod),
      p_raw_status:String(mp.status_detail||mp.status||''),
      p_metadata:mp
    });

    const mpPayment=mp?.transactions?.payments?.[0]||{};
    const pm=mpPayment.payment_method||{};
    return json(res,200,{
      orderNumber:internalOrder.order_number,
      mercadoPagoOrderId:providerId,
      status:normalized,
      rawStatus:mp.status||mpPayment.status||'',
      statusDetail:mp.status_detail||mpPayment.status_detail||'',
      paymentMethod,
      coupon:coupon?{code:coupon.code,discountPercent:Number(coupon.discount_value),discountCents}:null,
      pix:paymentMethod==='pix'?{
        ticketUrl:pm.ticket_url||null,
        qrCode:pm.qr_code||null,
        qrCodeBase64:pm.qr_code_base64||pm.qr_code_based64||null
      }:null
    });
  }catch(e){
    console.error(e);
    return json(res,500,{error:'Não foi possível processar o pagamento agora.'});
  }
}
