create or replace function public.admin_adjust_victory_coins(
  p_admin_user_id uuid,
  p_target_user_id uuid,
  p_delta bigint,
  p_reason text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_balance bigint;
  v_new_balance bigint;
  v_reason text;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'service role required';
  end if;
  if p_admin_user_id is null or p_target_user_id is null then
    raise exception 'user required';
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000 then
    raise exception 'invalid victory coin adjustment';
  end if;

  v_reason := left(trim(coalesce(p_reason, 'Ajuste manual pela equipe')), 220);
  if v_reason = '' then v_reason := 'Ajuste manual pela equipe'; end if;

  select balance into v_balance
  from public.wallets
  where user_id = p_target_user_id
  for update;
  if v_balance is null then raise exception 'wallet not found'; end if;

  v_new_balance := v_balance + p_delta;
  if v_new_balance < 0 then raise exception 'insufficient balance'; end if;

  update public.wallets
  set balance = v_new_balance, updated_at = now()
  where user_id = p_target_user_id;

  insert into public.wallet_transactions(user_id, amount, balance_after, transaction_type, reason, created_by, metadata)
  values (
    p_target_user_id,
    p_delta,
    v_new_balance,
    case when p_delta > 0 then 'admin_credit' else 'admin_debit' end,
    v_reason,
    p_admin_user_id,
    jsonb_build_object('source', 'admin_panel', 'adjusted_by', p_admin_user_id)
  );

  insert into public.admin_logs(admin_user_id, action, entity_type, entity_id, details)
  values (
    p_admin_user_id,
    'wallet_adjustment',
    'wallet',
    p_target_user_id,
    jsonb_build_object('delta', p_delta, 'balance_after', v_new_balance, 'reason', v_reason)
  );

  return v_new_balance;
end;
$function$;

revoke execute on function public.admin_adjust_victory_coins(uuid, uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.admin_adjust_victory_coins(uuid, uuid, bigint, text) to service_role;
