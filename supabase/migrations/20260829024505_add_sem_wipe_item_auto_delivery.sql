-- Automatic game-inventory delivery is intentionally limited to server 1.
-- Pals and every delivery for the Wipe server remain manual.

create table if not exists public.game_delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  server_number smallint not null check (server_number = 1),
  category text not null check (category in ('weapons', 'armor', 'resources')),
  player_nickname text not null check (length(trim(player_nickname)) between 1 and 80),
  item_asset text not null check (item_asset ~ '^[A-Za-z0-9_]{3,160}$'),
  quantity integer not null check (quantity between 1 and 100000),
  status text not null default 'queued' check (status in ('queued', 'processing', 'delivered', 'failed')),
  attempts smallint not null default 0 check (attempts >= 0),
  agent_id text,
  claim_token uuid,
  lease_expires_at timestamptz,
  available_at timestamptz not null default now(),
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_delivery_jobs_processing_claim_check check (
    (status = 'processing' and claim_token is not null and lease_expires_at is not null and agent_id is not null)
    or status <> 'processing'
  )
);

create index if not exists game_delivery_jobs_claim_idx
on public.game_delivery_jobs (server_number, status, available_at, created_at);

alter table public.game_delivery_jobs enable row level security;
revoke all on table public.game_delivery_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.game_delivery_jobs to service_role;

