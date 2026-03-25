create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(body) between 1 and 1000),
  sent_at timestamptz not null default now(),
  is_deleted boolean not null default false
);

alter table public.chat_messages enable row level security;

create table public.no_show_reports (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  reported_user uuid references public.profiles (id) on delete set null,
  reported_by uuid references public.profiles (id) on delete set null,
  sport_id uuid not null references public.sports (id),
  created_at timestamptz not null default now(),
  unique (event_id, reported_user)
);

alter table public.no_show_reports enable row level security;

create table public.post_game_thumbs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  from_user uuid references public.profiles (id) on delete set null,
  to_user uuid references public.profiles (id) on delete set null,
  sport_id uuid not null references public.sports (id),
  created_at timestamptz not null default now(),
  unique (event_id, from_user, to_user),
  constraint no_self_thumbs check (from_user != to_user)
);

alter table public.post_game_thumbs enable row level security;

create table public.player_availability (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  sport_id uuid not null references public.sports (id),
  city text not null constraint player_availability_city_curated_fk references private.cities (name),
  available_date date not null,
  time_pref text check (time_pref is null or time_pref in ('morning', 'afternoon', 'evening', 'any')),
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  unique (user_id, sport_id, available_date)
);

alter table public.player_availability enable row level security;
