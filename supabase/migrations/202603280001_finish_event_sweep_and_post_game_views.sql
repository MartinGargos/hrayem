create extension if not exists pg_cron;

create or replace function public.finish_event_sweep()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  reminder_event public.events;
  finished_event public.events;
  reminder_count integer := 0;
  finished_count integer := 0;
  deleted_availability_count integer := 0;
  duration_hours numeric(8, 2);
begin
  for reminder_event in
    select *
    from public.events
    where status in ('active', 'full')
      and reminder_sent = false
      and starts_at >= now() + interval '1 hour 50 minutes'
      and starts_at <= now() + interval '2 hours 10 minutes'
    for update skip locked
  loop
    insert into public.notification_log (
      user_id,
      event_id,
      type,
      payload
    )
    select distinct
      participant.user_id,
      reminder_event.id,
      'event_reminder',
      jsonb_build_object(
        'event_id', reminder_event.id,
        'starts_at', reminder_event.starts_at
      )
    from (
      select reminder_event.organizer_id as user_id
      union all
      select ep.user_id
      from public.event_players as ep
      where ep.event_id = reminder_event.id
        and ep.status = 'confirmed'
    ) as participant
    where participant.user_id is not null;

    update public.events
    set
      reminder_sent = true,
      updated_at = now()
    where id = reminder_event.id;

    reminder_count := reminder_count + 1;
  end loop;

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

  return jsonb_build_object(
    'reminders_sent', reminder_count,
    'events_finished', finished_count,
    'availability_deleted', deleted_availability_count
  );
end;
$$;

drop view if exists public.my_games_past_view;
drop view if exists public.my_games_upcoming_view;
drop view if exists public.play_again_connections_view;
drop view if exists public.player_profile_sport_stats_view;
drop view if exists public.event_detail_view;

create view public.event_detail_view
with (security_invoker = true) as
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
  p.last_name as organizer_last_name,
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
  e.no_show_window_end,
  e.chat_closed_at,
  case
    when e.organizer_id = auth.uid() then 'organizer'
    when viewer_ep.status in ('confirmed', 'waitlisted') then viewer_ep.status
    else null
  end as viewer_membership_status,
  case
    when viewer_ep.status = 'waitlisted' then private.current_waitlist_position(e.id)
    else null
  end as viewer_waitlist_position,
  e.created_at
from public.events as e
join public.sports as s on s.id = e.sport_id and s.is_active = true
join public.venues as v on v.id = e.venue_id
left join public.profiles as p on p.id = e.organizer_id and p.is_deleted = false
left join public.user_sports as us on us.user_id = e.organizer_id and us.sport_id = e.sport_id
left join public.event_players as viewer_ep
  on viewer_ep.event_id = e.id
 and viewer_ep.user_id = auth.uid()
left join lateral private.event_player_counts(e.id) as ep_counts on true;

revoke all on public.event_detail_view from public;
revoke all on public.event_detail_view from anon;
revoke all on public.event_detail_view from authenticated;
revoke all on public.event_detail_view from service_role;

grant select on public.event_detail_view to authenticated;
grant select on public.event_detail_view to service_role;

create view public.my_games_upcoming_view
with (security_invoker = true) as
select
  ed.id,
  ed.sport_id,
  ed.sport_slug,
  ed.sport_name_cs,
  ed.sport_name_en,
  ed.sport_icon,
  ed.sport_color,
  ed.organizer_id,
  ed.organizer_first_name,
  ed.organizer_photo_url,
  ed.organizer_no_shows,
  ed.organizer_games_played,
  ed.venue_id,
  ed.venue_name,
  ed.venue_address,
  ed.starts_at,
  ed.ends_at,
  ed.city,
  ed.reservation_type,
  ed.player_count_total,
  ed.skill_min,
  ed.skill_max,
  ed.description,
  ed.status,
  ed.spots_taken,
  ed.waitlist_count,
  ed.viewer_membership_status,
  ed.created_at
from public.event_detail_view as ed
where ed.starts_at > now()
  and ed.status in ('active', 'full')
  and ed.viewer_membership_status in ('organizer', 'confirmed')
order by ed.starts_at asc, ed.created_at asc;

revoke all on public.my_games_upcoming_view from public;
revoke all on public.my_games_upcoming_view from anon;
revoke all on public.my_games_upcoming_view from authenticated;
revoke all on public.my_games_upcoming_view from service_role;

grant select on public.my_games_upcoming_view to authenticated;
grant select on public.my_games_upcoming_view to service_role;

create view public.my_games_past_view
with (security_invoker = true) as
select
  ed.id,
  ed.sport_id,
  ed.sport_slug,
  ed.sport_name_cs,
  ed.sport_name_en,
  ed.sport_icon,
  ed.sport_color,
  ed.organizer_id,
  ed.organizer_first_name,
  ed.organizer_photo_url,
  ed.organizer_no_shows,
  ed.organizer_games_played,
  ed.venue_id,
  ed.venue_name,
  ed.venue_address,
  ed.starts_at,
  ed.ends_at,
  ed.city,
  ed.reservation_type,
  ed.player_count_total,
  ed.skill_min,
  ed.skill_max,
  ed.description,
  ed.status,
  ed.spots_taken,
  ed.waitlist_count,
  ed.no_show_window_end,
  ed.chat_closed_at,
  ed.viewer_membership_status,
  ed.created_at
