const servers={
  1:{url:process.env.PALWORLD_SERVER_1_API_URL,username:process.env.PALWORLD_SERVER_1_API_USERNAME,password:process.env.PALWORLD_SERVER_1_ADMIN_PASSWORD},
  2:{url:process.env.PALWORLD_SERVER_2_API_URL,username:process.env.PALWORLD_SERVER_2_API_USERNAME,password:process.env.PALWORLD_SERVER_2_ADMIN_PASSWORD}
};
const SUPABASE_URL=process.env.SUPABASE_URL;
const PUBLISHABLE=process.env.SUPABASE_PUBLISHABLE_KEY;
const SERVICE_ROLE=process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res,status,body,{privateResponse=false}={}){res.setHeader('Cache-Control',privateResponse?'private, no-store':'s-maxage=15, stale-while-revalidate=30');return res.status(status).json(body)}
function asNumber(value){const parsed=Number(value);return Number.isFinite(parsed)?parsed:null}
function firstNumber(source,keys){for(const key of keys){const value=asNumber(source?.[key]);if(value!==null)return value}return null}
function firstText(source,keys){for(const key of keys){const value=source?.[key];if(value!==undefined&&value!==null&&String(value).trim())return String(value).trim()}return ''}
function makeBaseUrl(value){try{const url=new URL(String(value||''));return ['http:','https:'].includes(url.protocol)?url.href.replace(/\/+$/,''):null}catch{return null}}
function normalized(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()}

async function readApi(baseUrl,credentials,path){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),7000),started=Date.now();
  try{
    const response=await fetch(`${baseUrl}/v1/api/${path}`,{headers:{Accept:'application/json',Authorization:`Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`},signal:controller.signal});
    return {ok:response.ok,status:response.status,data:await response.json().catch(()=>null),latencyMs:Date.now()-started};
  }finally{clearTimeout(timeout)}
}

async function fetchServer(number,{withPlayers=false}={}){
  const server=servers[number],baseUrl=makeBaseUrl(server?.url);
  if(!server||!baseUrl||!server.username||!server.password)return {server:number,configured:false,online:false,status:'not_configured',updatedAt:new Date().toISOString()};
  try{
    const requests=[readApi(baseUrl,server,'info'),readApi(baseUrl,server,'metrics')];
    if(withPlayers)requests.push(readApi(baseUrl,server,'players'));
    const [infoResult,metricsResult,playersResult]=await Promise.all(requests);
    if(!infoResult.ok)return {server:number,configured:true,online:false,status:infoResult.status===401?'authorization_failed':'unreachable',updatedAt:new Date().toISOString()};
    const info=infoResult.data||{},metrics=metricsResult.ok?metricsResult.data:{};
    return {server:number,configured:true,online:true,status:'online',name:String(info.servername||info.serverName||`Servidor ${number}`),description:String(info.description||''),version:String(info.version||''),playersOnline:firstNumber(metrics,['currentplayernum','currentPlayerNum','playernum','playerNum']),playersMax:firstNumber(metrics,['maxplayernum','maxPlayerNum','maxplayers','maxPlayers']),serverFps:firstNumber(metrics,['serverfps','serverFps','fps']),apiLatencyMs:infoResult.latencyMs,updatedAt:new Date().toISOString(),playersResult:withPlayers?playersResult:null};
  }catch(error){console.error('[palworld-status] failed',{server:number,message:error?.message});return {server:number,configured:true,online:false,status:'unreachable',updatedAt:new Date().toISOString()}}
}

function playerRows(data){
  if(Array.isArray(data))return data;
  for(const key of ['players','playerlist','playerList','data'])if(Array.isArray(data?.[key]))return data[key];
  return [];
}
function safeCharacter(row,server){
  if(!row)return null;
  return {server,characterName:firstText(row,['name','playerName','nickname','nickName']),level:firstNumber(row,['level','playerLevel']),guild:firstText(row,['guildName','guild','guild_name']),lastConnection:firstText(row,['lastOnline','last_online','lastLogin','last_login']),playerId:firstText(row,['playerId','player_id','uid']),ping:firstNumber(row,['ping','latency'])};
}

async function authenticatedProfile(req){
  const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!token||!SUPABASE_URL||!PUBLISHABLE||!SERVICE_ROLE)return null;
  const userResponse=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:PUBLISHABLE,Authorization:`Bearer ${token}`}});
  const user=await userResponse.json().catch(()=>null);
  if(!userResponse.ok||!user?.id)return null;
  const profileResponse=await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(user.id)}&select=palworld_nickname,default_server`,{headers:{apikey:SERVICE_ROLE,Authorization:`Bearer ${SERVICE_ROLE}`}});
  const profiles=await profileResponse.json().catch(()=>[]);
  return profiles?.[0]||null;
}

async function currentPlayer(req,res){
  const profile=await authenticatedProfile(req);
  if(!profile)return json(res,401,{error:'Sua sessão expirou. Entre novamente.'},{privateResponse:true});
  const nickname=String(profile.palworld_nickname||'').trim();
  if(!nickname)return json(res,200,{found:false,reason:'nickname_required',message:'Cadastre seu NickName do Palworld para sincronizar seu personagem.'},{privateResponse:true});
  const preferred=Number(profile.default_server)===2?2:1;
  const numbers=[preferred,preferred===1?2:1];
  const results=await Promise.all(numbers.map(number=>fetchServer(number,{withPlayers:true})));
  const characters=[];
  for(const result of results){
    if(!result.online)continue;
    const row=playerRows(result.playersResult?.data).find(player=>normalized(firstText(player,['name','playerName','nickname','nickName']))===normalized(nickname));
    const character=safeCharacter(row,result.server);if(character)characters.push(character);
  }
  const unavailable=results.every(result=>!result.online);
  return json(res,200,{found:characters.length>0,unavailable,nickname,characters,servers:results.map(({playersResult,...server})=>server),updatedAt:new Date().toISOString(),message:unavailable?'Não foi possível sincronizar seus dados no momento. Tente novamente em instantes.':characters.length?'':'Seu personagem ainda não foi localizado entre os jogadores consultados. Confira se o NickName salvo no portal é igual ao do jogo.'},{privateResponse:true});
}

export default async function handler(req,res){
  if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
  if(String(req.query?.mode||'')==='me'){
    try{return await currentPlayer(req,res)}catch(error){console.error('[palworld-player] failed',{message:error?.message});return json(res,200,{found:false,unavailable:true,message:'Não foi possível sincronizar seus dados no momento. Tente novamente em instantes.'},{privateResponse:true})}
  }
  const number=Number(req.query?.server||1);
  if(!servers[number])return json(res,400,{error:'Servidor inválido'});
  const result=await fetchServer(number);
  return json(res,result.online?200:result.status==='authorization_failed'?503:502,result);
}
