-- Synthetic staging DB only; validates glossary ownership and queue binding.
\set ON_ERROR_STOP on
SELECT id AS actor_id FROM auth.users ORDER BY id LIMIT 1 \gset
SELECT id AS other_id FROM auth.users WHERE id<>:'actor_id' ORDER BY id LIMIT 1 \gset
SELECT gen_random_uuid() AS document_id,gen_random_uuid() AS file_id,
       gen_random_uuid() AS version_id,gen_random_uuid() AS op_id,
       gen_random_uuid() AS request_id \gset
BEGIN;
INSERT INTO public.scholar_documents(user_id,id) VALUES (:'actor_id',:'document_id');
INSERT INTO public.files(user_id,id,file_key,file_size)
  VALUES (:'actor_id',:'file_id',:'actor_id' || '/Scholar/glossary-probe.pdf',24);
INSERT INTO public.scholar_document_files(user_id,document_id,file_id,role)
  VALUES (:'actor_id',:'document_id',:'file_id','original');
INSERT INTO public.scholar_file_versions
  (user_id,file_id,version_id,op_id,object_key,sha256,file_size,state)
  VALUES (:'actor_id',:'file_id',:'version_id',:'op_id',
          :'actor_id' || '/Scholar/versions/' || :'version_id' || '.pdf',
          repeat('a',64),24,'ready');
INSERT INTO public.scholar_translation_glossaries(user_id,sha256,csv_text)
  VALUES (:'other_id',repeat('c',64),'source,target,tgt_lng'||E'\n'||'BERT,foreign,zh-CN'||E'\n');
SELECT set_config('probe.actor_id',:'actor_id',true),
       set_config('probe.file_id',:'file_id',true),
       set_config('probe.version_id',:'version_id',true),
       set_config('probe.request_id',:'request_id',true);
DO $probe$
DECLARE rejected boolean:=false;
BEGIN
  BEGIN
    PERFORM public.enqueue_scholar_translation_job_v1(
      current_setting('probe.actor_id')::uuid,current_setting('probe.file_id')::uuid,
      current_setting('probe.version_id')::uuid,current_setting('probe.request_id')::uuid,
      'dual','zh-CN','openai-compatible','local-model',repeat('c',64));
  EXCEPTION WHEN insufficient_privilege THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'unknown glossary accepted'; END IF;
END $probe$;
INSERT INTO public.scholar_translation_glossaries(user_id,sha256,csv_text)
  VALUES (:'actor_id',repeat('c',64),'source,target,tgt_lng'||E'\n'||'BERT,双向编码器,zh-CN'||E'\n');
SELECT id AS job_id FROM public.enqueue_scholar_translation_job_v1(
  :'actor_id',:'file_id',:'version_id',:'request_id','dual','zh-CN',
  'openai-compatible','local-model',repeat('c',64)) \gset
SELECT set_config('probe.job_id',:'job_id',true);
DO $probe$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.scholar_translation_jobs
    WHERE id=current_setting('probe.job_id')::uuid
      AND user_id=current_setting('probe.actor_id')::uuid
      AND glossary_sha256=repeat('c',64)
  ) THEN RAISE EXCEPTION 'owned glossary was not bound to job'; END IF;
END $probe$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'other_id', true);
DO $probe$ BEGIN
  IF EXISTS (SELECT 1 FROM public.scholar_translation_glossaries
             WHERE user_id=current_setting('probe.actor_id')::uuid) THEN
    RAISE EXCEPTION 'other account read private glossary';
  END IF;
  IF has_table_privilege('authenticated','public.scholar_translation_glossaries','INSERT') THEN
    RAISE EXCEPTION 'ordinary client can write glossary';
  END IF;
END $probe$;
RESET ROLE;
ROLLBACK;
