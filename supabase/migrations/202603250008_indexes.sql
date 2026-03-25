create index idx_events_feed on public.events (city, sport_id, status, starts_at)
  where status in ('active', 'full');

create index idx_events_finish on public.events (ends_at, status)
  where status in ('active', 'full');

create index idx_events_remind on public.events (starts_at, status, reminder_sent)
  where status in ('active', 'full') and reminder_sent = false;

create index idx_event_players_waitlist on public.event_players (event_id, joined_at)
  where status = 'waitlisted';

create index idx_event_players_confirmed on public.event_players (event_id, user_id)
  where status = 'confirmed';

create index idx_chat_messages_event on public.chat_messages (event_id, sent_at)
  where is_deleted = false;

create index idx_user_sports_lookup on public.user_sports (user_id, sport_id);

create index idx_device_tokens_user on public.device_tokens (user_id);

create index idx_reports_status on public.reports (status, created_at)
  where status = 'pending';

create index idx_venues_city_name on public.venues (city, name);

create index idx_thumbs_to_user on public.post_game_thumbs (to_user, sport_id);
create index idx_thumbs_from_user on public.post_game_thumbs (from_user, to_user, sport_id);

create index idx_availability_feed on public.player_availability (city, sport_id, available_date);

create index idx_availability_date on public.player_availability (available_date);
