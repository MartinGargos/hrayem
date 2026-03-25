create table public.events (
  id uuid primary key default gen_random_uuid(),
  sport_id uuid not null references public.sports (id),
  organizer_id uuid references public.profiles (id) on delete set null,
  venue_id uuid not null references public.venues (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  city text not null constraint events_city_curated_fk references private.cities (name),
  reservation_type text not null check (reservation_type in ('reserved', 'to_be_arranged')),
  player_count_total smallint not null check (player_count_total between 2 and 20),
  skill_min smallint not null check (skill_min between 1 and 4),
  skill_max smallint not null check (skill_max between 1 and 4),
  description text check (char_length(description) <= 500),
  status text not null default 'active' check (status in ('active', 'full', 'finished', 'cancelled')),
  reminder_sent boolean not null default false,
  no_show_window_end timestamptz,
  chat_closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint skill_range_valid check (skill_min <= skill_max),
  constraint event_duration_valid check (ends_at > starts_at)
);

alter table public.events enable row level security;

create table public.event_players (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  status text not null check (status in ('confirmed', 'waitlisted', 'removed')),
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, user_id)
);

alter table public.event_players enable row level security;
