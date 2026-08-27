create table if not exists public.catalog_price_overrides (
  catalog_key text primary key check (length(catalog_key) between 3 and 180),
  victory_coins_price bigint not null check (victory_coins_price > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.catalog_price_overrides enable row level security;

create policy catalog_price_overrides_staff_read
on public.catalog_price_overrides for select to authenticated
using (public.is_staff());

create policy catalog_price_overrides_admin_manage
on public.catalog_price_overrides for all to authenticated
using (public.is_admin()) with check (public.is_admin());

grant select, insert, update on public.catalog_price_overrides to authenticated;

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
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'service role required'; end if;
  if p_user_id is null then raise exception 'user required'; end if;
  if p_server_number not in (1,2) then raise exception 'invalid server'; end if;
  if p_category not in ('pals','weapons','armor','resources') then raise exception 'invalid catalog category'; end if;
  if coalesce(length(trim(p_catalog_key)),0) < 3 or coalesce(length(trim(p_name)),0) < 2 then raise exception 'invalid catalog item'; end if;
  if p_victory_coins is null or p_victory_coins < 1 or p_victory_coins > 100000 then raise exception 'invalid victory coin price'; end if;

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
  return v_order_id;
end;
$function$;

revoke execute on function public.create_catalog_order_with_victory_coins(uuid,text,text,text,bigint,smallint,jsonb) from public, anon, authenticated;
grant execute on function public.create_catalog_order_with_victory_coins(uuid,text,text,text,bigint,smallint,jsonb) to service_role;
