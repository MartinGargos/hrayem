alter table public.device_tokens
  add column if not exists ownership_key text;

update public.device_tokens
set ownership_key = gen_random_uuid()::text
where ownership_key is null
   or btrim(ownership_key) = '';

alter table public.device_tokens
  alter column ownership_key set default gen_random_uuid()::text;

alter table public.device_tokens
  alter column ownership_key set not null;

drop function if exists public.claim_device_token(text, text);
drop function if exists public.delete_device_token(text);

create or replace function public.claim_device_token(
  push_token text,
  push_platform text,
  push_ownership_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_token text;
  normalized_ownership_key text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  normalized_token := nullif(btrim(push_token), '');
  normalized_ownership_key := nullif(btrim(push_ownership_key), '');

  if normalized_token is null then
    raise exception 'Push token is required';
  end if;

  if normalized_ownership_key is null then
    raise exception 'Push token ownership key is required';
  end if;

  if push_platform not in ('ios', 'android') then
    raise exception 'Unsupported push platform';
  end if;

  insert into public.device_tokens (user_id, token, platform, ownership_key)
  values (auth.uid(), normalized_token, push_platform, normalized_ownership_key)
  on conflict (token)
  do update set
    user_id = excluded.user_id,
    platform = excluded.platform,
    ownership_key = excluded.ownership_key,
    updated_at = now()
  where public.device_tokens.ownership_key = excluded.ownership_key
     or public.device_tokens.user_id = auth.uid();

  if found then
    return;
  end if;

  raise exception 'Push token is already registered to another device installation';
end;
$$;

create or replace function public.delete_device_token(
  push_token text,
  push_ownership_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_token text;
  normalized_ownership_key text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  normalized_token := nullif(btrim(push_token), '');
  normalized_ownership_key := nullif(btrim(push_ownership_key), '');

  if normalized_token is null then
    return;
  end if;

  if normalized_ownership_key is null then
    raise exception 'Push token ownership key is required';
  end if;

  delete from public.device_tokens
  where token = normalized_token
    and (
      ownership_key = normalized_ownership_key
      or user_id = auth.uid()
    );

  if found then
    return;
  end if;

  if exists(select 1 from public.device_tokens where token = normalized_token) then
    raise exception 'Push token is already registered to another device installation';
  end if;
end;
$$;

revoke all on function public.claim_device_token(text, text, text) from public;
revoke all on function public.delete_device_token(text, text) from public;

grant execute on function public.claim_device_token(text, text, text) to authenticated;
grant execute on function public.claim_device_token(text, text, text) to service_role;
grant execute on function public.delete_device_token(text, text) to authenticated;
grant execute on function public.delete_device_token(text, text) to service_role;
