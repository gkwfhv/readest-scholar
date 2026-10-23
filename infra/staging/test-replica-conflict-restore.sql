-- Run on an isolated database with migrations through 036.
-- Everything, including the synthetic account context, rolls back.
BEGIN;
DO $$
DECLARE uid uuid;
BEGIN
  SELECT id INTO uid FROM auth.users ORDER BY created_at LIMIT 1;
  IF uid IS NULL THEN RAISE EXCEPTION 'synthetic auth user required'; END IF;
  PERFORM set_config('request.jwt.claim.sub', uid::text, true);
END;
$$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  uid uuid := auth.uid();
  rid text := 'phase3-restore-probe';
  a text := '0000000000100-00000000-device-a';
  b text := '0000000000200-00000000-device-b';
  fresh text := lpad(to_hex((extract(epoch from clock_timestamp()) * 1000)::bigint), 13, '0')
                  || '-00000000-restore-probe';
  expected jsonb;
  hash text;
  before_seq bigint;
  restored public.replicas;
BEGIN
  PERFORM public.crdt_merge_replica_v2(uid, 'settings', rid,
    jsonb_build_object('theme', jsonb_build_object('v', 'A', 't', a, 's', 'device-a')),
    NULL, NULL, NULL, a, 1);
  SELECT * INTO restored FROM public.crdt_merge_replica_v2(uid, 'settings', rid,
    jsonb_build_object(
      'theme', jsonb_build_object('v', 'B', 't', b, 's', 'device-b'),
      'accent', jsonb_build_object('v', 'blue', 't', b, 's', 'device-b')
    ),
    NULL, NULL, NULL, b, 1);
  before_seq := restored.change_seq;
  expected := restored.fields_jsonb -> 'theme';
  SELECT version_hash INTO hash FROM public.replica_conflict_versions
  WHERE user_id = uid AND kind = 'settings' AND replica_id = rid
    AND source = 'previous';
  IF hash IS NULL THEN RAISE EXCEPTION 'previous branch missing'; END IF;

  SELECT * INTO restored FROM public.restore_replica_field_v1(
    uid, 'settings', rid, 'previous', hash, 'theme', expected, fresh
  );
  IF restored.fields_jsonb #>> '{theme,v}' <> 'A'
     OR restored.fields_jsonb #>> '{theme,t}' <> fresh
     OR restored.change_seq <= before_seq
     OR restored.fields_jsonb #>> '{accent,v}' <> 'blue' THEN
    RAISE EXCEPTION 'selected version not restored';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.replica_conflict_versions
    WHERE user_id = uid AND kind = 'settings' AND replica_id = rid
      AND source = 'previous' AND row_data #>> '{fields_jsonb,theme,v}' = 'B'
  ) THEN
    RAISE EXCEPTION 'overwritten winner was not archived';
  END IF;

  BEGIN
    PERFORM public.restore_replica_field_v1(
      uid, 'settings', rid, 'previous', hash, 'theme', expected,
      lpad(to_hex((extract(epoch from clock_timestamp()) * 1000)::bigint + 1), 13, '0')
        || '-00000000-restore-probe'
    );
    RAISE EXCEPTION 'stale expected field restored unexpectedly';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  BEGIN
    PERFORM public.restore_replica_field_v1(
      '00000000-0000-0000-0000-000000000001'::uuid,
      'settings', rid, 'previous', hash, 'theme', expected, fresh
    );
    RAISE EXCEPTION 'cross-account restore unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
ROLLBACK;
