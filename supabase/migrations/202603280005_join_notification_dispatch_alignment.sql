create or replace function public.join_event_atomic(
  p_event_id uuid,
  p_user_id uuid,
  p_skill_level smallint default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  locked_event public.events;
  existing_player public.event_players;
  resulting_player public.event_players;
  current_user_sport public.user_sports;
  resulting_counts record;
  previous_event_status text;
  desired_event_status text;
  resulting_waitlist_position integer;
  event_became_full boolean := false;
begin
  if p_skill_level is not null and (p_skill_level < 1 or p_skill_level > 4) then
    raise exception 'INVALID_SKILL_LEVEL';
  end if;

  select *
  into locked_event
  from public.events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'EVENT_NOT_FOUND';
  end if;

  if locked_event.starts_at <= now() then
    raise exception 'EVENT_ALREADY_STARTED';
  end if;

  if locked_event.status not in ('active', 'full') then
    raise exception 'EVENT_NOT_JOINABLE';
  end if;

  if locked_event.organizer_id = p_user_id then
    raise exception 'ORGANIZER_CANNOT_JOIN';
  end if;

  select *
  into current_user_sport
  from public.user_sports
  where user_id = p_user_id
    and sport_id = locked_event.sport_id
  limit 1;

  if current_user_sport.id is null then
    if p_skill_level is null then
      raise exception 'SKILL_LEVEL_REQUIRED';
    end if;

    insert into public.user_sports (
      user_id,
      sport_id,
      skill_level
    )
    values (
      p_user_id,
      locked_event.sport_id,
      p_skill_level
    )
    on conflict (user_id, sport_id)
    do update set
      skill_level = excluded.skill_level
    returning *
    into current_user_sport;
  end if;

  select *
  into existing_player
  from public.event_players
  where event_id = p_event_id
    and user_id = p_user_id
  limit 1;

  if existing_player.id is not null and existing_player.status in ('confirmed', 'waitlisted') then
    raise exception 'ALREADY_JOINED';
  end if;

  insert into public.event_players (
    event_id,
    user_id,
    status
  )
  values (
    p_event_id,
    p_user_id,
    case
      when (
        select count(*)
        from public.event_players as ep
        where ep.event_id = p_event_id
          and ep.status = 'confirmed'
      ) < locked_event.player_count_total then 'confirmed'
      else 'waitlisted'
    end
  )
  on conflict (event_id, user_id)
  do update set
    status = excluded.status,
    updated_at = now()
  returning *
  into resulting_player;

  if resulting_player.status = 'waitlisted' then
    select ranked.position::integer
    into resulting_waitlist_position
    from (
      select
        ep.user_id,
        row_number() over (order by ep.joined_at asc, ep.id asc) as position
      from public.event_players as ep
      where ep.event_id = p_event_id
        and ep.status = 'waitlisted'
    ) as ranked
    where ranked.user_id = p_user_id;
  else
    resulting_waitlist_position := null;
  end if;

  select *
  into resulting_counts
  from private.event_player_counts(p_event_id);

  previous_event_status := locked_event.status;
  desired_event_status := case
    when coalesce(resulting_counts.spots_taken, 0) >= locked_event.player_count_total then 'full'
    else 'active'
  end;

  update public.events
  set
    status = desired_event_status,
    updated_at = now()
  where id = p_event_id
  returning *
  into locked_event;

  event_became_full := previous_event_status <> 'full' and locked_event.status = 'full';

  return jsonb_build_object(
    'event_id', p_event_id,
    'membership_status', resulting_player.status,
    'waitlist_position', resulting_waitlist_position,
    'event_status', locked_event.status,
    'spots_taken', coalesce(resulting_counts.spots_taken, 0),
    'waitlist_count', coalesce(resulting_counts.waitlist_count, 0),
    'event_became_full', event_became_full
  );
end;
$$;
