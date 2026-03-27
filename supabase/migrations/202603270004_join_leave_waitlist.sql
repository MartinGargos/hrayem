create or replace function private.current_waitlist_position(target_event_id uuid)
returns integer
language sql
security definer
stable
set search_path = ''
as $$
  select ranked.position::integer
  from (
    select
      ep.user_id,
      row_number() over (order by ep.joined_at asc, ep.id asc) as position
    from public.event_players as ep
    where ep.event_id = target_event_id
      and ep.status = 'waitlisted'
  ) as ranked
  where ranked.user_id = auth.uid()
$$;

revoke all on function private.current_waitlist_position(uuid) from public;
revoke all on function private.current_waitlist_position(uuid) from anon;
revoke all on function private.current_waitlist_position(uuid) from authenticated;
revoke all on function private.current_waitlist_position(uuid) from service_role;

grant execute on function private.current_waitlist_position(uuid) to authenticated;
grant execute on function private.current_waitlist_position(uuid) to service_role;

drop view if exists public.my_games_upcoming_view;
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
