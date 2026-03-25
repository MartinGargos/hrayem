drop policy if exists profiles_update_own on public.profiles;

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
  );
