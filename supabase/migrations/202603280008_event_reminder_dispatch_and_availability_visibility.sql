create extension if not exists pg_net;

create table if not exists private.runtime_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

revoke all on table private.runtime_config from public;
revoke all on table private.runtime_config from anon;
revoke all on table private.runtime_config from authenticated;
revoke all on table private.runtime_config from service_role;

create or replace function public.claim_due_event_reminders(p_limit integer default 100)
returns table (
  event_id uuid,
  organizer_id uuid,
  sport_name_en text,
  venue_name text,
  starts_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
begin
  return query
  with due_events as (
    select
      e.id,
      e.organizer_id,
      e.sport_id,
      e.venue_id,
      e.starts_at
    from public.events as e
    where e.status in ('active', 'full')
      and e.reminder_sent = false
      and e.starts_at >= now() + interval '1 hour 50 minutes'
      and e.starts_at <= now() + interval '2 hours 10 minutes'
    order by e.starts_at asc, e.created_at asc
    limit normalized_limit
    for update skip locked
  ),
  claimed_events as (
    update public.events as e
    set
      reminder_sent = true,
      updated_at = now()
    from due_events
    where e.id = due_events.id
    returning
      e.id,
      e.organizer_id,
      e.sport_id,
      e.venue_id,
      e.starts_at
  )
  select
    claimed_events.id as event_id,
    claimed_events.organizer_id,
    s.name_en as sport_name_en,
    v.name as venue_name,
    claimed_events.starts_at
  from claimed_events
  join public.sports as s on s.id = claimed_events.sport_id
  join public.venues as v on v.id = claimed_events.venue_id
  order by claimed_events.starts_at asc, claimed_events.id asc;
end;
$$;

revoke all on function public.claim_due_event_reminders(integer) from public;
revoke all on function public.claim_due_event_reminders(integer) from anon;
revoke all on function public.claim_due_event_reminders(integer) from authenticated;
revoke all on function public.claim_due_event_reminders(integer) from service_role;

grant execute on function public.claim_due_event_reminders(integer) to service_role;

create or replace function private.invoke_event_reminder_dispatch()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  dispatch_url text;
  dispatch_secret text;
begin
  select rc.value
  into dispatch_url
  from private.runtime_config as rc
  where rc.key = 'event_reminder_dispatch_url';

  select rc.value
  into dispatch_secret
  from private.runtime_config as rc
  where rc.key = 'event_reminder_dispatch_secret';

  if dispatch_url is null or dispatch_secret is null then
    raise exception 'Event reminder dispatch runtime config is missing.';
  end if;

  perform net.http_post(
    url := dispatch_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', dispatch_secret
    ),
    body := jsonb_build_object('source', 'finish_event_sweep')
  );
end;
$$;

revoke all on function private.invoke_event_reminder_dispatch() from public;
revoke all on function private.invoke_event_reminder_dispatch() from anon;
revoke all on function private.invoke_event_reminder_dispatch() from authenticated;
revoke all on function private.invoke_event_reminder_dispatch() from service_role;

create or replace function public.finish_event_sweep()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  finished_event public.events;
  reminder_count integer := 0;
  finished_count integer := 0;
  deleted_availability_count integer := 0;
  duration_hours numeric(8, 2);
begin
  select count(*)
  into reminder_count
  from public.events
  where status in ('active', 'full')
    and reminder_sent = false
    and starts_at >= now() + interval '1 hour 50 minutes'
    and starts_at <= now() + interval '2 hours 10 minutes';

  for finished_event in
    select *
    from public.events
    where status in ('active', 'full')
      and ends_at < now()
    for update skip locked
  loop
    update public.events
    set
      status = 'finished',
      no_show_window_end = finished_event.ends_at + interval '24 hours',
      chat_closed_at = finished_event.ends_at + interval '48 hours',
      updated_at = now()
    where id = finished_event.id;

    duration_hours := round(
      (extract(epoch from (finished_event.ends_at - finished_event.starts_at)) / 3600.0)::numeric,
      2
    );

    insert into public.user_sports (
      user_id,
      sport_id,
      skill_level,
      games_played,
      hours_played,
      no_shows
    )
    select
      participant.user_id,
      finished_event.sport_id,
      coalesce(existing_skill.skill_level, 1),
      1,
      duration_hours,
      0
    from (
      select distinct candidate.user_id
      from (
        select finished_event.organizer_id as user_id
        union all
        select ep.user_id
        from public.event_players as ep
        where ep.event_id = finished_event.id
          and ep.status = 'confirmed'
      ) as candidate
      where candidate.user_id is not null
    ) as participant
    left join public.user_sports as existing_skill
      on existing_skill.user_id = participant.user_id
     and existing_skill.sport_id = finished_event.sport_id
    on conflict (user_id, sport_id)
    do update set
      games_played = public.user_sports.games_played + 1,
      hours_played = public.user_sports.hours_played + excluded.hours_played,
      updated_at = now();

    finished_count := finished_count + 1;
  end loop;

  delete from public.player_availability
  where available_date < current_date;

  get diagnostics deleted_availability_count = row_count;

  if reminder_count > 0 then
    begin
      perform private.invoke_event_reminder_dispatch();
    exception
      when others then
        raise notice 'Event reminder dispatch failed: %', sqlerrm;
    end;
  end if;

  return jsonb_build_object(
    'reminders_sent', reminder_count,
    'events_finished', finished_count,
    'availability_deleted', deleted_availability_count
  );
end;
$$;
