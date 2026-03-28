create or replace function public.report_no_show_atomic(
  p_event_id uuid,
  p_actor_user_id uuid,
  p_reported_user_id uuid
)
returns public.no_show_reports
language plpgsql
set search_path = ''
as $$
declare
  locked_event public.events;
  target_player public.event_players;
  confirmed_non_organizer_count integer;
  created_report public.no_show_reports;
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

  if locked_event.status <> 'finished'
     or locked_event.no_show_window_end is null
     or now() >= locked_event.no_show_window_end then
    raise exception 'NO_SHOW_NOT_ALLOWED';
  end if;

  if p_reported_user_id is null or p_reported_user_id = locked_event.organizer_id then
    raise exception 'FORBIDDEN';
  end if;

  select *
  into target_player
  from public.event_players as ep
  where ep.event_id = p_event_id
    and ep.user_id = p_reported_user_id
    and ep.status = 'confirmed'
  limit 1;

  if not found then
    raise exception 'PLAYER_NOT_IN_EVENT';
  end if;

  select count(*)::integer
  into confirmed_non_organizer_count
  from public.event_players as ep
  where ep.event_id = p_event_id
    and ep.status = 'confirmed'
    and ep.user_id is not null
    and ep.user_id <> locked_event.organizer_id;

  if confirmed_non_organizer_count < 2 then
    raise exception 'NO_SHOW_NOT_ALLOWED';
  end if;

  begin
    insert into public.no_show_reports (
      event_id,
      reported_user,
      reported_by,
      sport_id
    )
    values (
      p_event_id,
      p_reported_user_id,
      p_actor_user_id,
      locked_event.sport_id
    )
    returning *
    into created_report;
  exception
    when unique_violation then
      raise exception 'ALREADY_REPORTED';
  end;

  return created_report;
end;
$$;
