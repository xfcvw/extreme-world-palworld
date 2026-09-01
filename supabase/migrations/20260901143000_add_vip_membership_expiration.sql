create table if not exists public.vip_memberships (
  order_id uuid primary key references public.orders(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  vip_plan_id uuid references public.vip_plans(id) on delete set null,
  vip_name text not null,
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint vip_memberships_valid_period check (expires_at > starts_at)
);

create index if not exists vip_memberships_user_expiry_idx
  on public.vip_memberships (user_id, expires_at desc);

alter table public.vip_memberships enable row level security;
grant select on public.vip_memberships to authenticated;

drop policy if exists "members can read their vip memberships" on public.vip_memberships;
create policy "members can read their vip memberships"
  on public.vip_memberships for select to authenticated
  using ((select auth.uid()) = user_id or public.is_staff());

create or replace function public.activate_vip_membership_from_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  vip_item record;
  membership_start timestamptz;
begin
  if new.status not in ('paid', 'awaiting_delivery', 'in_delivery', 'delivered') then
    return new;
  end if;

  select vip_plan_id, name_snapshot
    into vip_item
  from public.order_items
  where order_id = new.id and vip_plan_id is not null
  order by created_at asc
  limit 1;

  if not found or exists (select 1 from public.vip_memberships where order_id = new.id) then
    return new;
  end if;

  select greatest(now(), coalesce(max(expires_at), now()))
    into membership_start
  from public.vip_memberships
  where user_id = new.user_id;

  insert into public.vip_memberships (order_id, user_id, vip_plan_id, vip_name, starts_at, expires_at)
  values (
    new.id,
    new.user_id,
    vip_item.vip_plan_id,
    coalesce(vip_item.name_snapshot, 'VIP'),
    membership_start,
    membership_start + interval '30 days'
  );

  return new;
end;
$$;

revoke all on function public.activate_vip_membership_from_order() from public;

drop trigger if exists activate_vip_membership_from_order on public.orders;
create trigger activate_vip_membership_from_order
  after insert or update of status on public.orders
  for each row execute function public.activate_vip_membership_from_order();

do $$
declare
  existing_order record;
  membership_start timestamptz;
begin
  for existing_order in
    select distinct on (o.id)
      o.id as order_id,
      o.user_id,
      o.created_at,
      i.vip_plan_id,
      i.name_snapshot
    from public.orders o
    join public.order_items i on i.order_id = o.id and i.vip_plan_id is not null
    where o.status in ('paid', 'awaiting_delivery', 'in_delivery', 'delivered')
    order by o.id, i.created_at asc
  loop
    if exists (select 1 from public.vip_memberships where order_id = existing_order.order_id) then
      continue;
    end if;

    select greatest(existing_order.created_at, coalesce(max(expires_at), existing_order.created_at))
      into membership_start
    from public.vip_memberships
    where user_id = existing_order.user_id;

    insert into public.vip_memberships (order_id, user_id, vip_plan_id, vip_name, starts_at, expires_at)
    values (
      existing_order.order_id,
      existing_order.user_id,
      existing_order.vip_plan_id,
      coalesce(existing_order.name_snapshot, 'VIP'),
      membership_start,
      membership_start + interval '30 days'
    );
  end loop;
end;
$$;
