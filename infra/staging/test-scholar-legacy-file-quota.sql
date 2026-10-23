-- Run only on a synthetic isolated DB with migrations through 042. Roll back probes.
\set ON_ERROR_STOP on
SELECT id AS actor_id FROM auth.users ORDER BY id LIMIT 1 \gset
SELECT gen_random_uuid() AS document_id, gen_random_uuid() AS source_file_id,
       gen_random_uuid() AS version_op \gset
BEGIN;
INSERT INTO public.scholar_documents(user_id,id) VALUES (:'actor_id',:'document_id');
INSERT INTO public.files(user_id,id,file_key,file_size)
  VALUES (:'actor_id',:'source_file_id',:'actor_id' || '/Scholar/legacy-quota-source.bin',0);
INSERT INTO public.scholar_document_files(user_id,document_id,file_id,role)
  VALUES (:'actor_id',:'document_id',:'source_file_id','original');
SELECT version_id FROM public.reserve_scholar_file_version_v1(
  :'actor_id',:'source_file_id',:'version_op',repeat('a',64),7,1099511627776) \gset
SELECT COALESCE((SELECT sum(file_size) FROM public.files WHERE user_id=:'actor_id' AND deleted_at IS NULL),0)
     + COALESCE((SELECT sum(file_size) FROM public.scholar_file_versions
                 WHERE user_id=:'actor_id' AND state IN ('pending','ready')),0) + 11 AS quota_bytes \gset
SELECT set_config('probe.actor_id',:'actor_id',true),
       set_config('probe.quota_bytes',:'quota_bytes',true);
SELECT file_id AS first_id, usage_bytes AS first_usage FROM public.reserve_storage_file_v1(
  :'actor_id',:'actor_id' || '/Readest/Books/quota-first.pdf',11,:'quota_bytes',NULL,NULL,NULL) \gset
SELECT set_config('probe.first_id',:'first_id',true),set_config('probe.first_usage',:'first_usage',true);
DO $probe$
DECLARE retry record; denied boolean:=false;
BEGIN
  SELECT * INTO retry FROM public.reserve_storage_file_v1(
    current_setting('probe.actor_id')::uuid,
    current_setting('probe.actor_id') || '/Readest/Books/quota-first.pdf',
    11,current_setting('probe.quota_bytes')::bigint,NULL,NULL,NULL);
  IF retry.file_id<>current_setting('probe.first_id')::uuid
     OR retry.usage_bytes<>current_setting('probe.first_usage')::bigint THEN
    RAISE EXCEPTION 'legacy retry allocated extra quota';
  END IF;
  BEGIN
    PERFORM public.reserve_storage_file_v1(
      current_setting('probe.actor_id')::uuid,
      current_setting('probe.actor_id') || '/Readest/Books/quota-second.pdf',
      11,current_setting('probe.quota_bytes')::bigint,NULL,NULL,NULL);
  EXCEPTION WHEN SQLSTATE 'PT413' THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'legacy upload ignored version bytes'; END IF;
  IF (SELECT usage_bytes<>file_bytes+version_bytes OR version_count<1
      FROM public.get_storage_usage_v1(current_setting('probe.actor_id')::uuid)) THEN
    RAISE EXCEPTION 'storage stats exclude version bytes';
  END IF;
  IF has_function_privilege('authenticated','public.get_storage_usage_v1(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated role can read another account usage';
  END IF;
  IF has_function_privilege('authenticated',
       'public.reserve_storage_file_v1(uuid,text,bigint,bigint,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated role can bypass quota RPC';
  END IF;
END $probe$;
ROLLBACK;
