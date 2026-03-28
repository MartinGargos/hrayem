do $$
begin
  execute $grant$
    revoke all on function public.update_event_atomic(
      uuid,
      uuid,
      uuid,
      timestamptz,
      timestamptz,
      text,
      smallint,
      smallint,
      smallint,
      text,
      boolean
    ) from public
  $grant$;

  execute $grant$
    revoke all on function public.update_event_atomic(
      uuid,
      uuid,
      uuid,
      timestamptz,
      timestamptz,
      text,
      smallint,
      smallint,
      smallint,
      text,
      boolean
    ) from anon
  $grant$;

  execute $grant$
    revoke all on function public.update_event_atomic(
      uuid,
      uuid,
      uuid,
      timestamptz,
      timestamptz,
      text,
      smallint,
      smallint,
      smallint,
      text,
      boolean
    ) from authenticated
  $grant$;

  execute $grant$
    grant execute on function public.update_event_atomic(
      uuid,
      uuid,
      uuid,
      timestamptz,
      timestamptz,
      text,
      smallint,
      smallint,
      smallint,
      text,
      boolean
    ) to service_role
  $grant$;
end;
$$;
