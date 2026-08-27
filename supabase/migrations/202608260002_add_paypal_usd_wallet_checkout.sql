alter table public.orders drop constraint if exists orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check check (payment_method = any (array['pix'::text,'card'::text,'paypal'::text,'victory_coins'::text]));
alter table public.payments drop constraint if exists payments_payment_method_check;
alter table public.payments add constraint payments_payment_method_check check (payment_method = any (array['pix'::text,'card'::text,'paypal'::text]));
alter table public.payments drop constraint if exists payments_provider_check;
alter table public.payments add constraint payments_provider_check check (provider = any (array['mercado_pago'::text,'paypal'::text]));

update public.products
set metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{paypal_usd_cents}',to_jsonb(case currency_amount when 50 then 500 when 100 then 1000 when 310 then 3000 when 520 then 5000 when 850 then 8000 when 1100 then 10000 else null end),true)
where product_type='currency' and currency_amount in (50,100,310,520,850,1100);

create or replace function public.process_paypal_payment(p_order_id uuid,p_provider_payment_id text,p_status text,p_raw_status text,p_metadata jsonb default '{}'::jsonb)
returns text language plpgsql security definer set search_path=''
as $function$
declare v_payment public.payments%rowtype; v_order public.orders%rowtype; v_item public.order_items%rowtype; v_product public.products%rowtype; v_wallet public.wallets%rowtype; v_new_balance bigint; v_order_status text;
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'service role required'; end if;
  if p_status not in ('pending','approved','rejected','cancelled','refunded','in_process') then raise exception 'invalid payment status'; end if;
  select * into v_payment from public.payments where order_id=p_order_id and provider='paypal' order by created_at desc limit 1 for update;
  if not found then raise exception 'paypal payment not found'; end if;
  if v_payment.status='approved' and p_status='approved' then return 'already_processed'; end if;
  update public.payments set provider_payment_id=coalesce(p_provider_payment_id,provider_payment_id),status=p_status,payment_method='paypal',raw_status=p_raw_status,approved_at=case when p_status='approved' then coalesce(approved_at,now()) else approved_at end,metadata=coalesce(p_metadata,'{}'::jsonb),updated_at=now() where id=v_payment.id;
  select * into v_order from public.orders where id=p_order_id for update; if not found then raise exception 'order not found'; end if;
  if p_status='approved' then
    select * into v_item from public.order_items where order_id=p_order_id order by created_at asc limit 1; if not found or v_item.product_id is null then raise exception 'order item not found'; end if;
    select * into v_product from public.products where id=v_item.product_id; if v_product.product_type<>'currency' or coalesce(v_product.currency_amount,0)<1 then raise exception 'invalid paypal product'; end if;
    if not exists(select 1 from public.wallet_transactions where payment_id=v_payment.id and transaction_type='purchase_credit') then
      select * into v_wallet from public.wallets where user_id=v_order.user_id for update; if not found then raise exception 'wallet not found'; end if;
      v_new_balance:=v_wallet.balance+v_product.currency_amount; update public.wallets set balance=v_new_balance,updated_at=now() where user_id=v_order.user_id;
      insert into public.wallet_transactions(user_id,amount,balance_after,transaction_type,reason,order_id,payment_id,metadata) values(v_order.user_id,v_product.currency_amount,v_new_balance,'purchase_credit','Compra PayPal aprovada: '||v_product.name,p_order_id,v_payment.id,jsonb_build_object('paypal_order_id',p_provider_payment_id,'currency','USD'));
    end if;
    v_order_status:='delivered'; update public.orders set status=v_order_status,payment_method='paypal',delivered_at=coalesce(delivered_at,now()),updated_at=now() where id=p_order_id;
  elsif p_status in ('rejected','cancelled') then update public.orders set status='cancelled',updated_at=now() where id=p_order_id;
  elsif p_status='refunded' then update public.orders set status='refunded',updated_at=now() where id=p_order_id; end if;
  return coalesce(v_order_status,p_status);
end;
$function$;
revoke execute on function public.process_paypal_payment(uuid,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.process_paypal_payment(uuid,text,text,text,jsonb) to service_role;
