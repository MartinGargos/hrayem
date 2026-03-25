insert into public.sports (slug, name_cs, name_en, icon_name, color_hex, sort_order)
values
  ('badminton', 'Badminton', 'Badminton', 'sport-badminton', '#4CAF50', 1),
  ('padel', 'Padel', 'Padel', 'sport-padel', '#2196F3', 2),
  ('squash', 'Squash', 'Squash', 'sport-squash', '#FF5722', 3)
on conflict (slug) do update
set
  name_cs = excluded.name_cs,
  name_en = excluded.name_en,
  icon_name = excluded.icon_name,
  color_hex = excluded.color_hex,
  sort_order = excluded.sort_order,
  is_active = true;

insert into public.app_config (key, value)
values
  ('minimum_app_version_ios', '1.0.0'),
  ('minimum_app_version_android', '1.0.0')
on conflict (key) do update
set
  value = excluded.value,
  updated_at = now();

insert into public.venues (name, city, address)
select
  seed.name,
  seed.city,
  seed.address
from (
  values
    ('Padel Club Ostrava - Varenska', 'Ostrava', 'Varenska 3098/40A, 702 00 Ostrava'),
    ('Padel Club Ostrava - Trojhali Karolina', 'Ostrava', 'K Trojhali, 702 00 Ostrava'),
    ('Sportovni centrum Fajne', 'Ostrava', 'Generala Sochora 6228/12, 708 00 Ostrava-Poruba'),
    ('CDU Sport', 'Ostrava', 'Charvatska 734/10, 700 30 Ostrava-Vyskovice'),
    ('Relax 365', 'Ostrava', 'Pustkovecka 4492/29F, 708 00 Ostrava-Poruba'),
    ('Ridera Sport', 'Ostrava', 'Zavodni 2885/86, 703 00 Ostrava-Vitkovice'),
    ('Squash Centrum Ostrava - Marianske Hory', 'Ostrava', '28. rijna 2663/150, 702 00 Ostrava')
) as seed(name, city, address)
where not exists (
  select 1
  from public.venues existing
  where existing.name = seed.name
    and existing.city = seed.city
    and coalesce(existing.address, '') = seed.address
);
