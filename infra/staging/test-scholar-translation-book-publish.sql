-- Synthetic staging database only; book publication metadata is rolled back.
-- Exercises publish_scholar_translation_outputs_v2 with the book pipeline.
\set ON_ERROR_STOP on
SELECT id AS actor_id FROM auth.users ORDER BY id LIMIT 1 \gset
SELECT gen_random_uuid() AS document_id,gen_random_uuid() AS file_id,
       gen_random_uuid() AS version_id,gen_random_uuid() AS op_id \gset
BEGIN;
INSERT INTO public.scholar_documents(user_id,id) VALUES (:'actor_id',:'document_id');
INSERT INTO public.files(user_id,id,file_key,file_size)
  VALUES (:'actor_id',:'file_id',:'actor_id' || '/Scholar/book-probe.pdf',24);
INSERT INTO public.scholar_document_files(user_id,document_id,file_id,role)
  VALUES (:'actor_id',:'document_id',:'file_id','original');
INSERT INTO public.scholar_file_versions
  (user_id,file_id,version_id,op_id,object_key,sha256,file_size,state)
  VALUES (:'actor_id',:'file_id',:'version_id',:'op_id',
          :'actor_id' || '/Scholar/versions/' || :'version_id' || '.pdf',
          repeat('a',64),24,'ready');

SELECT id AS book_job FROM public.enqueue_scholar_translation_job_v5(
  gen_random_uuid(),:'actor_id',:'file_id',:'version_id',gen_random_uuid(),
  'mono','zh-CN','openai-compatible','local-model','ai-gateway',
  repeat('a',64),'AAAAAAAAAAAAAAAA','AAAA','AAAAAAAAAAAAAAAAAAAAAA==',
  NULL,false,NULL,'book') \gset
SELECT lease_token AS book_token FROM public.claim_scholar_translation_job_v1(
  'synthetic-book-worker',60) \gset
SELECT set_config('probe.job_id', :'book_job', true),
       set_config('probe.token', :'book_token', true),
       set_config('probe.actor_id', :'actor_id', true);

DO $probe$
DECLARE rejected boolean:=false;
BEGIN
  BEGIN
    PERFORM public.publish_scholar_translation_outputs_v2(
      current_setting('probe.job_id')::uuid,
      current_setting('probe.token')::uuid,
      jsonb_build_array(jsonb_build_object(
        'kind','epub',
        'objectKey',current_setting('probe.actor_id') ||
          '/Scholar/translations/' || current_setting('probe.job_id') || '/mono.pdf',
        'sha256',repeat('d',64),'fileSize',4096,'pageCount',42)),
      'scholar-book/1.0.0');
  EXCEPTION WHEN invalid_parameter_value THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'book output accepted a PDF object key'; END IF;
  IF EXISTS (SELECT 1 FROM public.scholar_translation_outputs
       WHERE job_id=current_setting('probe.job_id')::uuid) THEN
    RAISE EXCEPTION 'rejected book publication left an output row';
  END IF;
END $probe$;

SELECT public.publish_scholar_translation_outputs_v2(
  :'book_job',:'book_token',
  jsonb_build_array(jsonb_build_object(
    'kind','epub',
    'objectKey',:'actor_id' || '/Scholar/translations/' || :'book_job' || '/book.epub',
    'sha256',repeat('d',64),'fileSize',4096,'pageCount',42)),
  'scholar-book/1.0.0') AS published \gset
SELECT set_config('probe.published', :'published', true),
       set_config('probe.document_id', :'document_id', true);
DO $probe$ BEGIN
  IF NOT current_setting('probe.published')::boolean THEN
    RAISE EXCEPTION 'valid book EPUB output not published';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.scholar_translation_outputs o
      JOIN public.scholar_document_files df
        ON df.user_id=o.user_id AND df.file_id=o.file_id
    WHERE o.job_id=current_setting('probe.job_id')::uuid AND o.kind='epub'
      AND df.role='translation'
      AND df.document_id=current_setting('probe.document_id')::uuid
  ) THEN RAISE EXCEPTION 'book EPUB not linked to the source document'; END IF;
END $probe$;

-- A paper job must not be able to publish an EPUB.
SELECT id AS paper_job FROM public.enqueue_scholar_translation_job_v5(
  gen_random_uuid(),:'actor_id',:'file_id',:'version_id',gen_random_uuid(),
  'mono','zh-CN','openai-compatible','local-model','ai-gateway',
  repeat('a',64),'AAAAAAAAAAAAAAAA','AAAA','AAAAAAAAAAAAAAAAAAAAAA==',
  NULL,false,NULL,'paper') \gset
SELECT lease_token AS paper_token FROM public.claim_scholar_translation_job_v1(
  'synthetic-paper-worker',60) \gset
SELECT set_config('probe.paper_job', :'paper_job', true),
       set_config('probe.paper_token', :'paper_token', true);
DO $probe$
DECLARE rejected boolean:=false;
BEGIN
  BEGIN
    PERFORM public.publish_scholar_translation_outputs_v2(
      current_setting('probe.paper_job')::uuid,
      current_setting('probe.paper_token')::uuid,
      jsonb_build_array(jsonb_build_object(
        'kind','epub',
        'objectKey',current_setting('probe.actor_id') ||
          '/Scholar/translations/' || current_setting('probe.paper_job') || '/book.epub',
        'sha256',repeat('d',64),'fileSize',4096,'pageCount',42)),
      'scholar-book/1.0.0');
  EXCEPTION WHEN invalid_parameter_value THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'paper job published an EPUB output'; END IF;
END $probe$;
ROLLBACK;
