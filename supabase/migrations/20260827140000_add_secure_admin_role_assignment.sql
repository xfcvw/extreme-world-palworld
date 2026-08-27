alter table public.profiles
  add column if not exists role_source text not null default 'discord';

alter table public.profiles
  drop constraint if exists profiles_role_source_check;

alter table public.profiles
  add constraint profiles_role_source_check
  check (role_source in ('discord', 'manual'));

create or replace function public.admin_set_portal_role(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_role text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_role text;
  v_target_role text;
  v_owner_count integer;
  v_role text := lower(trim(coalesce(p_role, '')));
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then raise exception 'service role required'; end if;
  if p_actor_user_id is null or p_target_user_id is null then raise exception 'user required'; end if;
  if p_actor_user_id = p_target_user_id then raise exception 'cannot change own role'; end if;
  if v_role not in ('owner', 'admin', 'support', 'player') then raise exception 'invalid portal role'; end if;

  select role into v_actor_role from public.profiles where user_id = p_actor_user_id;
  if v_actor_role is distinct from 'owner' then raise exception 'owner required'; end if;

  select role into v_target_role from public.profiles where user_id = p_target_user_id for update;
  if not found then raise exception 'profile not found'; end if;

  if v_target_role = 'owner' and v_role <> 'owner' then
    select count(*) into v_owner_count from public.profiles where role = 'owner';
    if v_owner_count <= 1 then raise exception 'last owner'; end if;
  end if;

  update public.profiles set role = v_role, role_source = 'manual', updated_at = now() where user_id = p_target_user_id;
  insert into public.admin_logs(admin_user_id, action, entity_type, entity_id, details)
  values (p_actor_user_id, 'role_assignment', 'profile', p_target_user_id, jsonb_build_object('previous_role', v_target_role, 'new_role', v_role, 'source', 'admin_panel'));
  return v_role;
end;
$function$;

revoke execute on function public.admin_set_portal_role(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_set_portal_role(uuid, uuid, text) to service_role;