create or replace function public.create_catalog_order_with_victory_coins(
  p_user_id uuid, p_catalog_key text, p_name text, p_category text,
  p_victory_coins bigint, p_server_number smallint, p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql security definer set search_path = ''
as $function$
declare
  v_nickname text;
  v_balance bigint;
  v_new_balance bigint;
  v_order_id uuid;
  v_item_asset text;
  v_quantity integer;
  v_quantity_text text;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'service role required'; end if;
  if p_user_id is null then raise exception 'user required'; end if;
  if p_server_number not in (1,2) then raise exception 'invalid server'; end if;
  if p_category not in ('pals','weapons','armor','resources') then raise exception 'invalid catalog category'; end if;
  if coalesce(length(trim(p_catalog_key)),0) < 3 or coalesce(length(trim(p_name)),0) < 2 then raise exception 'invalid catalog item'; end if;
  if p_victory_coins is null or p_victory_coins < 1 or p_victory_coins > 100000 then raise exception 'invalid victory coin price'; end if;

  -- The queue is only created for the Sem Wipe server and only for inventory items.
  -- Validate before debiting the wallet so malformed catalog data never creates a charge.
  if p_server_number = 1 and p_category in ('weapons','armor','resources') then
    v_item_asset := trim(coalesce(p_metadata->>'item_key', ''));
    if v_item_asset !~ '^[A-Za-z0-9_]{3,160}$' then raise exception 'invalid game item asset'; end if;
    v_quantity_text := trim(coalesce(p_metadata->>'quantity', '1'));
    if v_quantity_text !~ '^[0-9]{1,6}$' then raise exception 'invalid game item quantity'; end if;
    v_quantity := v_quantity_text::integer;
    if v_quantity < 1 or v_quantity > 100000 then raise exception 'invalid game item quantity'; end if;
  end if;

  select palworld_nickname into v_nickname from public.profiles where user_id=p_user_id and active=true;
  if coalesce(trim(v_nickname),'')='' then raise exception 'palworld nickname required'; end if;
  select balance into v_balance from public.wallets where user_id=p_user_id for update;
  if v_balance is null then raise exception 'wallet not found'; end if;
  if v_balance < p_victory_coins then raise exception 'insufficient balance'; end if;
  v_new_balance:=v_balance-p_victory_coins;

  insert into public.orders(user_id,status,payment_method,victory_coins_total,palworld_nickname,server_number,notes)
  values(p_user_id,'awaiting_delivery','victory_coins',p_victory_coins,v_nickname,p_server_number,'Compra pelo catálogo completo: '||p_category)
  returning id into v_order_id;
  insert into public.order_items(order_id,name_snapshot,quantity,unit_price_cents,unit_victory_coins,metadata)
  values(v_order_id,trim(p_name),1,0,p_victory_coins,jsonb_build_object('catalog_key',trim(p_catalog_key),'category',p_category)||coalesce(p_metadata,'{}'::jsonb));
  update public.wallets set balance=v_new_balance,updated_at=now() where user_id=p_user_id;
  insert into public.wallet_transactions(user_id,amount,balance_after,transaction_type,reason,order_id,created_by,metadata)
  values(p_user_id,-p_victory_coins,v_new_balance,'purchase_debit','Compra no catálogo: '||trim(p_name),v_order_id,p_user_id,jsonb_build_object('catalog_key',trim(p_catalog_key),'category',p_category,'server',p_server_number));

  if p_server_number = 1 and p_category in ('weapons','armor','resources') then
    insert into public.game_delivery_jobs(order_id,server_number,category,player_nickname,item_asset,quantity)
    values(v_order_id,1,p_category,trim(v_nickname),v_item_asset,v_quantity);
  end if;
  return v_order_id;
end;
$function$;

create or replace function public.claim_next_game_delivery(
  p_server_number smallint,
  p_agent_id text
)
returns table (
  id uuid,
  claim_token uuid,
  player_nickname text,
  item_asset text,
  quantity integer,
  category text
)
language plpgsql security definer set search_path = ''
as $function$
declare
  v_job_id uuid;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'service role required'; end if;
  if p_server_number <> 1 then raise exception 'automatic delivery is only enabled for server 1'; end if;
  if coalesce(length(trim(p_agent_id)),0) < 3 or length(trim(p_agent_id)) > 80 then raise exception 'invalid agent'; end if;

  select j.id into v_job_id
  from public.game_delivery_jobs j
  where j.server_number = p_server_number
    and (
      (j.status = 'queued' and j.available_at <= now())
      or (j.status = 'processing' and j.lease_expires_at < now())
    )
  order by j.created_at
  for update skip locked
  limit 1;

  if v_job_id is null then return; end if;

  return query
  update public.game_delivery_jobs j
  set status = 'processing',
      attempts = j.attempts + 1,
      agent_id = trim(p_agent_id),
      claim_token = gen_random_uuid(),
      lease_expires_at = now() + interval '2 minutes',
      last_error = null,
      updated_at = now()
  where j.id = v_job_id
  returning j.id, j.claim_token, j.player_nickname, j.item_asset, j.quantity, j.category;

  update public.orders o
  set status = 'in_delivery', updated_at = now()
  from public.game_delivery_jobs j
  where j.id = v_job_id and o.id = j.order_id and o.status = 'awaiting_delivery';
end;
$function$;

create or replace function public.complete_game_delivery(
  p_job_id uuid,
  p_claim_token uuid,
  p_agent_id text,
  p_result text,
  p_error text default null
)
returns boolean
language plpgsql security definer set search_path = ''
as $function$
declare
  v_order_id uuid;
  v_job_status text;
  v_error text := nullif(left(trim(coalesce(p_error,'')), 500), '');
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'service role required'; end if;
  if p_result not in ('delivered','deferred','failed') then raise exception 'invalid delivery result'; end if;
  if coalesce(length(trim(p_agent_id)),0) < 3 then raise exception 'invalid agent'; end if;

  select order_id, status into v_order_id, v_job_status
  from public.game_delivery_jobs
  where id = p_job_id and claim_token = p_claim_token and agent_id = trim(p_agent_id)
  for update;

  if v_order_id is null then raise exception 'delivery claim not found'; end if;
  if v_job_status = 'delivered' then return true; end if;
  if v_job_status <> 'processing' then raise exception 'delivery claim is no longer active'; end if;

  if p_result = 'delivered' then
    update public.game_delivery_jobs
    set status = 'delivered', delivered_at = now(), lease_expires_at = null, available_at = now(), last_error = null, updated_at = now()
    where id = p_job_id;
    update public.orders set status = 'delivered', delivered_at = now(), updated_at = now() where id = v_order_id;
  elsif p_result = 'deferred' then
    update public.game_delivery_jobs
    set status = 'queued', claim_token = null, agent_id = null, lease_expires_at = null,
        available_at = now() + interval '60 seconds', last_error = coalesce(v_error, 'Jogador offline'), updated_at = now()
    where id = p_job_id;
    update public.orders set status = 'awaiting_delivery', updated_at = now() where id = v_order_id and status = 'in_delivery';
  else
    update public.game_delivery_jobs
    set status = 'failed', lease_expires_at = null, last_error = coalesce(v_error, 'Falha de entrega'), updated_at = now()
    where id = p_job_id;
    update public.orders set status = 'awaiting_delivery', updated_at = now() where id = v_order_id and status = 'in_delivery';
  end if;
  return true;
end;
$function$;

revoke execute on function public.create_catalog_order_with_victory_coins(uuid,text,text,text,bigint,smallint,jsonb) from public, anon, authenticated;
grant execute on function public.create_catalog_order_with_victory_coins(uuid,text,text,text,bigint,smallint,jsonb) to service_role;
revoke execute on function public.claim_next_game_delivery(smallint,text) from public, anon, authenticated;
grant execute on function public.claim_next_game_delivery(smallint,text) to service_role;
revoke execute on function public.complete_game_delivery(uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.complete_game_delivery(uuid,uuid,text,text,text) to service_role;
