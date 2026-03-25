create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create table if not exists private.cities (
  name text primary key,
  sort_order smallint not null unique
);

insert into private.cities (name, sort_order)
values
  ('Ostrava', 1),
  ('Praha (Prague)', 2),
  ('Brno', 3),
  ('Plzeň', 4),
  ('Olomouc', 5),
  ('Liberec', 6),
  ('České Budějovice', 7),
  ('Hradec Králové', 8),
  ('Pardubice', 9),
  ('Zlín', 10),
  ('Opava', 11),
  ('Frýdek-Místek', 12),
  ('Havířov', 13),
  ('Karviná', 14)
on conflict (name) do update
set
  sort_order = excluded.sort_order;

do $$
begin
  if exists (
    select 1
    from public.profiles profile_row
    where profile_row.city is not null
      and not exists (
        select 1
        from private.cities city_row
        where city_row.name = profile_row.city
      )
  ) then
    raise exception 'profiles.city contains values outside private.cities.';
  end if;

  if exists (
    select 1
    from public.venues venue_row
    where not exists (
      select 1
      from private.cities city_row
      where city_row.name = venue_row.city
    )
  ) then
    raise exception 'venues.city contains values outside private.cities.';
  end if;

  if exists (
    select 1
    from public.events event_row
    where not exists (
      select 1
      from private.cities city_row
      where city_row.name = event_row.city
    )
  ) then
    raise exception 'events.city contains values outside private.cities.';
  end if;

  if exists (
    select 1
    from public.player_availability availability_row
    where not exists (
      select 1
      from private.cities city_row
      where city_row.name = availability_row.city
    )
  ) then
    raise exception 'player_availability.city contains values outside private.cities.';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_city_curated_fk'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_city_curated_fk
      foreign key (city) references private.cities (name);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'venues_city_curated_fk'
      and conrelid = 'public.venues'::regclass
  ) then
    alter table public.venues
      add constraint venues_city_curated_fk
      foreign key (city) references private.cities (name);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'events_city_curated_fk'
      and conrelid = 'public.events'::regclass
  ) then
    alter table public.events
      add constraint events_city_curated_fk
      foreign key (city) references private.cities (name);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'player_availability_city_curated_fk'
      and conrelid = 'public.player_availability'::regclass
  ) then
    alter table public.player_availability
      add constraint player_availability_city_curated_fk
      foreign key (city) references private.cities (name);
  end if;
end;
$$;

create or replace function private.event_player_counts(target_event_id uuid)
returns table (spots_taken bigint, waitlist_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*) filter (where ep.status = 'confirmed')::bigint as spots_taken,
    count(*) filter (where ep.status = 'waitlisted')::bigint as waitlist_count
  from public.event_players ep
  where ep.event_id = target_event_id;
$$;

revoke all on function private.event_player_counts(uuid) from public;
revoke all on function private.event_player_counts(uuid) from anon;
revoke all on function private.event_player_counts(uuid) from authenticated;
revoke all on function private.event_player_counts(uuid) from service_role;

grant execute on function private.event_player_counts(uuid) to authenticated;
grant execute on function private.event_player_counts(uuid) to service_role;

create or replace view public.event_feed_view as
select
  e.id,
  e.sport_id,
  s.slug as sport_slug,
  s.name_cs as sport_name_cs,
  s.name_en as sport_name_en,
  s.icon_name as sport_icon,
  s.color_hex as sport_color,
  e.organizer_id,
  p.first_name as organizer_first_name,
  p.photo_url as organizer_photo_url,
  coalesce(us.no_shows, 0) as organizer_no_shows,
  coalesce(us.games_played, 0) as organizer_games_played,
  e.venue_id,
  v.name as venue_name,
  v.address as venue_address,
  e.starts_at,
  e.ends_at,
  e.city,
  e.reservation_type,
  e.player_count_total,
  e.skill_min,
  e.skill_max,
  e.description,
  e.status,
  coalesce(ep_counts.spots_taken, 0) as spots_taken,
  coalesce(ep_counts.waitlist_count, 0) as waitlist_count,
  e.created_at
from public.events e
join public.sports s on s.id = e.sport_id and s.is_active = true
join public.venues v on v.id = e.venue_id
join public.profiles p on p.id = e.organizer_id and p.is_deleted = false
left join public.user_sports us on us.user_id = e.organizer_id and us.sport_id = e.sport_id
left join lateral private.event_player_counts(e.id) as ep_counts on true
where e.status in ('active', 'full');

alter view public.event_feed_view set (security_invoker = true);

revoke all on public.event_feed_view from public;
revoke all on public.event_feed_view from anon;
revoke all on public.event_feed_view from authenticated;
revoke all on public.event_feed_view from service_role;

grant select on public.event_feed_view to authenticated;
grant select on public.event_feed_view to service_role;
