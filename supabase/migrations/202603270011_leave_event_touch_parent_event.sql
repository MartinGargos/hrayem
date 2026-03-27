create or replace function public.leave_event_atomic(
  p_event_id uuid,
  p_actor_user_id uuid,
  p_target_user_id uuid default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  locked_event public.events;
  target_player public.event_players;
  promoted_player public.event_players;
  resulting_counts record;
  previous_event_status text;
  desired_event_status text;
  resolved_target_user_id uuid;
begin
  resolved_target_user_id := coalesce(p_target_user_id, p_actor_user_id);

  select *
  into locked_event
  from public.events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'EVENT_NOT_FOUND';
  end if;

  if locked_event.status not in ('active', 'full') or locked_event.starts_at <= now() then
    raise exception 'EVENT_NOT_LEAVABLE';
  end if;

  if p_actor_user_id <> resolved_target_user_id and locked_event.organizer_id <> p_actor_user_id then
    raise exception 'FORBIDDEN';
  end if;

  if resolved_target_user_id = locked_event.organizer_id then
    raise exception 'ORGANIZER_CANNOT_LEAVE';
  end if;

  select *
  into target_player
  from public.event_players
  where event_id = p_event_id
    and user_id = resolved_target_user_id
  limit 1;

  if target_player.id is null or target_player.status = 'removed' then
    raise exception 'PLAYER_NOT_IN_EVENT';
  end if;

  update public.event_players
  set
    status = 'removed',
    updated_at = now()
  where id = target_player.id;

  if target_player.status = 'confirmed' then
    select *
    into promoted_player
    from public.event_players
    where event_id = p_event_id
      and status = 'waitlisted'
    order by joined_at asc, id asc
    limit 1
    for update;

    if promoted_player.id is not null then
      update public.event_players
      set
        status = 'confirmed',
        updated_at = now()
      where id = promoted_player.id
      returning *
      into promoted_player;

      insert into public.notification_log (
        user_id,
        event_id,
        type,
        payload
      )
      values (
        promoted_player.user_id,
        p_event_id,
        'waitlist_promoted',
        jsonb_build_object(
          'event_id', p_event_id
        )
      );
    end if;
  end if;

  if p_actor_user_id <> resolved_target_user_id then
    insert into public.notification_log (
      user_id,
      event_id,
      type,
      payload
    )
    values (
      resolved_target_user_id,
      p_event_id,
      'player_removed',
      jsonb_build_object(
        'event_id', p_event_id
      )
    );
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

  return jsonb_build_object(
    'event_id', p_event_id,
    'membership_status', null,
    'waitlist_position', null,
    'event_status', locked_event.status,
    'spots_taken', coalesce(resulting_counts.spots_taken, 0),
    'waitlist_count', coalesce(resulting_counts.waitlist_count, 0),
    'promoted_user_id', promoted_player.user_id
  );
end;
$$;
