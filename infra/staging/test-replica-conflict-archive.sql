-- Run only against an isolated database with migrations through 035.
-- The transaction rolls back all synthetic writes and JWT context.
BEGIN;
DO $$
DECLARE
  uid uuid;
BEGIN
  SELECT id INTO uid FROM auth.users ORDER BY created_at LIMIT 1;
  IF uid IS NULL THEN RAISE EXCEPTION 'probe requires a synthetic auth user'; END IF;
  PERFORM set_config('request.jwt.claim.sub', uid::text, true);
  INSERT INTO public.replica_conflict_versions
    (user_id, kind, replica_id, source, version_hash, row_data)
  SELECT id, 'settings', 'other-account-probe', 'previous',
         md5(id::text), jsonb_build_object('user_id', id, 'kind', 'settings')
  FROM auth.users WHERE id <> uid ORDER BY created_at LIMIT 1;
END;
$$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  uid uuid := auth.uid();
  rid text := 'phase3-conflict-probe';
  a text := '0000000000100-00000000-device-a';
  b text := '0000000000200-00000000-device-b';
  c text := '0000000000180-00000000-device-c';
  merged public.replicas;
  previous_count integer;
  incoming_count integer;
  winner_seq bigint;
BEGIN
  IF has_table_privilege('authenticated', 'public.replica_conflict_versions', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated can forge conflict history';
  END IF;
  BEGIN
    INSERT INTO public.replica_conflict_versions
      (user_id, kind, replica_id, source, version_hash, row_data)
    VALUES
      (uid, 'settings', rid, 'incoming', 'forged',
       jsonb_build_object('user_id', uid, 'kind', 'settings'));
    RAISE EXCEPTION 'direct history insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  SELECT * INTO merged FROM public.crdt_merge_replica_v2(
    uid, 'settings', rid,
    jsonb_build_object('theme', jsonb_build_object('v', 'A', 't', a, 's', 'device-a')),
    NULL, NULL, NULL, a, 1
  );
  SELECT * INTO merged FROM public.crdt_merge_replica_v2(
    uid, 'settings', rid,
    jsonb_build_object('theme', jsonb_build_object('v', 'B', 't', b, 's', 'device-b')),
    NULL, NULL, NULL, b, 1
  );
  winner_seq := merged.change_seq;
  SELECT * INTO merged FROM public.crdt_merge_replica_v2(
    uid, 'settings', rid,
    jsonb_build_object('theme', jsonb_build_object('v', 'C', 't', c, 's', 'device-c')),
    NULL, NULL, NULL, c, 1
  );
  IF merged.change_seq <> winner_seq THEN
    RAISE EXCEPTION 'losing old field changed the transport sequence';
  END IF;
  IF merged.fields_jsonb #>> '{theme,v}' <> 'B' THEN
    RAISE EXCEPTION 'newer field did not win';
  END IF;
  SELECT count(*) FILTER (WHERE source = 'previous'),
         count(*) FILTER (WHERE source = 'incoming')
    INTO previous_count, incoming_count
  FROM public.replica_conflict_versions
  WHERE user_id = uid AND kind = 'settings' AND replica_id = rid;
  IF previous_count <> 1 OR incoming_count <> 1 THEN
    RAISE EXCEPTION 'missing conflict branches: previous %, incoming %',
      previous_count, incoming_count;
  END IF;
  SELECT * INTO merged FROM public.crdt_merge_replica_v2(
    uid, 'settings', rid,
    jsonb_build_object('theme', jsonb_build_object('v', 'C', 't', c, 's', 'device-c')),
    NULL, NULL, NULL, c, 1
  );
  IF merged.change_seq <> winner_seq THEN
    RAISE EXCEPTION 'duplicate replay changed the transport sequence';
  END IF;
  SELECT count(*) FILTER (WHERE source = 'previous'),
         count(*) FILTER (WHERE source = 'incoming')
    INTO previous_count, incoming_count
  FROM public.replica_conflict_versions
  WHERE user_id = uid AND kind = 'settings' AND replica_id = rid;
  IF previous_count <> 1 OR incoming_count <> 1 THEN
    RAISE EXCEPTION 'duplicate replay created extra branches';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.replica_conflict_versions
    WHERE replica_id = 'other-account-probe'
  ) THEN
    RAISE EXCEPTION 'cross-account history was visible';
  END IF;
  -- The pre-versioned RPC remains callable after migration 034.
  SELECT * INTO merged FROM public.crdt_merge_replica(
    uid, 'settings', 'phase3-legacy-probe',
    jsonb_build_object('theme', jsonb_build_object('v', 'legacy', 't', a, 's', 'device-a')),
    NULL, NULL, NULL, a, 1
  );
  IF merged.fields_jsonb #>> '{theme,v}' <> 'legacy' THEN
    RAISE EXCEPTION 'legacy merge RPC failed';
  END IF;
END;
$$;
ROLLBACK;
