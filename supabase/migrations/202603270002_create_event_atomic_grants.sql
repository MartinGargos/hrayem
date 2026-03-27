do $$
begin
  execute $grant$
    revoke all on function public.create_event_atomic(
      uuid,
      uuid,
      uuid,
      timestamptz,
      timestamptz,
      text,
      smallint,
      smallint,
      smallint,
      text
    ) from public
  $grant$;

  execute $grant$
    revoke all on function public.create_event_atomic(
      uuid,
      uuid,
      uuid,
      timestamptz,
      timestamptz,
      text,
      smallint,
      smallint,
      smallint,
      text
    ) from anon
  $grant$;

  execute $grant$
    revoke all on function public.create_event_atomic(
      uuid,
      uuid,
      uuid,
      timestamptz,
      timestamptz,
      text,
      smallint,
      smallint,
      smallint,
      text
    ) from authenticated
  $grant$;

  execute $grant$
    grant execute on function public.create_event_atomic(
      uuid,
      uuid,
      uuid,
      timestamptz,
      timestamptz,
      text,
      smallint,
      smallint,
      smallint,
      text
    ) to service_role
  $grant$;
end;
$$;
