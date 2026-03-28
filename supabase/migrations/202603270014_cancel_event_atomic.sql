create or replace function public.cancel_event_atomic(
  p_event_id uuid,
  p_actor_user_id uuid
)
returns public.events
language plpgsql
set search_path = ''
as $$
declare
  locked_event public.events;
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

  if locked_event.status in ('finished', 'cancelled') then
    raise exception 'EVENT_NOT_CANCELLABLE';
  end if;

  update public.events
  set
    status = 'cancelled',
    chat_closed_at = now(),
    updated_at = now()
  where id = p_event_id
  returning *
  into locked_event;

  insert into public.notification_log (
    user_id,
    event_id,
    type,
    payload
  )
  select
    ep.user_id,
    p_event_id,
    'event_cancelled',
    jsonb_build_object(
      'event_id', p_event_id
    )
  from public.event_players as ep
  where ep.event_id = p_event_id
    and ep.status in ('confirmed', 'waitlisted')
    and ep.user_id is not null
    and ep.user_id <> p_actor_user_id;

  return locked_event;
end;
$$;
