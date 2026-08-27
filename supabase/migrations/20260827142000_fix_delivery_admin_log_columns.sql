create or replace function public.staff_set_order_delivery_status(
  p_order_id uuid,
  p_status text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old text;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  if p_status not in ('awaiting_delivery','in_delivery','delivered') then raise exception 'invalid status'; end if;

  select status into v_old from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_old not in ('paid','awaiting_delivery','in_delivery','delivered') then raise exception 'order is not in delivery flow'; end if;

  update public.orders
  set status = p_status,
      delivered_at = case when p_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
      updated_at = now()
  where id = p_order_id;

  insert into public.admin_logs(admin_user_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'order_delivery_status', 'order', p_order_id, jsonb_build_object('from', v_old, 'to', p_status));

  return p_status;
end;
$function$;
