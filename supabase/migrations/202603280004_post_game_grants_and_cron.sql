do $$
begin
  execute $grant$
    revoke all on function public.finish_event_sweep()
    from public
  $grant$;

  execute $grant$
    revoke all on function public.finish_event_sweep()
    from anon
  $grant$;

  execute $grant$
    revoke all on function public.finish_event_sweep()
    from authenticated
  $grant$;

  execute $grant$
    grant execute on function public.finish_event_sweep()
    to service_role
  $grant$;

  execute $grant$
    revoke all on function public.report_no_show_atomic(
      uuid,
      uuid,
      uuid
    ) from public
  $grant$;

  execute $grant$
    revoke all on function public.report_no_show_atomic(
      uuid,
      uuid,
      uuid
    ) from anon
  $grant$;

  execute $grant$
    revoke all on function public.report_no_show_atomic(
      uuid,
      uuid,
      uuid
    ) from authenticated
  $grant$;

  execute $grant$
    grant execute on function public.report_no_show_atomic(
      uuid,
      uuid,
      uuid
    ) to service_role
  $grant$;

  execute $grant$
    revoke all on function public.give_thumbs_up_atomic(
      uuid,
      uuid,
      uuid
    ) from public
  $grant$;

  execute $grant$
    revoke all on function public.give_thumbs_up_atomic(
      uuid,
      uuid,
      uuid
    ) from anon
  $grant$;

  execute $grant$
    revoke all on function public.give_thumbs_up_atomic(
      uuid,
      uuid,
      uuid
    ) from authenticated
  $grant$;

  execute $grant$
    grant execute on function public.give_thumbs_up_atomic(
      uuid,
      uuid,
      uuid
    ) to service_role
  $grant$;
end;
$$;

do $$
declare
  existing_job_id bigint;
begin
  for existing_job_id in
    select jobid
    from cron.job
    where jobname = 'finish-event'
  loop
    perform cron.unschedule(existing_job_id);
  end loop;

  perform cron.schedule(
    'finish-event',
    '*/10 * * * *',
    $job$select public.finish_event_sweep();$job$
  );
end;
$$;
