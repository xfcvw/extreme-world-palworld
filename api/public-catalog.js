const SUPABASE_URL=process.env.SUPABASE_URL;
const SERVICE_ROLE=process.env.SUPABASE_SERVICE_ROLE_KEY;
const json=(res,status,data)=>res.status(status).json(data);

async function fetchRows(path){
  const response=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{
    headers:{apikey:SERVICE_ROLE,Authorization:`Bearer ${SERVICE_ROLE}`}
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(data?.message||data?.hint||'Catálogo indisponível.');
  return data||[];
}

export default async function handler(req,res){
  if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
  if(!SUPABASE_URL||!SERVICE_ROLE)return json(res,503,{error:'Catálogo ainda não foi configurado.'});
  try{
    const [vips,benefits,products]=await Promise.all([
      fetchRows('vip_plans?active=eq.true&select=id,name,slug,description,price_cents,featured,sort_order&order=sort_order.asc'),
      fetchRows('vip_benefits?select=vip_plan_id,benefit,sort_order&order=sort_order.asc'),
      fetchRows('products?active=eq.true&select=id,name,slug,description,product_type,price_cents,image_url,featured,metadata,vip_plan_id,currency_amount&order=price_cents.asc')
    ]);
    res.setHeader('Cache-Control','no-store, max-age=0');
    return json(res,200,{vips,benefits,products});
  }catch(error){
    console.error('public catalog error',error);
    return json(res,503,{error:'O catálogo está sendo atualizado. Tente novamente em instantes.'});
  }
}
