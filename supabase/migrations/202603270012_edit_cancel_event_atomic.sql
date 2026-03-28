create or replace function public.update_event_atomic(
  p_event_id uuid,
  p_actor_user_id uuid,
  p_venue_id uuid default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_reservation_type text default null,
  p_player_count_total smallint default null,
  p_skill_min smallint default null,
  p_skill_max smallint default null,
  p_description text default null,
  p_description_is_set boolean default false
)
returns public.events
language plpgsql
set search_path = ''
as $$
declare
  locked_event public.events;
  updated_event public.events;
  confirmed_count integer;
  next_venue_id uuid;
  next_city text;
  next_starts_at timestamptz;
  next_ends_at timestamptz;
  next_reservation_type text;
  next_player_count_total smallint;
  next_skill_min smallint;
  next_skill_max smallint;
  next_description text;
  next_status text;
begin
  select *
  into locked_event
  from public.events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'EVENT_NOT_FOUND';
  end if;

  if locked_event.organizer_id is distinct from p_actor_user_id then
    raise exception 'FORBIDDEN';
  end if;

  if locked_event.status not in ('active', 'full') or locked_event.starts_at <= now() then
    raise exception 'EVENT_NOT_EDITABLE';
  end if;

  next_venue_id := coalesce(p_venue_id, locked_event.venue_id);

  select v.city
  into next_city
  from public.venues as v
  where v.id = next_venue_id;

  if next_city is null then
    raise exception 'VENUE_NOT_FOUND';
  end if;

  next_starts_at := coalesce(p_starts_at, locked_event.starts_at);
  next_ends_at := coalesce(p_ends_at, locked_event.ends_at);
  next_reservation_type := coalesce(p_reservation_type, locked_event.reservation_type);
  next_player_count_total := coalesce(p_player_count_total, locked_event.player_count_total);
  next_skill_min := coalesce(p_skill_min, locked_event.skill_min);
  next_skill_max := coalesce(p_skill_max, locked_event.skill_max);
  next_description := case
    when p_description_is_set then nullif(p_description, '')
    else locked_event.description
  end;

  if next_reservation_type not in ('reserved', 'to_be_arranged') then
    raise exception 'VALIDATION_ERROR: reservation_type';
  end if;

  if next_player_count_total < 2 or next_player_count_total > 20 then
    raise exception 'VALIDATION_ERROR: player_count_total';
  end if;

  if next_skill_min < 1 or next_skill_min > 4 or next_skill_max < 1 or next_skill_max > 4 then
    raise exception 'INVALID_SKILL_LEVEL';
  end if;

  if next_skill_min > next_skill_max then
    raise exception 'VALIDATION_ERROR: skill_range';
  end if;

  if next_ends_at <= next_starts_at then
    raise exception 'VALIDATION_ERROR: ends_at';
  end if;

  if next_starts_at <= now() then
    raise exception 'VALIDATION_ERROR: starts_at';
  end if;

  if next_description is not null and char_length(next_description) > 500 then
    raise exception 'VALIDATION_ERROR: description';
  end if;

  select count(*)::integer
  into confirmed_count
  from public.event_players as ep
  where ep.event_id = p_event_id
    and ep.status = 'confirmed';

  if next_player_count_total < confirmed_count then
    raise exception 'PLAYER_COUNT_TOO_LOW';
  end if;

  next_status := case
    when confirmed_count >= next_player_count_total then 'full'
    else 'active'
  end;

  update public.events
  set
    venue_id = next_venue_id,
    city = next_city,
    starts_at = next_starts_at,
    ends_at = next_ends_at,
    reservation_type = next_reservation_type,
    player_count_total = next_player_count_total,
    skill_min = next_skill_min,
    skill_max = next_skill_max,
    description = next_description,
    status = next_status,
    updated_at = now()
  where id = p_event_id
  returning *
  into updated_event;

  return updated_event;
end;
$$;
