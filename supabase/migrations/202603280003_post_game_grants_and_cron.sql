create or replace function public.give_thumbs_up_atomic(
  p_event_id uuid,
  p_from_user_id uuid,
  p_to_user_id uuid
)
returns public.post_game_thumbs
language plpgsql
set search_path = ''
as $$
declare
  locked_event public.events;
  caller_player public.event_players;
  target_player public.event_players;
  created_thumbs public.post_game_thumbs;
begin
  select *
  into locked_event
  from public.events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'EVENT_NOT_FOUND';
  end if;

  if locked_event.status <> 'finished'
     or locked_event.chat_closed_at is null
     or now() >= locked_event.chat_closed_at then
    raise exception 'THUMBS_UP_NOT_ALLOWED';
  end if;

  if p_to_user_id is null or p_to_user_id = p_from_user_id then
    raise exception 'FORBIDDEN';
  end if;

  select *
  into caller_player
  from public.event_players as ep
  where ep.event_id = p_event_id
    and ep.user_id = p_from_user_id
    and ep.status = 'confirmed'
  limit 1;

  if not found then
    raise exception 'FORBIDDEN';
  end if;

  select *
  into target_player
  from public.event_players as ep
  where ep.event_id = p_event_id
    and ep.user_id = p_to_user_id
    and ep.status = 'confirmed'
  limit 1;

  if not found then
    raise exception 'PLAYER_NOT_IN_EVENT';
  end if;

  begin
    insert into public.post_game_thumbs (
      event_id,
      from_user,
      to_user,
      sport_id
    )
    values (
      p_event_id,
      p_from_user_id,
      p_to_user_id,
      locked_event.sport_id
    )
    returning *
    into created_thumbs;
  exception
    when unique_violation then
      raise exception 'ALREADY_THUMBED_UP';
  end;

  return created_thumbs;
end;
$$;
