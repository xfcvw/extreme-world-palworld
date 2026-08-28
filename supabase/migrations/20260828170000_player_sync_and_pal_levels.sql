alter table public.catalog_price_overrides
  add column if not exists pal_level_80_price bigint,
  add column if not exists pal_level_255_price bigint,
  add column if not exists pal_level_80_active boolean not null default true,
  add column if not exists pal_level_255_active boolean not null default true;

alter table public.catalog_price_overrides
  drop constraint if exists catalog_price_overrides_pal_level_80_price_check,
  drop constraint if exists catalog_price_overrides_pal_level_255_price_check;

alter table public.catalog_price_overrides
  add constraint catalog_price_overrides_pal_level_80_price_check
    check (pal_level_80_price is null or pal_level_80_price > 0),
  add constraint catalog_price_overrides_pal_level_255_price_check
    check (pal_level_255_price is null or pal_level_255_price > 0);
