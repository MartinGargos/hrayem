create or replace function public.create_event_atomic(
  p_sport_id uuid,
  p_organizer_id uuid,
  p_venue_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reservation_type text,
  p_player_count_total smallint,
  p_skill_min smallint,
  p_skill_max smallint,
  p_description text default null
)
returns public.events
language plpgsql
set search_path = ''
as $$
declare
  venue_city text;
  created_event public.events;
begin
  select v.city
  into venue_city
  from public.venues as v
  where v.id = p_venue_id;

  if venue_city is null then
    raise exception 'VENUE_NOT_FOUND';
  end if;

  insert into public.events (
    sport_id,
    organizer_id,
    venue_id,
    starts_at,
    ends_at,
    city,
    reservation_type,
    player_count_total,
    skill_min,
    skill_max,
    description
  )
  values (
    p_sport_id,
    p_organizer_id,
    p_venue_id,
    p_starts_at,
    p_ends_at,
    venue_city,
    p_reservation_type,
    p_player_count_total,
    p_skill_min,
    p_skill_max,
    nullif(p_description, '')
  )
  returning *
  into created_event;

  insert into public.event_players (
    event_id,
    user_id,
    status
  )
  values (
    created_event.id,
    p_organizer_id,
    'confirmed'
  );

  return created_event;
end;
$$;
