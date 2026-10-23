-- Synthetic staging database only; publication metadata is rolled back.
\set ON_ERROR_STOP on
SELECT id AS actor_id FROM auth.users ORDER BY id LIMIT 1 \gset
SELECT gen_random_uuid() AS document_id,gen_random_uuid() AS file_id,
       gen_random_uuid() AS version_id,gen_random_uuid() AS op_id,
       gen_random_uuid() AS request_id \gset
BEGIN;
INSERT INTO public.scholar_documents(user_id,id) VALUES (:'actor_id',:'document_id');
INSERT INTO public.files(user_id,id,file_key,file_size)
  VALUES (:'actor_id',:'file_id',:'actor_id' || '/Scholar/publish-probe.pdf',24);
INSERT INTO public.scholar_document_files(user_id,document_id,file_id,role)
  VALUES (:'actor_id',:'document_id',:'file_id','original');
INSERT INTO public.scholar_file_versions
  (user_id,file_id,version_id,op_id,object_key,sha256,file_size,state)
  VALUES (:'actor_id',:'file_id',:'version_id',:'op_id',
          :'actor_id' || '/Scholar/versions/' || :'version_id' || '.pdf',
          repeat('a',64),24,'ready');
SELECT id AS job_id FROM public.enqueue_scholar_translation_job_v1(
  :'actor_id',:'file_id',:'version_id',:'request_id','dual','zh-CN',
  'openai-compatible','local-model',NULL) \gset
SELECT lease_token AS token FROM public.claim_scholar_translation_job_v1(
  'synthetic-worker',60) \gset
SELECT set_config('probe.job_id', :'job_id', true),
       set_config('probe.token', :'token', true),
       set_config('probe.actor_id', :'actor_id', true);
DO $probe$
DECLARE rejected boolean:=false;
BEGIN
  BEGIN
    PERFORM public.publish_scholar_translation_outputs_v1(
      current_setting('probe.job_id')::uuid,
      current_setting('probe.token')::uuid,
      jsonb_build_array(jsonb_build_object(
        'kind','dual','objectKey','other-account/Scholar/translations/escape.pdf',
        'sha256',repeat('b',64),'fileSize',123,'pageCount',2)),
      '2.9.0');
  EXCEPTION WHEN invalid_parameter_value THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'foreign output object key accepted'; END IF;
  IF EXISTS (SELECT 1 FROM public.scholar_translation_outputs
       WHERE job_id=current_setting('probe.job_id')::uuid) THEN
    RAISE EXCEPTION 'rejected publication left an output row';
  END IF;
END $probe$;
SELECT public.publish_scholar_translation_outputs_v1(
  :'job_id',:'token',
  jsonb_build_array(jsonb_build_object(
    'kind','dual',
    'objectKey',:'actor_id' || '/Scholar/translations/' || :'job_id' || '/dual.pdf',
    'sha256',repeat('b',64),'fileSize',123,'pageCount',2)),
  '2.9.0') AS published \gset
SELECT set_config('probe.published', :'published', true),
       set_config('probe.job_id', :'job_id', true),
       set_config('probe.version_id', :'version_id', true),
       set_config('probe.document_id', :'document_id', true);
DO $probe$ BEGIN
  IF NOT current_setting('probe.published')::boolean THEN
    RAISE EXCEPTION 'valid translated output not published';
  END IF;
  IF (SELECT state FROM public.scholar_translation_jobs WHERE id=current_setting('probe.job_id')::uuid)<>'succeeded' THEN
    RAISE EXCEPTION 'job did not finish after publication';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.scholar_translation_outputs o
      JOIN public.scholar_document_files df
        ON df.user_id=o.user_id AND df.file_id=o.file_id
      JOIN public.files f ON f.user_id=o.user_id AND f.id=o.file_id
    WHERE o.job_id=current_setting('probe.job_id')::uuid AND df.role='translation'
      AND df.document_id=current_setting('probe.document_id')::uuid
      AND f.file_key=o.object_key
  ) THEN RAISE EXCEPTION 'translated attachment not linked to document'; END IF;
  IF public.publish_scholar_translation_outputs_v1(
       current_setting('probe.job_id')::uuid,current_setting('probe.token')::uuid,
       jsonb_build_array(jsonb_build_object(
         'kind','dual','objectKey',current_setting('probe.actor_id') ||
           '/Scholar/translations/' || current_setting('probe.job_id') || '/dual.pdf',
         'sha256',repeat('b',64),'fileSize',123,'pageCount',2)),'2.9.0') THEN
    RAISE EXCEPTION 'old worker republished terminal job';
  END IF;
  IF (SELECT sha256 FROM public.scholar_file_versions WHERE version_id=current_setting('probe.version_id')::uuid)<>repeat('a',64) THEN
    RAISE EXCEPTION 'source PDF changed during publication';
  END IF;
END $probe$;
ROLLBACK;
