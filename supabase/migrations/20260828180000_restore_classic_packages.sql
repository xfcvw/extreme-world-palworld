insert into public.products (name, slug, description, product_type, price_cents, image_url, featured, active, metadata)
values
  ('Pacote Bronze', 'pacote-bronze', 'Pacote clássico Bronze para o servidor sem Wipe.', 'package', 1999, '/assets/pacotes-extreme-world.jpg', false, true, '{"package_bundle":true,"display_order":10,"benefits":["Pal nível C","1.000 Moedas de Cachorro","100 Esferas Terra","1 Besta Lendária","1.000 Flechas"]}'::jsonb),
  ('Pacote Prata', 'pacote-prata', 'Pacote clássico Prata para o servidor sem Wipe.', 'package', 3980, '/assets/pacotes-extreme-world.jpg', false, true, '{"package_bundle":true,"display_order":20,"benefits":["Pal nível B","2.000 Moedas de Cachorro","10.000 Moedas de Ouro","100 Esferas Ultra","Armadura Lendária","Escudo Giga"]}'::jsonb),
  ('Pacote Ouro', 'pacote-ouro', 'Pacote clássico Ouro para o servidor sem Wipe.', 'package', 4990, '/assets/pacotes-extreme-world.jpg', true, true, '{"package_bundle":true,"display_order":30,"benefits":["Pal nível A","5.000 Moedas de Cachorro","20.000 Moedas de Ouro","Armadura de Metal Pal Lendária","Fuzil Lendário","500 Balas","100 Esferas Lendárias","Saco de Ração Colossal","Planador Terra"]}'::jsonb),
  ('Pacote Diamante', 'pacote-diamante', 'Pacote clássico Diamante para o servidor sem Wipe.', 'package', 6590, '/assets/pacotes-extreme-world.jpg', true, true, '{"package_bundle":true,"display_order":40,"benefits":["Pal nível S","7.000 Moedas de Cachorro","50.000 Moedas de Ouro","Armadura Plástico Leve + Lendária","Capacete Plástico","1.000 Cartuchos de Energia","Fuzil Laser Lendário","100 Esferas Supremas","Saco de Ração Colossal","Caixa de Acessórios Fantástica","Caixa de Acessórios Milagrosa","Escudo Ultra","Planador Terra","Módulo de Mira 2"]}'::jsonb)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  product_type = excluded.product_type,
  price_cents = excluded.price_cents,
  image_url = excluded.image_url,
  featured = excluded.featured,
  active = excluded.active,
  metadata = excluded.metadata,
  updated_at = now();
