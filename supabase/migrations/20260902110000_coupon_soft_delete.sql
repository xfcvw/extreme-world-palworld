alter table public.coupons
  add column if not exists deleted_at timestamptz;

create index if not exists coupons_visible_created_idx
  on public.coupons(created_at desc)
  where deleted_at is null;
