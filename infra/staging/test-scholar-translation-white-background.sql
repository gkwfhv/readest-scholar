-- Synthetic staging-only compatibility request; rollback leaves no rows.
\set ON_ERROR_STOP on
SELECT id AS actor_id FROM auth.users ORDER BY id LIMIT 1 \gset
SELECT gen_random_uuid() AS document_id, gen_random_uuid() AS file_id,
       gen_random_uuid() AS version_id, gen_random_uuid() AS upload_id,
       gen_random_uuid() AS request_id, gen_random_uuid() AS retry_id \gset
BEGIN;
INSERT INTO public.scholar_documents(user_id,id) VALUES (:'actor_id', :'document_id');
INSERT INTO public.files(user_id,id,file_key,file_size)
  VALUES (:'actor_id', :'file_id', :'actor_id' || '/Scholar/white-background-probe.pdf', 24);
INSERT INTO public.scholar_document_files(user_id,document_id,file_id,role)
  VALUES (:'actor_id', :'document_id', :'file_id', 'original');
INSERT INTO public.scholar_file_versions
  (user_id,file_id,version_id,op_id,object_key,sha256,file_size,state)
  VALUES (:'actor_id', :'file_id', :'version_id', :'upload_id',
          :'actor_id' || '/Scholar/versions/' || :'version_id' || '.pdf',
          repeat('a',64), 24, 'ready');
SELECT set_config('probe.actor_id', :'actor_id', true),
       set_config('probe.file_id', :'file_id', true),
       set_config('probe.version_id', :'version_id', true),
       set_config('probe.request_id', :'request_id', true),
       set_config('probe.retry_id', :'retry_id', true) \gset
DO $probe$
DECLARE first_job public.scholar_translation_jobs;
        duplicate public.scholar_translation_jobs;
        retried public.scholar_translation_jobs;
        collision boolean:=false;
BEGIN
  SELECT * INTO first_job FROM public.enqueue_scholar_translation_job_v2(
    current_setting('probe.actor_id')::uuid,
    current_setting('probe.file_id')::uuid,
    current_setting('probe.version_id')::uuid,
    current_setting('probe.request_id')::uuid,
    'dual','zh-CN','openai-compatible','local-model',NULL,true);
  IF first_job.request_options->>'whiteBackgroundCompatibility' <> 'true' THEN
    RAISE EXCEPTION 'white background option not stored';
  END IF;
  SELECT * INTO duplicate FROM public.enqueue_scholar_translation_job_v2(
    current_setting('probe.actor_id')::uuid,
    current_setting('probe.file_id')::uuid,
    current_setting('probe.version_id')::uuid,
    current_setting('probe.request_id')::uuid,
    'dual','zh-CN','openai-compatible','local-model',NULL,true);
  IF duplicate.id<>first_job.id THEN RAISE EXCEPTION 'idempotency failed'; END IF;
  BEGIN
    PERFORM public.enqueue_scholar_translation_job_v2(
      current_setting('probe.actor_id')::uuid,
      current_setting('probe.file_id')::uuid,
      current_setting('probe.version_id')::uuid,
      current_setting('probe.request_id')::uuid,
      'dual','zh-CN','openai-compatible','local-model',NULL,false);
  EXCEPTION WHEN SQLSTATE 'PT409' THEN collision:=true;
  END;
  IF NOT collision THEN RAISE EXCEPTION 'option change reused idempotency key'; END IF;
  PERFORM public.cancel_scholar_translation_job_v1(first_job.user_id,first_job.id);
  SELECT * INTO retried FROM public.retry_scholar_translation_job_v2(
    first_job.user_id,first_job.id,current_setting('probe.retry_id')::uuid);
  IF retried.id=first_job.id
     OR retried.request_options->>'whiteBackgroundCompatibility'<>'true' THEN
    RAISE EXCEPTION 'retry lost compatibility option';
  END IF;
  IF has_function_privilege('authenticated',
      'public.enqueue_scholar_translation_job_v2(uuid,uuid,uuid,uuid,text,text,text,text,text,boolean)','EXECUTE')
     OR has_function_privilege('authenticated',
      'public.retry_scholar_translation_job_v2(uuid,uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'ordinary account can mutate compatibility queue';
  END IF;
END $probe$;
ROLLBACK;
