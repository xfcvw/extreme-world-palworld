begin;

alter table public.support_tickets add column if not exists description text;

update public.support_tickets ticket
set description = coalesce(
  nullif(trim(ticket.description), ''),
  (select message.body from public.support_ticket_messages message where message.ticket_id = ticket.id order by message.created_at asc limit 1),
  'Sem descrição informada.'
)
where ticket.description is null or trim(ticket.description) = '';

alter table public.support_tickets alter column description set not null;
alter table public.support_tickets drop constraint if exists support_tickets_description_check;
alter table public.support_tickets add constraint support_tickets_description_check check (char_length(trim(description)) between 1 and 2000);
alter table public.support_tickets drop constraint if exists support_tickets_status_check;
alter table public.support_tickets add constraint support_tickets_status_check check (status in ('open','in_progress','answered','closed'));

create index if not exists support_ticket_messages_author_idx on public.support_ticket_messages(author_id);

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

drop trigger if exists support_ticket_message_updates_status on public.support_ticket_messages;
create trigger support_ticket_message_updates_status
after insert on public.support_ticket_messages
for each row execute function public.sync_support_ticket_status_from_message();

update public.vip_plans
set name = 'VIP Inicial', slug = 'vip-inicial', price_cents = 1500,
    description = '1 Pal D–C, 10 MV, 20.000 Ouro e 5.000 Moedas de Cachorro.',
    featured = false, active = true, sort_order = 10, updated_at = now()
where slug = 'vip-bronze';

update public.vip_plans
set name = 'VIP Avançado', slug = 'vip-avancado', price_cents = 3500,
    description = '1 Pal C–A, 15 MV, moedas e transferência entre servidores.',
    featured = false, active = true, sort_order = 20, updated_at = now()
where slug = 'vip-prata';

update public.vip_plans
set active = false, featured = false, updated_at = now()
where slug = 'vip-ouro';

update public.vip_plans
set name = 'VIP Extreme', slug = 'vip-extreme', price_cents = 6500,
    description = 'Casal de Pals A–S, vendedor, 20 MV, transferências e vantagens em eventos.',
    featured = true, active = true, sort_order = 30, updated_at = now()
where slug = 'vip-diamante';

update public.products product
set name = plan.name, slug = plan.slug, description = plan.description,
    price_cents = plan.price_cents, featured = plan.featured, active = plan.active,
    updated_at = now()
from public.vip_plans plan
where product.vip_plan_id = plan.id and product.product_type = 'vip';

delete from public.vip_benefits
where vip_plan_id in (select id from public.vip_plans where slug in ('vip-inicial','vip-avancado','vip-extreme'));

insert into public.vip_benefits (vip_plan_id, benefit, sort_order)
select plan.id, benefit.item, benefit.position
from public.vip_plans plan
join lateral (
  values
    ('vip-inicial', 'Escolha de 1 Pal da categoria D até C', 1),
    ('vip-inicial', '10 Moedas da Vitória', 2),
    ('vip-inicial', '20.000 de Ouro + 5.000 Moedas de Cachorro', 3),
    ('vip-avancado', 'Escolha de 1 Pal da categoria C até A', 1),
    ('vip-avancado', '15 Moedas da Vitória', 2),
    ('vip-avancado', '30.000 de Ouro + 10.000 Moedas de Cachorro', 3),
    ('vip-avancado', 'Transferência de 5 packs de até 100 itens entre servidores (não válido para Pals)', 4),
    ('vip-avancado', '5% de desconto em compras acima de R$ 30', 5),
    ('vip-extreme', 'Escolha de 1 casal de Pals da categoria A até S', 1),
    ('vip-extreme', 'Escolha de 1 Vendedor Lendário ou Normal', 2),
    ('vip-extreme', '20 Moedas da Vitória', 3),
    ('vip-extreme', '40.000 de Ouro + 20.000 Moedas de Cachorro', 4),
    ('vip-extreme', 'Transferência de até 10 packs de 500 itens e até 10 Pals comprados', 5),
    ('vip-extreme', 'Pals nível 255 entram como nível 80 no servidor Hard', 6),
    ('vip-extreme', '10% de desconto acima de R$ 50 + 1 cupom exclusivo de 50%', 7),
    ('vip-extreme', 'Passe livre em eventos com Bilhete de Batalha', 8),
    ('vip-extreme', 'Loot da Torre Mortal Kombat pode ir para o servidor Hard', 9),
    ('vip-extreme', 'Pal prêmio do Boss Global pode ir para o servidor Hard no nível 80', 10)
) as benefit(slug, item, position) on benefit.slug = plan.slug;

commit;
