-- Coupon restrictions and auditable, payment-safe redemptions.
alter table public.coupons
  add column if not exists target_user_id uuid references public.profiles(user_id) on delete set null;

update public.coupons
set max_uses_per_user = 1
where max_uses_per_user is null or max_uses_per_user <> 1;

alter table public.coupons
  alter column max_uses_per_user set default 1,
  alter column max_uses_per_user set not null;

alter table public.coupons
  drop constraint if exists coupons_max_uses_positive,
  add constraint coupons_max_uses_positive check (max_uses is null or max_uses > 0),
  drop constraint if exists coupons_max_uses_per_user_one,
  add constraint coupons_max_uses_per_user_one check (max_uses_per_user = 1);

create table if not exists public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id) on delete restrict,
  user_id uuid not null references public.profiles(user_id) on delete restrict,
  order_id uuid not null unique references public.orders(id) on delete cascade,
  status text not null default 'reserved' check (status in ('reserved', 'redeemed', 'released')),
  reserved_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  redeemed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists coupon_redemptions_coupon_status_idx
  on public.coupon_redemptions(coupon_id, status, expires_at);
create index if not exists coupon_redemptions_user_coupon_idx
  on public.coupon_redemptions(user_id, coupon_id);
create unique index if not exists coupon_redemptions_single_active_use_idx
  on public.coupon_redemptions(coupon_id, user_id)
  where status in ('reserved', 'redeemed');

alter table public.coupon_redemptions enable row level security;

create or replace function public.coupon_discount_cents(
  p_type text,
  p_value integer,
  p_subtotal_cents integer
) returns integer
language sql
immutable
set search_path = public
as $$
  select greatest(0, least(
    p_subtotal_cents,
    case when p_type = 'percent'
      then round(p_subtotal_cents * p_value / 100.0)::integer
      when p_type = 'fixed' then p_value
      else 0
    end
  ));
$$;

create or replace function public.coupon_quote_for_user(
  p_coupon_code text,
  p_user_id uuid,
  p_subtotal_cents integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coupon public.coupons%rowtype;
  v_used integer;
  v_discount integer;
begin
  if coalesce(trim(p_coupon_code), '') = '' then
    return jsonb_build_object('code', null, 'discount_cents', 0, 'discount_type', null, 'discount_value', null);
  end if;
  if p_user_id is null or p_subtotal_cents <= 0 then raise exception 'Dados do cupom inválidos.'; end if;

  select * into v_coupon
  from public.coupons
  where upper(code) = upper(trim(p_coupon_code));
  if not found or not v_coupon.active then raise exception 'Cupom inválido ou desativado.'; end if;
  if v_coupon.starts_at is not null and v_coupon.starts_at > now() then raise exception 'Este cupom ainda não está disponível.'; end if;
  if v_coupon.expires_at is not null and v_coupon.expires_at <= now() then raise exception 'Este cupom expirou.'; end if;
  if v_coupon.target_user_id is not null and v_coupon.target_user_id <> p_user_id then raise exception 'Cupom inválido para este usuário.'; end if;
  if coalesce(v_coupon.min_order_cents, 0) > p_subtotal_cents then raise exception 'Este cupom exige um pedido de valor maior.'; end if;

  select count(*) into v_used
  from public.coupon_redemptions
  where coupon_id = v_coupon.id
    and (status = 'redeemed' or (status = 'reserved' and expires_at > now()));
  if v_coupon.max_uses is not null and v_used >= v_coupon.max_uses then raise exception 'Cupom esgotado.'; end if;

  if exists (
    select 1 from public.coupon_redemptions
    where coupon_id = v_coupon.id and user_id = p_user_id
      and (status = 'redeemed' or (status = 'reserved' and expires_at > now()))
  ) then
    raise exception 'Este cupom já foi utilizado por você.';
  end if;

  v_discount := public.coupon_discount_cents(v_coupon.discount_type, v_coupon.discount_value, p_subtotal_cents);
  return jsonb_build_object(
    'id', v_coupon.id, 'code', v_coupon.code, 'discount_cents', v_discount,
    'discount_type', v_coupon.discount_type, 'discount_value', v_coupon.discount_value
  );
end;
$$;

create or replace function public.reserve_coupon_for_order(
  p_coupon_code text,
  p_user_id uuid,
  p_order_id uuid,
  p_subtotal_cents integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coupon public.coupons%rowtype;
  v_order_user_id uuid;
  v_quote jsonb;
  v_used integer;
begin
  select user_id into v_order_user_id from public.orders where id = p_order_id for update;
  if not found or v_order_user_id <> p_user_id then raise exception 'Pedido inválido para este cupom.'; end if;

  select * into v_coupon
  from public.coupons
  where upper(code) = upper(trim(p_coupon_code))
  for update;
  if not found then raise exception 'Cupom inválido ou desativado.'; end if;

  update public.coupon_redemptions
  set status = 'released', released_at = now()
  where coupon_id = v_coupon.id and status = 'reserved' and expires_at <= now();

  v_quote := public.coupon_quote_for_user(p_coupon_code, p_user_id, p_subtotal_cents);
  select count(*) into v_used
  from public.coupon_redemptions
  where coupon_id = v_coupon.id and (status = 'redeemed' or (status = 'reserved' and expires_at > now()));
  if v_coupon.max_uses is not null and v_used >= v_coupon.max_uses then raise exception 'Cupom esgotado.'; end if;

  insert into public.coupon_redemptions(coupon_id, user_id, order_id)
  values (v_coupon.id, p_user_id, p_order_id);
  return v_quote;
end;
$$;

create or replace function public.finalize_coupon_redemption(
  p_order_id uuid,
  p_approved boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_approved then
    update public.coupon_redemptions
    set status = 'redeemed', redeemed_at = coalesce(redeemed_at, now())
    where order_id = p_order_id and status = 'reserved';
  else
    update public.coupon_redemptions
    set status = 'released', released_at = coalesce(released_at, now())
    where order_id = p_order_id and status = 'reserved';
  end if;
end;
$$;

create or replace function public.release_coupon_reservation(p_order_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.coupon_redemptions
  set status = 'released', released_at = coalesce(released_at, now())
  where order_id = p_order_id and status = 'reserved';
$$;

revoke all on function public.coupon_quote_for_user(text, uuid, integer) from public;
revoke all on function public.reserve_coupon_for_order(text, uuid, uuid, integer) from public;
revoke all on function public.finalize_coupon_redemption(uuid, boolean) from public;
revoke all on function public.release_coupon_reservation(uuid) from public;
revoke all on function public.coupon_quote_for_user(text, uuid, integer) from anon, authenticated;
revoke all on function public.reserve_coupon_for_order(text, uuid, uuid, integer) from anon, authenticated;
revoke all on function public.finalize_coupon_redemption(uuid, boolean) from anon, authenticated;
revoke all on function public.release_coupon_reservation(uuid) from anon, authenticated;
grant execute on function public.coupon_quote_for_user(text, uuid, integer) to service_role;
grant execute on function public.reserve_coupon_for_order(text, uuid, uuid, integer) to service_role;
grant execute on function public.finalize_coupon_redemption(uuid, boolean) to service_role;
grant execute on function public.release_coupon_reservation(uuid) to service_role;
