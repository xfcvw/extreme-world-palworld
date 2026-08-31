-- Recursos novos são vendidos em pacotes de 2. Compras do front anterior
-- (por unidade) continuam válidas durante a atualização dos navegadores.
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
  v_quantity integer := 1;
  v_order_quantity integer := 1;
  v_pack_size integer := 2;
  v_pack_count integer := 1;
  v_quantity_text text;
  v_unit_victory_coins bigint := p_victory_coins;
  v_unit_resource boolean := p_category = 'resources' and coalesce(p_metadata->>'unit_pricing', 'false') = 'true';
  v_two_pack_resource boolean := p_category = 'resources' and coalesce(p_metadata->>'package_pricing', 'false') = 'true';
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'service role required'; end if;
  if p_user_id is null then raise exception 'user required'; end if;
  if p_server_number not in (1,2) then raise exception 'invalid server'; end if;
  if p_category not in ('pals','weapons','armor','resources') then raise exception 'invalid catalog category'; end if;
  if coalesce(length(trim(p_catalog_key)),0) < 3 or coalesce(length(trim(p_name)),0) < 2 then raise exception 'invalid catalog item'; end if;
  if p_victory_coins is null or p_victory_coins < 1 or p_victory_coins > 100000 then raise exception 'invalid victory coin price'; end if;

  if v_two_pack_resource then
    if trim(coalesce(p_metadata->>'pack_size', '')) <> '2' then raise exception 'invalid resource pack size'; end if;
    v_quantity_text := trim(coalesce(p_metadata->>'quantity', ''));
    if v_quantity_text !~ '^[0-9]{1,5}$' then raise exception 'invalid resource quantity'; end if;
    v_quantity := v_quantity_text::integer;
    if v_quantity < v_pack_size or v_quantity > 10000 or mod(v_quantity, v_pack_size) <> 0 then raise exception 'invalid resource pack quantity'; end if;
    v_pack_count := v_quantity / v_pack_size;
    if mod(p_victory_coins, v_pack_count) <> 0 then raise exception 'invalid resource pack price'; end if;
    v_order_quantity := v_pack_count;
    v_unit_victory_coins := p_victory_coins / v_pack_count;
  elsif v_unit_resource then
    v_quantity_text := trim(coalesce(p_metadata->>'quantity', ''));
    if v_quantity_text !~ '^[0-9]{1,5}$' then raise exception 'invalid resource quantity'; end if;
    v_quantity := v_quantity_text::integer;
    if v_quantity < 1 or v_quantity > 10000 then raise exception 'invalid resource quantity'; end if;
    if mod(p_victory_coins, v_quantity) <> 0 then raise exception 'invalid resource unit price'; end if;
    v_order_quantity := v_quantity;
    v_unit_victory_coins := p_victory_coins / v_quantity;
  elsif p_server_number = 1 and p_category in ('weapons','armor','resources') then
    v_quantity_text := trim(coalesce(p_metadata->>'quantity', '1'));
    if v_quantity_text !~ '^[0-9]{1,6}$' then raise exception 'invalid game item quantity'; end if;
    v_quantity := v_quantity_text::integer;
    if v_quantity < 1 or v_quantity > 100000 then raise exception 'invalid game item quantity'; end if;
  end if;

  if p_server_number = 1 and p_category in ('weapons','armor','resources') then
    v_item_asset := trim(coalesce(p_metadata->>'item_key', ''));
    if v_item_asset !~ '^[A-Za-z0-9_]{3,160}$' then raise exception 'invalid game item asset'; end if;
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
  values(v_order_id,trim(p_name),v_order_quantity,0,v_unit_victory_coins,jsonb_build_object('catalog_key',trim(p_catalog_key),'category',p_category)||coalesce(p_metadata,'{}'::jsonb));
  update public.wallets set balance=v_new_balance,updated_at=now() where user_id=p_user_id;
  insert into public.wallet_transactions(user_id,amount,balance_after,transaction_type,reason,order_id,created_by,metadata)
  values(p_user_id,-p_victory_coins,v_new_balance,'purchase_debit','Compra no catálogo: '||trim(p_name),v_order_id,p_user_id,jsonb_build_object('catalog_key',trim(p_catalog_key),'category',p_category,'server',p_server_number,'quantity',v_quantity,'packs',v_order_quantity));

  if p_server_number = 1 and p_category in ('weapons','armor','resources') then
    insert into public.game_delivery_jobs(order_id,server_number,category,player_nickname,item_asset,quantity)
    values(v_order_id,1,p_category,trim(v_nickname),v_item_asset,v_quantity);
  end if;
  return v_order_id;
end;
$function$;

revoke execute on function public.create_catalog_order_with_victory_coins(uuid,text,text,text,bigint,smallint,jsonb) from public, anon, authenticated;
grant execute on function public.create_catalog_order_with_victory_coins(uuid,text,text,text,bigint,smallint,jsonb) to service_role;
