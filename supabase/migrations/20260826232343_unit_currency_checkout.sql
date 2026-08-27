-- Compra unitária de Moedas da Vitória: o servidor calcula R$ 0,50 por MV.
-- Os processadores existentes continuam idempotentes; este gatilho troca o
-- crédito fixo do produto pela quantidade auditada no item do pedido.
create or replace function public.apply_custom_currency_quantity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_quantity bigint;
  v_original_amount bigint;
  v_balance bigint;
begin
  if new.transaction_type <> 'purchase_credit' or new.order_id is null then
    return new;
  end if;

  select nullif(oi.metadata->>'currency_quantity','')::bigint
    into v_quantity
  from public.order_items oi
  join public.products p on p.id = oi.product_id
  where oi.order_id = new.order_id
    and p.product_type = 'currency'
  order by oi.created_at asc
  limit 1;

  if v_quantity is null then
    return new;
  end if;
  if v_quantity < 1 or v_quantity > 10000 then
    raise exception 'invalid custom currency quantity';
  end if;

  v_original_amount := new.amount;
  update public.wallets
     set balance = balance + (v_quantity - v_original_amount),
         updated_at = now()
   where user_id = new.user_id
   returning balance into v_balance;

  if v_balance is null then
    raise exception 'wallet not found';
  end if;

  new.amount := v_quantity;
  new.balance_after := v_balance;
  new.reason := 'Compra aprovada: ' || v_quantity || ' Moedas da Vitória';
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('currency_quantity', v_quantity, 'unit_price_cents', 50);
  return new;
end;
$function$;

revoke execute on function public.apply_custom_currency_quantity() from public, anon, authenticated;

drop trigger if exists wallet_transactions_apply_custom_currency_quantity on public.wallet_transactions;
create trigger wallet_transactions_apply_custom_currency_quantity
before insert on public.wallet_transactions
for each row execute function public.apply_custom_currency_quantity();
