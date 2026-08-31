-- Recursos deixam de ser pacotes fechados: cada pedido informa quantidade e
-- o preço por unidade configurado no catálogo é multiplicado pela API segura.
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
  v_quantity_text text;
  v_unit_victory_coins bigint;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'service role required'; end if;
  if p_user_id is null then raise exception 'user required'; end if;
  if p_server_number not in (1,2) then raise exception 'invalid server'; end if;
  if p_category not in ('pals','weapons','armor','resources') then raise exception 'invalid catalog category'; end if;
  if coalesce(length(trim(p_catalog_key)),0) < 3 or coalesce(length(trim(p_name)),0) < 2 then raise exception 'invalid catalog item'; end if;
  if p_victory_coins is null or p_victory_coins < 1 or p_victory_coins > 100000 then raise exception 'invalid victory coin price'; end if;

  if p_category = 'resources' then
    v_quantity_text := trim(coalesce(p_metadata->>'quantity', ''));
    if v_quantity_text !~ '^[0-9]{1,5}$' then raise exception 'invalid resource quantity'; end if;
    v_quantity := v_quantity_text::integer;
    if v_quantity < 1 or v_quantity > 10000 then raise exception 'invalid resource quantity'; end if;
    if mod(p_victory_coins, v_quantity) <> 0 then raise exception 'invalid resource unit price'; end if;
  end if;
  v_unit_victory_coins := case when p_category = 'resources' then p_victory_coins / v_quantity else p_victory_coins end;

  -- A entrega automática, quando o agente estiver ativo, usa a mesma
  -- quantidade registrada no pedido. Para armas e armaduras continua 1.
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
  values(v_order_id,trim(p_name),v_quantity,0,v_unit_victory_coins,jsonb_build_object('catalog_key',trim(p_catalog_key),'category',p_category)||coalesce(p_metadata,'{}'::jsonb));
  update public.wallets set balance=v_new_balance,updated_at=now() where user_id=p_user_id;
  insert into public.wallet_transactions(user_id,amount,balance_after,transaction_type,reason,order_id,created_by,metadata)
  values(p_user_id,-p_victory_coins,v_new_balance,'purchase_debit','Compra no catálogo: '||trim(p_name),v_order_id,p_user_id,jsonb_build_object('catalog_key',trim(p_catalog_key),'category',p_category,'server',p_server_number,'quantity',v_quantity));

  if p_server_number = 1 and p_category in ('weapons','armor','resources') then
    insert into public.game_delivery_jobs(order_id,server_number,category,player_nickname,item_asset,quantity)
    values(v_order_id,1,p_category,trim(v_nickname),v_item_asset,v_quantity);
  end if;
  return v_order_id;
end;
$function$;

revoke execute on function public.create_catalog_order_with_victory_coins(uuid,text,text,text,bigint,smallint,jsonb) from public, anon, authenticated;
grant execute on function public.create_catalog_order_with_victory_coins(uuid,text,text,text,bigint,smallint,jsonb) to service_role;
