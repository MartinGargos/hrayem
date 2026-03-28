do $$
begin
  execute $grant$
    revoke all on function public.cancel_event_atomic(
      uuid,
      uuid
    ) from public
  $grant$;

  execute $grant$
    revoke all on function public.cancel_event_atomic(
      uuid,
      uuid
    ) from anon
  $grant$;

  execute $grant$
    revoke all on function public.cancel_event_atomic(
      uuid,
      uuid
    ) from authenticated
  $grant$;

  execute $grant$
    grant execute on function public.cancel_event_atomic(
      uuid,
      uuid
    ) to service_role
  $grant$;
end;
$$;
