const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY=process.env.SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SERVICE_ROLE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const DISCORD_BOT_TOKEN=process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID=process.env.DISCORD_GUILD_ID;

const roleMap=[
  {environment:'DISCORD_ROLE_OWNER_ID',portalRole:'owner'},
  {environment:'DISCORD_ROLE_ADMIN_ID',portalRole:'admin'},
  {environment:'DISCORD_ROLE_SUPPORT_ID',portalRole:'support'}
];

function reply(res,status,body){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.statusCode=status;
  return res.end(JSON.stringify(body));
}

function configuredRoles(){
  return roleMap
    .map(item=>({...item,discordRoleId:String(process.env[item.environment]||'').trim()}))
    .filter(item=>item.discordRoleId);
}

function getDiscordUserId(user){
  const discordIdentity=(user.identities||[]).find(identity=>identity.provider==='discord');
  const data=discordIdentity?.identity_data||{};
  return String(data.sub||data.provider_id||user.user_metadata?.provider_id||'').trim();
}

async function getAuthenticatedUser(accessToken){
  const result=await fetch(`${SUPABASE_URL}/auth/v1/user`,{
    headers:{apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${accessToken}`}
  });
  const user=await result.json().catch(()=>null);
  return result.ok&&user?.id?user:null;
}

async function updatePortalRole(userId,role){
  const result=await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}`,{
    method:'PATCH',
    headers:{
      apikey:SUPABASE_SERVICE_ROLE_KEY,
      Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type':'application/json',
      Prefer:'return=representation'
    },
    body:JSON.stringify({role})
  });
  if(!result.ok)throw new Error('Não foi possível atualizar o cargo no portal.');
}

export default async function handler(req,res){
  if(req.method!=='POST')return reply(res,405,{error:'Method not allowed'});
  if(!SUPABASE_URL||!SUPABASE_PUBLISHABLE_KEY||!SUPABASE_SERVICE_ROLE_KEY||!DISCORD_BOT_TOKEN||!DISCORD_GUILD_ID){
    return reply(res,503,{error:'A sincronização de cargos ainda não foi configurada.'});
  }

  const accessToken=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
  if(!accessToken)return reply(res,401,{error:'Faça login com Discord.'});

  try{
    const user=await getAuthenticatedUser(accessToken);
    if(!user)return reply(res,401,{error:'Sessão inválida.'});

    const discordUserId=getDiscordUserId(user);
    if(!discordUserId)return reply(res,422,{error:'Não foi possível identificar a conta Discord desta sessão.'});

    const memberResponse=await fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(DISCORD_GUILD_ID)}/members/${encodeURIComponent(discordUserId)}`,{
      headers:{Authorization:`Bot ${DISCORD_BOT_TOKEN}`}
    });
    if(memberResponse.status===404)return reply(res,403,{error:'Entre no servidor Extreme World do Discord para sincronizar seus cargos.'});
    if(memberResponse.status===401||memberResponse.status===403)return reply(res,503,{error:'O bot Discord não tem permissão para consultar os membros.'});
    if(!memberResponse.ok)return reply(res,502,{error:'O Discord não respondeu à consulta de cargos agora.'});

    const member=await memberResponse.json();
    const roleIds=new Set(Array.isArray(member.roles)?member.roles.map(String):[]);
    const matchedRole=configuredRoles().find(item=>roleIds.has(item.discordRoleId));
    const portalRole=matchedRole?.portalRole||'player';

    await updatePortalRole(user.id,portalRole);
    return reply(res,200,{role:portalRole,syncedAt:new Date().toISOString()});
  }catch(error){
    console.error('[discord-sync] failed',error);
    return reply(res,500,{error:'Não foi possível sincronizar os cargos agora.'});
  }
}
