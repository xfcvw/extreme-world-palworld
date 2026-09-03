import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

export const SITE_ORIGIN='https://extreme-world-palworld.vercel.app';
const SUPABASE_URL='https://mujvmfkoeaklefwlwbnk.supabase.co';
const SUPABASE_KEY='sb_publishable_hA5BMTyr6ObcauRQU9O_Gg_qOsFuJGA';
const AUTH_STORAGE_KEY='extreme-world-auth';

export function useCanonicalOrigin(){
  if(location.hostname.endsWith('.vercel.app')&&location.origin!==SITE_ORIGIN){
    location.replace(`${SITE_ORIGIN}${location.pathname}${location.search}${location.hash}`);
  }
}

function readCookie(key){
  try{
    const prefix=`${encodeURIComponent(key)}=`;
    const row=document.cookie.split('; ').find(value=>value.startsWith(prefix));
    return row?decodeURIComponent(row.slice(prefix.length)):null;
  }catch{return null}
}
function writeCookie(key,value){
  document.cookie=`${encodeURIComponent(key)}=${encodeURIComponent(value)}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`;
}
function eraseCookie(key){
  document.cookie=`${encodeURIComponent(key)}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
}
function localGet(key){try{return localStorage.getItem(key)}catch{return null}}
function localSet(key,value){try{localStorage.setItem(key,value)}catch{}}
function localRemove(key){try{localStorage.removeItem(key)}catch{}}

// O portal é estático. Guardamos a sessão no localStorage e em um cookie no
// mesmo domínio para que novas abas e páginas recuperem a mesma autenticação.
const sharedStorage={
  getItem:key=>localGet(key)??readCookie(key),
  setItem:(key,value)=>{localSet(key,value);writeCookie(key,value)},
  removeItem:key=>{localRemove(key);eraseCookie(key)}
};

useCanonicalOrigin();
export const supabase=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{
  persistSession:true,
  autoRefreshToken:true,
  detectSessionInUrl:true,
  flowType:'implicit',
  storageKey:AUTH_STORAGE_KEY,
  storage:sharedStorage
}});

const authChannel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('extreme-world-auth-sync');
let sessionReceiver=null;
if(authChannel){
  authChannel.onmessage=async({data})=>{
    if(data?.type==='request-session'){
      const {data:{session}}=await supabase.auth.getSession();
      if(session)authChannel.postMessage({type:'session-response',session});
      return;
    }
    if(data?.type==='session-response'&&data.session?.access_token&&data.session?.refresh_token){
      sessionReceiver?.(data.session);sessionReceiver=null;
    }
  };
}

async function requestOpenTabSession(){
  if(!authChannel)return null;
  const received=new Promise(resolve=>{
    sessionReceiver=resolve;
    setTimeout(()=>{if(sessionReceiver===resolve){sessionReceiver=null;resolve(null)}},1200);
  });
  authChannel.postMessage({type:'request-session'});
  return received;
}

function withTimeout(promise,ms=3500){
  return Promise.race([
    promise,
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('Tempo esgotado ao restaurar a sessão.')),ms))
  ]);
}

export async function getSharedSession(){
  try{
    let {data:{session}}=await withTimeout(supabase.auth.getSession());
    if(!session){
      const fromOpenTab=await requestOpenTabSession();
      if(fromOpenTab){
        await withTimeout(supabase.auth.setSession({access_token:fromOpenTab.access_token,refresh_token:fromOpenTab.refresh_token}));
        ({data:{session}}=await withTimeout(supabase.auth.getSession()));
      }
    }
    // Migra sessões criadas antes do cookie compartilhado sem disparar novo
    // evento de autenticação (e sem forçar o jogador a entrar novamente).
    if(session)sharedStorage.setItem(AUTH_STORAGE_KEY,JSON.stringify(session));
    return session||null;
  }catch(error){
    console.warn('Não foi possível restaurar a sessão:',error);
    return null;
  }
}

export async function syncDiscordRole(session){
  if(!session?.access_token)return null;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),5000);
  try{
    const response=await fetch('/api/discord-sync',{
      method:'POST',
      headers:{Authorization:`Bearer ${session.access_token}`},
      signal:controller.signal
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'Não foi possível sincronizar os cargos do Discord.');
    return data;
  }catch(error){
    if(error?.name==='AbortError')throw new Error('A sincronização de cargos demorou demais.');
    throw error;
  }finally{clearTimeout(timeout)}
}
