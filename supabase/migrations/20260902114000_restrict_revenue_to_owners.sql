-- Admins keep access to operational order summaries through the server API,
-- but payment values and revenue totals remain owner-only.
drop policy if exists orders_select_self_or_staff on public.orders;
create policy orders_select_self_or_owner
  on public.orders
  for select
  using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.profiles
      where profiles.user_id = auth.uid()
        and profiles.role = 'owner'
    )
  );

drop policy if exists payments_select_self_or_staff on public.payments;
create policy payments_select_self_or_owner
  on public.payments
  for select
  using (
    exists (
      select 1
      from public.orders
      where orders.id = payments.order_id
        and (
          orders.user_id = auth.uid()
          or exists (
            select 1
            from public.profiles
            where profiles.user_id = auth.uid()
              and profiles.role = 'owner'
          )
        )
    )
  );

create or replace function public.owner_revenue_summary(
  p_actor_user_id uuid
) returns table (
  total_cents bigint,
  approved_payments bigint,
  paying_customers bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.profiles
    where user_id = p_actor_user_id
      and role = 'owner'
  ) then
    raise exception 'owner required';
  end if;

  return query
  select
    coalesce(sum(payments.amount_cents), 0)::bigint,
    count(*)::bigint,
    count(distinct orders.user_id)::bigint
  from public.payments
  join public.orders on orders.id = payments.order_id
  where payments.status = 'approved';
end;
$$;

revoke all on function public.owner_revenue_summary(uuid) from public, anon, authenticated;
grant execute on function public.owner_revenue_summary(uuid) to service_role;
