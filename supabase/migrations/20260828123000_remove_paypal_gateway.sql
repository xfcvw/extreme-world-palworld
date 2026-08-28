begin;

update public.payments
set status = 'cancelled', raw_status = 'gateway_removed', updated_at = now()
where provider = 'paypal' and status = 'pending';

update public.orders
set status = 'cancelled', updated_at = now()
where payment_method = 'paypal' and status = 'pending_payment';

update public.products
set metadata = metadata - 'paypal_usd_cents', updated_at = now()
where metadata ? 'paypal_usd_cents';

drop function if exists public.process_paypal_payment(uuid,text,text,text,jsonb);

alter table public.orders drop constraint if exists orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check check (
  payment_method = any (array['pix'::text,'card'::text,'victory_coins'::text])
  or (payment_method = 'paypal' and status = 'cancelled')
);

alter table public.payments drop constraint if exists payments_payment_method_check;
alter table public.payments add constraint payments_payment_method_check check (
  payment_method = any (array['pix'::text,'card'::text])
  or (payment_method = 'paypal' and status = 'cancelled')
);

alter table public.payments drop constraint if exists payments_provider_check;
alter table public.payments add constraint payments_provider_check check (
  provider = 'mercado_pago'
  or (provider = 'paypal' and status = 'cancelled')
);

commit;
