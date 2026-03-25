alter table public.profiles enable row level security;
alter table public.device_tokens enable row level security;
alter table public.sports enable row level security;
alter table public.venues enable row level security;
alter table public.user_sports enable row level security;
alter table public.events enable row level security;
alter table public.event_players enable row level security;
alter table public.chat_messages enable row level security;
alter table public.no_show_reports enable row level security;
alter table public.post_game_thumbs enable row level security;
alter table public.player_availability enable row level security;
alter table public.notification_log enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.reports enable row level security;
alter table public.app_config enable row level security;
alter table public.consent_log enable row level security;

create policy profiles_select_authenticated on public.profiles
  for select
  to authenticated
  using (is_deleted = false);

create policy profiles_update_own on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and is_deleted = (
      select current_row.is_deleted
      from public.profiles as current_row
      where current_row.id = profiles.id
    )
    and profile_complete = (
      select current_row.profile_complete
      from public.profiles as current_row
      where current_row.id = profiles.id
    )
  );

create policy device_tokens_select_own on public.device_tokens
  for select
  to authenticated
  using (user_id = auth.uid());

create policy device_tokens_insert_own on public.device_tokens
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy device_tokens_update_own on public.device_tokens
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy device_tokens_delete_own on public.device_tokens
  for delete
  to authenticated
  using (user_id = auth.uid());

create policy sports_select_active on public.sports
  for select
  to authenticated
  using (is_active = true);

create policy venues_select_authenticated on public.venues
  for select
  to authenticated
  using (true);

create policy venues_insert_authenticated on public.venues
  for insert
  to authenticated
  with check (true);

create policy user_sports_select_authenticated on public.user_sports
  for select
  to authenticated
  using (true);

create policy user_sports_insert_own on public.user_sports
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and games_played = 0
    and hours_played = 0
    and no_shows = 0
  );

create policy user_sports_update_own_skill on public.user_sports
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and games_played = (
      select current_row.games_played
      from public.user_sports as current_row
      where current_row.id = user_sports.id
    )
    and hours_played = (
      select current_row.hours_played
      from public.user_sports as current_row
      where current_row.id = user_sports.id
    )
    and no_shows = (
      select current_row.no_shows
      from public.user_sports as current_row
      where current_row.id = user_sports.id
    )
  );

create policy events_select_authenticated on public.events
  for select
  to authenticated
  using (true);

create policy event_players_select_visible on public.event_players
  for select
  to authenticated
  using (
    status = 'confirmed'
    or user_id = auth.uid()
    or exists (
      select 1
      from public.events e
      where e.id = event_players.event_id
        and e.organizer_id = auth.uid()
    )
  );

create policy chat_messages_select_participants on public.chat_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.events e
      where e.id = chat_messages.event_id
        and e.organizer_id = auth.uid()
    )
    or exists (
      select 1
      from public.event_players ep
      where ep.event_id = chat_messages.event_id
        and ep.user_id = auth.uid()
        and ep.status = 'confirmed'
    )
  );

create policy no_show_reports_select_organizer on public.no_show_reports
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.events e
      where e.id = no_show_reports.event_id
        and e.organizer_id = auth.uid()
    )
  );

create policy post_game_thumbs_select_authenticated on public.post_game_thumbs
  for select
  to authenticated
  using (true);

create policy player_availability_select_authenticated on public.player_availability
  for select
  to authenticated
  using (true);

create policy player_availability_insert_own on public.player_availability
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy player_availability_update_own on public.player_availability
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy player_availability_delete_own on public.player_availability
  for delete
  to authenticated
  using (user_id = auth.uid());

create policy notification_log_select_own on public.notification_log
  for select
  to authenticated
  using (user_id = auth.uid());

create policy notification_preferences_select_own on public.notification_preferences
  for select
  to authenticated
  using (user_id = auth.uid());

create policy notification_preferences_insert_own on public.notification_preferences
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy notification_preferences_update_own on public.notification_preferences
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy notification_preferences_delete_own on public.notification_preferences
  for delete
  to authenticated
  using (user_id = auth.uid());

create policy reports_select_own on public.reports
  for select
  to authenticated
  using (reporter_id = auth.uid());

create policy app_config_select_authenticated on public.app_config
  for select
  to authenticated
  using (true);

create policy consent_log_select_own on public.consent_log
  for select
  to authenticated
  using (user_id = auth.uid());

create policy consent_log_insert_own on public.consent_log
  for insert
  to authenticated
  with check (user_id = auth.uid());

grant select on public.event_feed_view to authenticated;
grant select on public.event_feed_view to service_role;
