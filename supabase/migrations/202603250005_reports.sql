create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  target_type text not null check (target_type in ('event', 'player')),
  target_event_id uuid references public.events (id) on delete set null,
  target_user_id uuid references public.profiles (id) on delete set null,
  reason text not null check (
    reason in (
      'inappropriate_content',
      'spam_or_fake',
      'abusive_behavior',
      'other'
    )
  ),
  detail text check (detail is null or char_length(detail) <= 300),
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now(),
  constraint report_has_target check (
    (target_type = 'event' and target_event_id is not null)
    or (target_type = 'player' and target_user_id is not null)
  )
);

alter table public.reports enable row level security;

create unique index idx_reports_dedupe on public.reports (
  reporter_id,
  target_type,
  coalesce(target_event_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(target_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
