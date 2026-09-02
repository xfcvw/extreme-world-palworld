-- Soft-deleted coupons must not reserve their code forever. Keeping a new
-- campaign as a new row preserves the audit history of the previous coupon.
alter table public.coupons
  drop constraint if exists coupons_code_key;

create unique index if not exists coupons_active_code_unique
  on public.coupons (upper(code))
  where deleted_at is null;
