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
  e.created_at
from public.events e
join public.sports s on s.id = e.sport_id and s.is_active = true
join public.venues v on v.id = e.venue_id
left join public.profiles p on p.id = e.organizer_id and p.is_deleted = false
left join public.user_sports us on us.user_id = e.organizer_id and us.sport_id = e.sport_id
left join lateral private.event_player_counts(e.id) as ep_counts on true;

revoke all on public.event_detail_view from public;
revoke all on public.event_detail_view from anon;
revoke all on public.event_detail_view from authenticated;
revoke all on public.event_detail_view from service_role;

grant select on public.event_detail_view to authenticated;
grant select on public.event_detail_view to service_role;

alter policy venues_insert_authenticated on public.venues
  with check (created_by = auth.uid());
