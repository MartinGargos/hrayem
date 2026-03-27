drop policy if exists event_players_select_visible on public.event_players;

create policy event_players_select_visible on public.event_players
  for select
  to authenticated
  using (
    status = 'confirmed'
    or user_id = auth.uid()
  );
