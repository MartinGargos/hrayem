with ranked_tokens as (
  select
    id,
    row_number() over (
      partition by token
      order by updated_at desc, created_at desc, id desc
    ) as row_number
  from public.device_tokens
)
delete from public.device_tokens as device_token
using ranked_tokens
where device_token.id = ranked_tokens.id
  and ranked_tokens.row_number > 1;

alter table public.device_tokens
  drop constraint if exists device_tokens_user_id_token_key;

alter table public.device_tokens
  add constraint device_tokens_token_key unique (token);

create or replace function public.claim_device_token(push_token text, push_platform text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_token text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  normalized_token := nullif(btrim(push_token), '');

  if normalized_token is null then
    raise exception 'Push token is required';
  end if;

  if push_platform not in ('ios', 'android') then
    raise exception 'Unsupported push platform';
  end if;

  insert into public.device_tokens (user_id, token, platform)
  values (auth.uid(), normalized_token, push_platform)
  on conflict (token)
  do update set
    user_id = excluded.user_id,
    platform = excluded.platform,
    updated_at = now();
end;
$$;

create or replace function public.delete_device_token(push_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_token text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  normalized_token := nullif(btrim(push_token), '');

  if normalized_token is null then
    return;
  end if;

  delete from public.device_tokens
  where token = normalized_token;
end;
$$;

revoke all on function public.claim_device_token(text, text) from public;
revoke all on function public.delete_device_token(text) from public;

grant execute on function public.claim_device_token(text, text) to authenticated;
grant execute on function public.claim_device_token(text, text) to service_role;
grant execute on function public.delete_device_token(text) to authenticated;
grant execute on function public.delete_device_token(text) to service_role;
