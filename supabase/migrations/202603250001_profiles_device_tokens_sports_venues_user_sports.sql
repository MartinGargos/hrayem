create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create table private.cities (
  name text primary key,
  sort_order smallint not null unique
);

insert into private.cities (name, sort_order)
values
  ('Ostrava', 1),
  ('Praha (Prague)', 2),
  ('Brno', 3),
  ('Plzeň', 4),
  ('Olomouc', 5),
  ('Liberec', 6),
  ('České Budějovice', 7),
  ('Hradec Králové', 8),
  ('Pardubice', 9),
  ('Zlín', 10),
  ('Opava', 11),
  ('Frýdek-Místek', 12),
  ('Havířov', 13),
  ('Karviná', 14);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text check (first_name is null or char_length(first_name) between 1 and 50),
  last_name text check (last_name is null or char_length(last_name) between 1 and 50),
  photo_url text,
  city text constraint profiles_city_curated_fk references private.cities (name),
  latitude double precision,
  longitude double precision,
  language text not null default 'cs' check (language in ('cs', 'en')),
  is_deleted boolean not null default false,
  profile_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  token text not null,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, token)
);

alter table public.device_tokens enable row level security;

create table public.sports (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name_cs text not null,
  name_en text not null,
  icon_name text not null,
  color_hex text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.sports enable row level security;

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  city text not null constraint venues_city_curated_fk references private.cities (name),
  address text check (address is null or char_length(address) <= 200),
  created_by uuid references public.profiles (id) on delete set null,
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.venues enable row level security;

create table public.user_sports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  sport_id uuid not null references public.sports (id),
  skill_level smallint not null check (skill_level between 1 and 4),
  games_played int not null default 0,
  hours_played numeric(8, 2) not null default 0,
  no_shows int not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, sport_id)
);

alter table public.user_sports enable row level security;
