create or replace function private.invoke_event_reminder_dispatch()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  dispatch_url text;
  dispatch_secret text;
begin
  select rc.value
  into dispatch_url
  from private.runtime_config as rc
  where rc.key = 'event_reminder_dispatch_url';

  select rc.value
  into dispatch_secret
  from private.runtime_config as rc
  where rc.key = 'event_reminder_dispatch_secret';

  if dispatch_url is null or dispatch_secret is null then
    raise exception 'Event reminder dispatch runtime config is missing.';
  end if;

  perform net.http_post(
    url := dispatch_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', dispatch_secret
    ),
    body := jsonb_build_object('source', 'finish_event_sweep'),
    timeout_milliseconds := 15000
  );
end;
$$;

revoke all on function private.invoke_event_reminder_dispatch() from public;
revoke all on function private.invoke_event_reminder_dispatch() from anon;
revoke all on function private.invoke_event_reminder_dispatch() from authenticated;
revoke all on function private.invoke_event_reminder_dispatch() from service_role;
