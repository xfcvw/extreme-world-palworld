alter table public.catalog_price_overrides
  add column if not exists equipment_normal_price bigint,
  add column if not exists equipment_legendary_price bigint;

alter table public.catalog_price_overrides
  drop constraint if exists catalog_price_overrides_equipment_normal_price_check,
  drop constraint if exists catalog_price_overrides_equipment_legendary_price_check;

alter table public.catalog_price_overrides
  add constraint catalog_price_overrides_equipment_normal_price_check
  check (equipment_normal_price is null or equipment_normal_price > 0),
  add constraint catalog_price_overrides_equipment_legendary_price_check
  check (equipment_legendary_price is null or equipment_legendary_price > 0);
