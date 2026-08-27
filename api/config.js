const PUBLIC_KEY = process.env.MERCADO_PAGO_PUBLIC_KEY || process.env.NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY || process.env.MP_PUBLIC_KEY || '';
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';

export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  res.setHeader('Cache-Control','no-store');
  return res.status(200).json({
    mercadoPagoPublicKey: PUBLIC_KEY,
    cardEnabled: Boolean(PUBLIC_KEY),
    pixEnabled: Boolean(process.env.MERCADO_PAGO_ACCESS_TOKEN),
    paypalClientId: PAYPAL_CLIENT_ID,
    paypalEnabled: Boolean(PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET)
  });
}
