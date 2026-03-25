create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  event_id uuid references public.events (id) on delete set null,
  type text not null,
  payload jsonb,
  status text not null default 'sent' check (status in ('sent', 'failed')),
  created_at timestamptz not null default now()
);

alter table public.notification_log enable row level security;

create table public.notification_preferences (
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (
    type in (
      'player_joined',
      'join_confirmed',
      'waitlist_promoted',
      'event_full',
      'chat_message',
      'event_reminder',
      'event_cancelled',
      'player_removed'
    )
  ),
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, type)
);

alter table public.notification_preferences enable row level security;