from public.event_detail_view as ed
where ed.status = 'finished'
  and ed.viewer_membership_status in ('organizer', 'confirmed')
order by ed.ends_at desc, ed.created_at desc;

revoke all on public.my_games_past_view from public;
revoke all on public.my_games_past_view from anon;
revoke all on public.my_games_past_view from authenticated;
revoke all on public.my_games_past_view from service_role;

grant select on public.my_games_past_view to authenticated;
grant select on public.my_games_past_view to service_role;

create view public.player_profile_sport_stats_view
with (security_invoker = true) as
with received_thumbs as (
  select
    t.to_user as user_id,
    t.sport_id,
    count(distinct t.event_id)::integer as thumbs_up_games
  from public.post_game_thumbs as t
  where t.to_user is not null
  group by t.to_user, t.sport_id
)
select
  us.user_id,
  p.first_name,
  p.last_name,
  p.photo_url,
  p.city,
  us.sport_id,
  s.slug as sport_slug,
  s.name_cs as sport_name_cs,
  s.name_en as sport_name_en,
  s.icon_name as sport_icon,
  s.color_hex as sport_color,
  us.skill_level,
  us.games_played,
  us.hours_played,
  us.no_shows,
  coalesce(rt.thumbs_up_games, 0) as thumbs_up_games,
  case
    when us.games_played >= 3 then round(
      (coalesce(rt.thumbs_up_games, 0)::numeric / us.games_played::numeric) * 100,
      0
    )::integer
    else null
  end as thumbs_up_percentage,
  exists (
    select 1
    from public.post_game_thumbs as t1
    join public.post_game_thumbs as t2
      on t1.from_user = t2.to_user
     and t1.to_user = t2.from_user
     and t1.sport_id = t2.sport_id
    where t1.from_user = auth.uid()
      and t1.to_user = us.user_id
      and t1.sport_id = us.sport_id
  ) as is_play_again_connection
from public.user_sports as us
join public.profiles as p on p.id = us.user_id and p.is_deleted = false
join public.sports as s on s.id = us.sport_id and s.is_active = true
left join received_thumbs as rt
  on rt.user_id = us.user_id
 and rt.sport_id = us.sport_id;

revoke all on public.player_profile_sport_stats_view from public;
revoke all on public.player_profile_sport_stats_view from anon;
revoke all on public.player_profile_sport_stats_view from authenticated;
revoke all on public.player_profile_sport_stats_view from service_role;

grant select on public.player_profile_sport_stats_view to authenticated;
grant select on public.player_profile_sport_stats_view to service_role;

create view public.play_again_connections_view
with (security_invoker = true) as
with received_thumbs as (
  select
    t.to_user as user_id,
    t.sport_id,
    count(distinct t.event_id)::integer as thumbs_up_games
  from public.post_game_thumbs as t
  where t.to_user is not null
  group by t.to_user, t.sport_id
)
select distinct on (t1.to_user, t1.sport_id)
  t1.to_user as connection_user_id,
  p.first_name,
  p.last_name,
  p.photo_url,
  p.city,
  us.sport_id,
  s.slug as sport_slug,
  s.name_cs as sport_name_cs,
  s.name_en as sport_name_en,
  s.icon_name as sport_icon,
  s.color_hex as sport_color,
  us.skill_level,
  us.games_played,
  us.hours_played,
  us.no_shows,
  case
    when us.games_played >= 3 then round(
      (coalesce(rt.thumbs_up_games, 0)::numeric / us.games_played::numeric) * 100,
      0
    )::integer
    else null
  end as thumbs_up_percentage
from public.post_game_thumbs as t1
join public.post_game_thumbs as t2
  on t1.from_user = t2.to_user
 and t1.to_user = t2.from_user
 and t1.sport_id = t2.sport_id
join public.profiles as p on p.id = t1.to_user and p.is_deleted = false
join public.user_sports as us on us.user_id = t1.to_user and us.sport_id = t1.sport_id
join public.sports as s on s.id = t1.sport_id and s.is_active = true
left join received_thumbs as rt
  on rt.user_id = us.user_id
 and rt.sport_id = us.sport_id
where t1.from_user = auth.uid()
  and t1.to_user is not null
order by t1.to_user, t1.sport_id, p.first_name nulls last, p.last_name nulls last;

revoke all on public.play_again_connections_view from public;
revoke all on public.play_again_connections_view from anon;
revoke all on public.play_again_connections_view from authenticated;
revoke all on public.play_again_connections_view from service_role;

grant select on public.play_again_connections_view to authenticated;
grant select on public.play_again_connections_view to service_role;
