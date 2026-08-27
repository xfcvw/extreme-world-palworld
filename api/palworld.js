const servers={
  1:{url:process.env.PALWORLD_SERVER_1_API_URL,username:process.env.PALWORLD_SERVER_1_API_USERNAME,password:process.env.PALWORLD_SERVER_1_ADMIN_PASSWORD},
  2:{url:process.env.PALWORLD_SERVER_2_API_URL,username:process.env.PALWORLD_SERVER_2_API_USERNAME,password:process.env.PALWORLD_SERVER_2_ADMIN_PASSWORD}
};

function json(res,status,body){res.setHeader('Cache-Control','s-maxage=15, stale-while-revalidate=30');return res.status(status).json(body)}
function asNumber(value){const parsed=Number(value);return Number.isFinite(parsed)?parsed:null}
function firstNumber(source,keys){for(const key of keys){const value=asNumber(source?.[key]);if(value!==null)return value}return null}
function makeBaseUrl(value){try{const url=new URL(String(value||''));return ['http:','https:'].includes(url.protocol)?url.href.replace(/\/+$/,''):null}catch{return null}}

async function readApi(baseUrl,credentials,path){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),7000);
  try{
    const response=await fetch(`${baseUrl}/v1/api/${path}`,{headers:{Accept:'application/json',Authorization:`Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`},signal:controller.signal});
    return {ok:response.ok,status:response.status,data:await response.json().catch(()=>null)};
  }finally{clearTimeout(timeout)}
}

export default async function handler(req,res){
  if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
  const number=Number(req.query?.server||1),server=servers[number],baseUrl=makeBaseUrl(server?.url);
  if(!server||!baseUrl||!server.username||!server.password)return json(res,200,{server:number,configured:false,online:false,status:'not_configured'});
  try{
    const [infoResult,metricsResult]=await Promise.all([readApi(baseUrl,server,'info'),readApi(baseUrl,server,'metrics')]);
    if(!infoResult.ok)return json(res,infoResult.status===401?503:502,{server:number,configured:true,online:false,status:infoResult.status===401?'authorization_failed':'unreachable'});
    const info=infoResult.data||{},metrics=metricsResult.ok?metricsResult.data:{};
    return json(res,200,{server:number,configured:true,online:true,status:'online',name:String(info.servername||info.serverName||`Servidor ${number}`),description:String(info.description||''),version:String(info.version||''),playersOnline:firstNumber(metrics,['currentplayernum','currentPlayerNum','playernum','playerNum']),playersMax:firstNumber(metrics,['maxplayernum','maxPlayerNum','maxplayers','maxPlayers']),serverFps:firstNumber(metrics,['serverfps','serverFps','fps']),updatedAt:new Date().toISOString()});
  }catch(error){console.error('[palworld-status] failed',{server:number,message:error?.message});return json(res,502,{server:number,configured:true,online:false,status:'unreachable'})}
}
