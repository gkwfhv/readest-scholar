-- Run only against an isolated database restored from synthetic staging.
-- All probe rows roll back. A lost compare-and-swap retains both ready versions.
\set ON_ERROR_STOP on
SELECT id AS actor_id FROM auth.users ORDER BY id LIMIT 1 \gset
SELECT id AS other_id FROM auth.users WHERE id <> :'actor_id' ORDER BY id LIMIT 1 \gset
SELECT gen_random_uuid() AS document_id, gen_random_uuid() AS file_id,
       gen_random_uuid() AS first_op, gen_random_uuid() AS second_op,
       gen_random_uuid() AS third_op \gset
BEGIN;
SELECT set_config('probe.actor_id', :'actor_id', true), set_config('probe.other_id', :'other_id', true),
       set_config('probe.file_id', :'file_id', true), set_config('probe.first_op', :'first_op', true);
INSERT INTO public.scholar_documents(user_id,id) VALUES (:'actor_id', :'document_id');
INSERT INTO public.files(user_id,id,file_key,file_size)
  VALUES (:'actor_id', :'file_id', :'actor_id' || '/Scholar/version-probe.bin', 11);
INSERT INTO public.scholar_document_files(user_id,document_id,file_id,role)
  VALUES (:'actor_id', :'document_id', :'file_id', 'original');
SELECT set_config('request.jwt.claim.sub', :'actor_id', true);
SELECT version_id AS first_version, object_key AS first_key
  FROM public.reserve_scholar_file_version_v1(:'actor_id', :'file_id', :'first_op', repeat('a',64), 11, 1099511627776) \gset
SELECT set_config('probe.first_version', :'first_version', true),
       set_config('probe.first_key', :'first_key', true);
DO $probe$
DECLARE version uuid; key text;
BEGIN
  SELECT version_id, object_key INTO version,key FROM public.reserve_scholar_file_version_v1(
    current_setting('probe.actor_id')::uuid, current_setting('probe.file_id')::uuid, current_setting('probe.first_op')::uuid, repeat('a',64), 11, 1099511627776);
  IF version <> current_setting('probe.first_version')::uuid OR key <> current_setting('probe.first_key') THEN
    RAISE EXCEPTION 'prepare retry was not idempotent';
  END IF;
  IF key NOT LIKE current_setting('probe.actor_id') || '/Scholar/versions/%' THEN
    RAISE EXCEPTION 'object key escaped account';
  END IF;
END $probe$;
DO $probe$
DECLARE result record;
BEGIN
  BEGIN
    SELECT * INTO result FROM public.complete_scholar_file_version_v1(
      current_setting('probe.actor_id')::uuid, current_setting('probe.file_id')::uuid, current_setting('probe.first_op')::uuid, repeat('b',64), 11, NULL);
    RAISE EXCEPTION 'incorrect hash accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $probe$;
SELECT applied AS first_applied, active_version_id AS first_active
  FROM public.complete_scholar_file_version_v1(
    :'actor_id', :'file_id', :'first_op', repeat('a',64), 11, NULL) \gset
SELECT set_config('probe.first_applied', :'first_applied', true),
       set_config('probe.first_active', :'first_active', true);
DO $probe$ BEGIN
  IF NOT current_setting('probe.first_applied')::boolean OR current_setting('probe.first_active')::uuid <> current_setting('probe.first_version')::uuid THEN
    RAISE EXCEPTION 'first version did not activate';
  END IF;
END $probe$;
SELECT version_id AS second_version FROM public.reserve_scholar_file_version_v1(
  :'actor_id', :'file_id', :'second_op', repeat('b',64), 11, 1099511627776) \gset
SELECT version_id AS third_version FROM public.reserve_scholar_file_version_v1(
  :'actor_id', :'file_id', :'third_op', repeat('c',64), 11, 1099511627776) \gset
SELECT set_config('probe.second_version', :'second_version', true);
SELECT applied AS second_applied FROM public.complete_scholar_file_version_v1(
  :'actor_id', :'file_id', :'second_op', repeat('b',64), 11, :'first_version') \gset
SELECT applied AS third_applied FROM public.complete_scholar_file_version_v1(
  :'actor_id', :'file_id', :'third_op', repeat('c',64), 11, :'first_version') \gset
SELECT set_config('probe.second_applied', :'second_applied', true),
       set_config('probe.third_applied', :'third_applied', true);
DO $probe$ BEGIN
  IF NOT current_setting('probe.second_applied')::boolean OR current_setting('probe.third_applied')::boolean THEN
    RAISE EXCEPTION 'concurrent versions did not resolve by CAS';
  END IF;
  IF (SELECT count(*) FROM public.scholar_file_versions
      WHERE user_id=current_setting('probe.actor_id')::uuid AND file_id=current_setting('probe.file_id')::uuid AND state='ready') <> 3 THEN
    RAISE EXCEPTION 'lost version was not retained';
  END IF;
END $probe$;
SET LOCAL ROLE authenticated;
SELECT version_id AS restored FROM public.restore_scholar_file_version_v1(
  :'file_id', :'first_version', :'second_version') \gset
SELECT set_config('probe.restored', :'restored', true);
DO $probe$ BEGIN
  IF current_setting('probe.restored')::uuid <> current_setting('probe.first_version')::uuid THEN RAISE EXCEPTION 'restore failed'; END IF;
  BEGIN
    PERFORM public.restore_scholar_file_version_v1(
      current_setting('probe.file_id')::uuid, current_setting('probe.second_version')::uuid, current_setting('probe.second_version')::uuid);
    RAISE EXCEPTION 'stale restore succeeded';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', current_setting('probe.other_id'), true);
  BEGIN
    PERFORM public.restore_scholar_file_version_v1(
      current_setting('probe.file_id')::uuid, current_setting('probe.first_version')::uuid, current_setting('probe.second_version')::uuid);
    RAISE EXCEPTION 'cross-account restore succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $probe$;
RESET ROLE;
ROLLBACK;
