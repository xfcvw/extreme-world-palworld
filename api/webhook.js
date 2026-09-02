import crypto from 'node:crypto';
const SUPABASE_URL=process.env.SUPABASE_URL;
const SERVICE_ROLE=process.env.SUPABASE_SERVICE_ROLE_KEY;
const MP_TOKEN=process.env.MERCADO_PAGO_ACCESS_TOKEN;
const MP_SECRET=process.env.MERCADO_PAGO_WEBHOOK_SECRET;

function valid(req,dataId){
  if(!MP_SECRET) return false;
  const xs=req.headers['x-signature']||'';
  const xr=req.headers['x-request-id']||'';
  const parts=Object.fromEntries(xs.split(',').map(x=>x.trim().split('=')));
  if(!parts.ts||!parts.v1) return false;
  const id=String(dataId||'').toLowerCase();
  const manifest=`id:${id};request-id:${xr};ts:${parts.ts};`;
  const expected=crypto.createHmac('sha256',MP_SECRET).update(manifest).digest('hex');
  try{return crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(parts.v1))}catch{return false}
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

function normalize(order){
  const payment=order?.transactions?.payments?.[0]||{};
  const status=String(payment.status||order?.status||'').toLowerCase();
  const detail=String(payment.status_detail||order?.status_detail||'').toLowerCase();
  if(status==='processed'||detail==='accredited') return 'approved';
  if(['failed','rejected'].includes(status)) return 'rejected';
  if(status==='cancelled') return 'cancelled';
  if(status==='refunded') return 'refunded';
  if(['processing','in_process'].includes(status)) return 'in_process';
  return 'pending';
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).end();
  if(!SUPABASE_URL||!SERVICE_ROLE||!MP_TOKEN||!MP_SECRET){
    console.error('[mercado-pago-webhook] configuração ausente', {
      supabase: Boolean(SUPABASE_URL && SERVICE_ROLE),
      token: Boolean(MP_TOKEN),
      secret: Boolean(MP_SECRET)
    });
    return res.status(503).end();
  }

  const dataId=req.query?.['data.id']||req.body?.data?.id;
  const type=String(req.query?.type||req.body?.type||'').toLowerCase();
  if(!dataId){
    console.warn('[mercado-pago-webhook] notificação sem data.id', { type });
    return res.status(400).end();
  }
  if(!valid(req,dataId)){
    console.warn('[mercado-pago-webhook] assinatura inválida', {
      type,
      dataId: String(dataId).slice(0, 80),
      hasSignature: Boolean(req.headers['x-signature']),
      hasRequestId: Boolean(req.headers['x-request-id'])
    });
    return res.status(401).end();
  }

  try{
    console.info('[mercado-pago-webhook] notificação recebida', { type, dataId: String(dataId).slice(0, 80) });
    if(type && type!=='order') return res.status(200).end();

    const r=await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(dataId)}`,{headers:{Authorization:`Bearer ${MP_TOKEN}`}});
    const order=await r.json();
    if(!r.ok) throw new Error('order lookup failed');

    const internalOrderId=order.external_reference;
    if(!internalOrderId) return res.status(200).end();

    const pm=order?.transactions?.payments?.[0]?.payment_method||{};
    const method=(pm.id==='pix'||pm.type==='bank_transfer')?'pix':'card';
    const processedStatus=normalize(order);
    await rpc('process_mercado_pago_payment',{
      p_order_id:internalOrderId,
      p_provider_payment_id:String(order.id),
      p_status:processedStatus,
      p_payment_method:method,
      p_raw_status:String(order.status_detail||order.status||''),
      p_metadata:order
    });
    if(['approved','rejected','cancelled','refunded'].includes(processedStatus)){
      await rpc('finalize_coupon_redemption',{p_order_id:internalOrderId,p_approved:processedStatus==='approved'});
    }
    console.info('[mercado-pago-webhook] pedido processado', {
      orderId: internalOrderId,
      providerOrderId: String(order.id),
      status: processedStatus
    });
    return res.status(200).end();
  }catch(e){
    console.error('[mercado-pago-webhook] falha ao processar', { message: String(e?.message||e) });
    return res.status(500).end();
  }
}
