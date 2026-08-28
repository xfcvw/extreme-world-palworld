create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('support','purchase')),
  subject text not null check (char_length(subject) between 3 and 120),
  description text not null check (char_length(trim(description)) between 1 and 2000),
  status text not null default 'open' check (status in ('open','in_progress','answered','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists support_tickets_user_created_idx on public.support_tickets(user_id, created_at desc);
create index if not exists support_tickets_status_created_idx on public.support_tickets(status, created_at desc);
create index if not exists support_ticket_messages_ticket_created_idx on public.support_ticket_messages(ticket_id, created_at asc);
create index if not exists support_ticket_messages_author_idx on public.support_ticket_messages(author_id);

alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;
revoke all on table public.support_tickets from anon, authenticated;
revoke all on table public.support_ticket_messages from anon, authenticated;
grant select, insert, update on table public.support_tickets to authenticated;
grant select, insert on table public.support_ticket_messages to authenticated;

create policy "ticket_owner_or_staff_select" on public.support_tickets for select to authenticated using ((select auth.uid()) = user_id or (select public.is_staff()));
create policy "ticket_owner_insert" on public.support_tickets for insert to authenticated with check ((select auth.uid()) = user_id and category in ('support','purchase') and status = 'open');
create policy "ticket_staff_update" on public.support_tickets for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "ticket_messages_owner_or_staff_select" on public.support_ticket_messages for select to authenticated using ((select public.is_staff()) or exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = (select auth.uid())));
create policy "ticket_messages_owner_or_staff_insert" on public.support_ticket_messages for insert to authenticated with check (author_id = (select auth.uid()) and ((select public.is_staff()) or exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = (select auth.uid()))));

create trigger support_tickets_set_updated_at before update on public.support_tickets for each row execute function public.set_updated_at();

create or replace function public.sync_support_ticket_status_from_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ticket_owner uuid;
begin
  select user_id into ticket_owner from public.support_tickets where id = new.ticket_id;
  update public.support_tickets
  set status = case when new.author_id = ticket_owner then 'open' else 'answered' end
  where id = new.ticket_id and status <> 'closed';
  return new;
end;
$$;

revoke execute on function public.sync_support_ticket_status_from_message() from public, anon, authenticated;

create trigger support_ticket_message_updates_status
after insert on public.support_ticket_messages
for each row execute function public.sync_support_ticket_status_from_message();
