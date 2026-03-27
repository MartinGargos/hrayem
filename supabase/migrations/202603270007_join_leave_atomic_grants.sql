do $$
begin
  execute $grant$
    revoke all on function public.join_event_atomic(
      uuid,
      uuid,
      smallint
    ) from public
  $grant$;

  execute $grant$
    revoke all on function public.join_event_atomic(
      uuid,
      uuid,
      smallint
    ) from anon
  $grant$;

  execute $grant$
    revoke all on function public.join_event_atomic(
      uuid,
      uuid,
      smallint
    ) from authenticated
  $grant$;

  execute $grant$
    grant execute on function public.join_event_atomic(
      uuid,
      uuid,
      smallint
    ) to service_role
  $grant$;

  execute $grant$
    revoke all on function public.leave_event_atomic(
      uuid,
      uuid,
      uuid
    ) from public
  $grant$;

  execute $grant$
    revoke all on function public.leave_event_atomic(
      uuid,
      uuid,
      uuid
    ) from anon
  $grant$;

  execute $grant$
    revoke all on function public.leave_event_atomic(
      uuid,
      uuid,
      uuid
    ) from authenticated
  $grant$;

  execute $grant$
    grant execute on function public.leave_event_atomic(
      uuid,
      uuid,
      uuid
    ) to service_role
  $grant$;
end;
$$;
