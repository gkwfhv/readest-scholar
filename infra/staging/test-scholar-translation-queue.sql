-- Synthetic staging database only. The transaction leaves no rows behind.
\set ON_ERROR_STOP on
SELECT id AS actor_id FROM auth.users ORDER BY id LIMIT 1 \gset
SELECT id AS other_id FROM auth.users WHERE id<>:'actor_id' ORDER BY id LIMIT 1 \gset
SELECT gen_random_uuid() AS document_id, gen_random_uuid() AS file_id,
       gen_random_uuid() AS version_id, gen_random_uuid() AS upload_id,
       gen_random_uuid() AS request_id, gen_random_uuid() AS retry_id \gset
BEGIN;
INSERT INTO public.scholar_documents(user_id,id) VALUES (:'actor_id', :'document_id');
INSERT INTO public.files(user_id,id,file_key,file_size)
  VALUES (:'actor_id', :'file_id', :'actor_id' || '/Scholar/translation-probe.pdf', 24);
INSERT INTO public.scholar_document_files(user_id,document_id,file_id,role)
  VALUES (:'actor_id', :'document_id', :'file_id', 'original');
INSERT INTO public.scholar_file_versions
  (user_id,file_id,version_id,op_id,object_key,sha256,file_size,state)
  VALUES (:'actor_id', :'file_id', :'version_id', :'upload_id',
          :'actor_id' || '/Scholar/versions/' || :'version_id' || '.pdf',
          repeat('a',64), 24, 'ready');
SELECT id AS job_id FROM public.enqueue_scholar_translation_job_v1(
  :'actor_id', :'file_id', :'version_id', :'request_id',
  'dual', 'zh-CN', 'openai-compatible', 'local-model', NULL) \gset
SELECT set_config('probe.actor_id', :'actor_id', true),
       set_config('probe.file_id', :'file_id', true),
       set_config('probe.version_id', :'version_id', true),
       set_config('probe.request_id', :'request_id', true),
       set_config('probe.job_id', :'job_id', true);
DO $probe$
DECLARE duplicate public.scholar_translation_jobs; collision boolean:=false;
BEGIN
  SELECT * INTO duplicate FROM public.enqueue_scholar_translation_job_v1(
    current_setting('probe.actor_id')::uuid,
    current_setting('probe.file_id')::uuid,
    current_setting('probe.version_id')::uuid,
    current_setting('probe.request_id')::uuid,
    'dual','zh-CN','openai-compatible','local-model',NULL);
  IF duplicate.id <> current_setting('probe.job_id')::uuid THEN
    RAISE EXCEPTION 'duplicate delivery created another job';
  END IF;
  BEGIN
    PERFORM public.enqueue_scholar_translation_job_v1(
      current_setting('probe.actor_id')::uuid,
      current_setting('probe.file_id')::uuid,
      current_setting('probe.version_id')::uuid,
      current_setting('probe.request_id')::uuid,
      'mono','zh-CN','openai-compatible','local-model',NULL);
  EXCEPTION WHEN SQLSTATE 'PT409' THEN collision:=true;
  END;
  IF NOT collision THEN RAISE EXCEPTION 'idempotency collision accepted'; END IF;
END $probe$;
-- The worker can claim once; cancellation prevents a stale success.
SELECT id AS claimed_id, lease_token AS token
  FROM public.claim_scholar_translation_job_v1('synthetic-worker', 60) \gset
SELECT set_config('probe.claimed_id', :'claimed_id', true),
       set_config('probe.token', :'token', true);
DO $probe$ BEGIN
  IF current_setting('probe.claimed_id')::uuid <> current_setting('probe.job_id')::uuid
     OR current_setting('probe.token',true) IS NULL THEN
    RAISE EXCEPTION 'worker did not claim the queued job';
  END IF;
END $probe$;
SELECT state AS cancel_state
  FROM public.cancel_scholar_translation_job_v1(:'actor_id', :'job_id') \gset
SELECT set_config('probe.cancel_state', :'cancel_state', true);
DO $probe$ BEGIN
  IF current_setting('probe.cancel_state') <> 'running' THEN
    RAISE EXCEPTION 'running job did not request cancellation';
  END IF;
  IF public.finish_scholar_translation_job_v1(
       current_setting('probe.job_id')::uuid,current_setting('probe.token')::uuid,
       'succeeded',NULL) THEN
    RAISE EXCEPTION 'canceled work was marked successful';
  END IF;
  IF NOT public.finish_scholar_translation_job_v1(
       current_setting('probe.job_id')::uuid,current_setting('probe.token')::uuid,
       'canceled',NULL) THEN
    RAISE EXCEPTION 'worker could not acknowledge cancellation';
  END IF;
  IF public.finish_scholar_translation_job_v1(
       current_setting('probe.job_id')::uuid,current_setting('probe.token')::uuid,
       'succeeded',NULL) THEN
    RAISE EXCEPTION 'old worker overwrote terminal state';
  END IF;
END $probe$;
SELECT id AS retried_id FROM public.retry_scholar_translation_job_v1(
  :'actor_id', :'job_id', :'retry_id') \gset
SELECT set_config('probe.retried_id', :'retried_id', true);
DO $probe$ BEGIN
  IF current_setting('probe.retried_id')::uuid = current_setting('probe.job_id')::uuid THEN
    RAISE EXCEPTION 'retry mutated terminal job';
  END IF;
  IF (SELECT state FROM public.scholar_translation_jobs
      WHERE id=current_setting('probe.job_id')::uuid) <> 'canceled' THEN
    RAISE EXCEPTION 'terminal job changed during retry';
  END IF;
END $probe$;
DO $probe$ BEGIN
  IF has_function_privilege('authenticated',
     'public.claim_scholar_translation_job_v1(text,integer)','EXECUTE')
     OR has_function_privilege('authenticated',
     'public.enqueue_scholar_translation_job_v1(uuid,uuid,uuid,uuid,text,text,text,text,text)','EXECUTE')
  THEN RAISE EXCEPTION 'ordinary client can mutate translation queue'; END IF;
END $probe$;
-- A dead worker lease fails visibly; it is not silently restarted or held forever.
SELECT id AS retry_claimed FROM public.claim_scholar_translation_job_v1('synthetic-worker',60) \gset
UPDATE public.scholar_translation_jobs SET lease_until=now()-interval '1 second'
  WHERE id=:'retry_claimed';
SELECT public.claim_scholar_translation_job_v1('another-worker',60);
DO $probe$ BEGIN
  IF (SELECT state FROM public.scholar_translation_jobs WHERE id=current_setting('probe.retried_id')::uuid) <> 'failed'
     OR (SELECT error_code FROM public.scholar_translation_jobs WHERE id=current_setting('probe.retried_id')::uuid) <> 'worker_lease_expired' THEN
    RAISE EXCEPTION 'expired worker lease left a stuck task';
  END IF;
END $probe$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'other_id', true);
DO $probe$ BEGIN
  IF EXISTS (SELECT 1 FROM public.scholar_translation_jobs
      WHERE id=current_setting('probe.job_id')::uuid) THEN
    RAISE EXCEPTION 'other account read translation job';
  END IF;
END $probe$;
RESET ROLE;
ROLLBACK;
