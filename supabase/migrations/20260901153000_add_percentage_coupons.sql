create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  discount_percent smallint not null check (discount_percent between 1 and 90),
  active boolean not null default true,
  created_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  constraint coupons_code_format check (code ~ '^[A-Z0-9_-]{3,32}$')
);

alter table public.coupons enable row level security;
alter table public.orders add column if not exists coupon_code text;
alter table public.orders add column if not exists discount_cents integer not null default 0 check (discount_cents >= 0);
