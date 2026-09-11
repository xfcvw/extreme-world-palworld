create table if not exists public.revenue_reporting_period (
  id boolean primary key default true check (id),
  starts_at timestamptz not null default now()
);

alter table public.revenue_reporting_period enable row level security;
revoke all on table public.revenue_reporting_period from public, anon, authenticated;

insert into public.revenue_reporting_period (id, starts_at)
values (true, now())
on conflict (id) do nothing;

create or replace function public.owner_revenue_summary(p_actor_user_id uuid)
returns table(total_cents bigint, approved_payments bigint, paying_customers bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_starts_at timestamptz;
begin
  if not exists (
    select 1
    from public.profiles
    where user_id = p_actor_user_id
      and role = 'owner'
  ) then
    raise exception 'owner required';
  end if;

  select starts_at
  into v_starts_at
  from public.revenue_reporting_period
  where id = true;

  return query
  select
    coalesce(sum(payments.amount_cents), 0)::bigint,
    count(*)::bigint,
    count(distinct orders.user_id)::bigint
  from public.payments
  join public.orders on orders.id = payments.order_id
  where payments.status = 'approved'
    and coalesce(payments.approved_at, payments.updated_at, payments.created_at) >= coalesce(v_starts_at, now());
end;
$$;

revoke all on function public.owner_revenue_summary(uuid) from public, anon, authenticated;
grant execute on function public.owner_revenue_summary(uuid) to service_role;