create table if not exists public.server_sync_status (
  server_number smallint primary key check (server_number in (1, 2)),
  last_attempt_at timestamptz not null default now(),
  last_success_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'online', 'degraded', 'unreachable', 'error')),
  online_player_count integer not null default 0 check (online_player_count >= 0),
  matched_bindings integer not null default 0 check (matched_bindings >= 0),
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.server_sync_status enable row level security;

revoke all on table public.server_sync_status from anon, authenticated;
grant select, insert, update, delete on table public.server_sync_status to service_role;

create policy "deny direct access to server sync status"
  on public.server_sync_status
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);
