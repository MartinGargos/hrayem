create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger trg_events_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

create trigger trg_user_sports_updated_at
  before update on public.user_sports
  for each row execute function public.set_updated_at();

create trigger trg_event_players_updated_at
  before update on public.event_players
  for each row execute function public.set_updated_at();

create trigger trg_device_tokens_updated_at
  before update on public.device_tokens
  for each row execute function public.set_updated_at();

create trigger trg_notification_preferences_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

create trigger trg_venues_updated_at
  before update on public.venues
  for each row execute function public.set_updated_at();

create trigger trg_app_config_updated_at
  before update on public.app_config
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, language)
  values (new.id, 'cs');
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_create_profile
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.check_profile_complete()
returns trigger as $$
begin
  new.profile_complete := (
    new.first_name is not null
    and new.last_name is not null
    and new.city is not null
  );
  return new;
end;
$$ language plpgsql;

create trigger trg_check_profile_complete
  before update on public.profiles
  for each row execute function public.check_profile_complete();

create or replace function public.handle_no_show_report()
returns trigger as $$
begin
  insert into public.user_sports (user_id, sport_id, skill_level, no_shows)
  values (new.reported_user, new.sport_id, 1, 1)
  on conflict (user_id, sport_id)
  do update set
    no_shows = public.user_sports.no_shows + 1,
    updated_at = now();
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_no_show_report
  after insert on public.no_show_reports
  for each row execute function public.handle_no_show_report();
