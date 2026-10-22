-- Isolated synthetic database only. Transaction rolls back every probe row.
\set ON_ERROR_STOP on
SELECT id AS actor_id FROM auth.users ORDER BY id LIMIT 1 \gset
SELECT gen_random_uuid() AS document_id, gen_random_uuid() AS file_id,
       gen_random_uuid() AS first_op, gen_random_uuid() AS second_op \gset
SELECT COALESCE(sum(file_size),0)+11 AS quota_bytes FROM public.files
  WHERE user_id=:'actor_id' AND deleted_at IS NULL \gset
BEGIN;
INSERT INTO public.scholar_documents(user_id,id) VALUES (:'actor_id', :'document_id');
INSERT INTO public.files(user_id,id,file_key,file_size)
  VALUES (:'actor_id', :'file_id', :'actor_id' || '/Scholar/quota-probe.bin', 0);
INSERT INTO public.scholar_document_files(user_id,document_id,file_id,role)
  VALUES (:'actor_id', :'document_id', :'file_id', 'original');
DO $probe$ BEGIN
  IF has_function_privilege('authenticated', 'public.reserve_scholar_file_version_v1(uuid,uuid,uuid,text,bigint,bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated may bypass quota via direct reserve';
  END IF;
END $probe$;
SELECT set_config('probe.actor_id',:'actor_id',true),set_config('probe.file_id',:'file_id',true),
       set_config('probe.first_op',:'first_op',true),set_config('probe.second_op',:'second_op',true),
       set_config('probe.quota_bytes',:'quota_bytes',true);
SELECT version_id AS first_version FROM public.reserve_scholar_file_version_v1(
  :'actor_id',:'file_id',:'first_op',repeat('a',64),11,:'quota_bytes') \gset
SELECT set_config('probe.first_version',:'first_version',true);
DO $probe$
DECLARE retry uuid; denied boolean:=false;
BEGIN
  SELECT version_id INTO retry FROM public.reserve_scholar_file_version_v1(
    current_setting('probe.actor_id')::uuid,current_setting('probe.file_id')::uuid,
    current_setting('probe.first_op')::uuid,repeat('a',64),11,
    current_setting('probe.quota_bytes')::bigint);
  IF retry<>current_setting('probe.first_version')::uuid THEN
    RAISE EXCEPTION 'retry allocated another version';
  END IF;
  BEGIN
    PERFORM public.reserve_scholar_file_version_v1(
      current_setting('probe.actor_id')::uuid,current_setting('probe.file_id')::uuid,
      current_setting('probe.second_op')::uuid,repeat('b',64),11,
      current_setting('probe.quota_bytes')::bigint);
  EXCEPTION WHEN SQLSTATE 'PT413' THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'parallel reservation exceeded quota'; END IF;
END $probe$;
UPDATE public.scholar_file_versions SET expires_at=now()-interval '1 second'
  WHERE user_id=:'actor_id' AND file_id=:'file_id' AND op_id=:'first_op';
DO $probe$
DECLARE denied boolean:=false;
BEGIN
  BEGIN
    PERFORM public.complete_scholar_file_version_v1(
      current_setting('probe.actor_id')::uuid,current_setting('probe.file_id')::uuid,
      current_setting('probe.first_op')::uuid,repeat('a',64),11,NULL);
  EXCEPTION WHEN SQLSTATE 'PT410' THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'expired upload completed'; END IF;
END $probe$;
SELECT version_id AS second_version FROM public.reserve_scholar_file_version_v1(
  :'actor_id',:'file_id',:'second_op',repeat('b',64),11,:'quota_bytes') \gset
DO $probe$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.scholar_file_versions WHERE user_id=current_setting('probe.actor_id')::uuid
      AND file_id=current_setting('probe.file_id')::uuid
      AND op_id=current_setting('probe.first_op')::uuid AND state='expired'
  ) THEN RAISE EXCEPTION 'expired reservation still consumes quota'; END IF;
END $probe$;
ROLLBACK;
