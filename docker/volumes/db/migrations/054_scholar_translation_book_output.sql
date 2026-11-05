-- Book translations publish a single Chinese EPUB instead of derived PDFs.
-- The request records the caller's document-type preference; the worker may
-- resolve `auto` to either pipeline at run time.
BEGIN;

ALTER TABLE public.scholar_translation_outputs
  DROP CONSTRAINT IF EXISTS scholar_translation_outputs_kind_check;
ALTER TABLE public.scholar_translation_outputs
  ADD CONSTRAINT scholar_translation_outputs_kind_check
  CHECK (kind IN ('mono','dual','epub'));

CREATE FUNCTION public.enqueue_scholar_translation_job_v5(
  p_job_id uuid,p_user_id uuid,p_source_file_id uuid,p_source_version_id uuid,
  p_idempotency_key uuid,p_mode text,p_target_language text,
  p_engine text,p_model text,p_model_provider text,p_model_config_fingerprint text,
  p_model_config_nonce text,p_model_config_ciphertext text,p_model_config_auth_tag text,
  p_glossary_sha256 text,p_white_background_compat boolean,p_white_background_pages text,
  p_document_type text
) RETURNS public.scholar_translation_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE source_row public.scholar_file_versions;
        requested jsonb; existing public.scholar_translation_jobs;
        active_count integer;
        document_type text;
BEGIN
  document_type:=COALESCE(p_document_type,'auto');
  IF p_job_id IS NULL OR p_user_id IS NULL OR p_source_file_id IS NULL OR p_source_version_id IS NULL
     OR p_idempotency_key IS NULL OR p_mode NOT IN ('mono','dual','both')
     OR p_target_language IS DISTINCT FROM 'zh-CN'
     OR p_engine IS DISTINCT FROM 'openai-compatible'
     OR p_model IS NULL OR length(p_model) NOT BETWEEN 1 AND 120
     OR p_model_provider NOT IN ('ai-gateway','openrouter')
     OR p_model_config_fingerprint !~ '^[0-9a-f]{64}$'
     OR p_model_config_nonce !~ '^[A-Za-z0-9+/]{16}$'
     OR p_model_config_auth_tag !~ '^[A-Za-z0-9+/]{22}==$'
     OR p_model_config_ciphertext IS NULL
     OR length(p_model_config_ciphertext) NOT BETWEEN 4 AND 8192
     OR p_model_config_ciphertext !~ '^[A-Za-z0-9+/]+={0,2}$'
     OR p_white_background_compat IS NULL
     OR (p_white_background_pages IS NOT NULL AND (
       p_white_background_compat IS NOT TRUE OR length(p_white_background_pages) > 120
       OR p_white_background_pages !~ '^[1-9][0-9]*(-[1-9][0-9]*)?(,[1-9][0-9]*(-[1-9][0-9]*)?)*$'))
     OR (p_glossary_sha256 IS NOT NULL AND p_glossary_sha256 !~ '^[0-9a-f]{64}$')
     OR document_type NOT IN ('auto','paper','book')
     OR (document_type='book' AND p_mode<>'mono')
  THEN RAISE EXCEPTION 'invalid translation request' USING ERRCODE='22023'; END IF;
  requested:=jsonb_build_object(
    'sourceFileId',p_source_file_id,'sourceVersionId',p_source_version_id,
    'mode',p_mode,'targetLanguage',p_target_language,'engine',p_engine,
    'model',p_model,'modelProvider',p_model_provider,
    'modelConfigFingerprint',p_model_config_fingerprint,
    'glossarySha256',p_glossary_sha256,
    'whiteBackgroundCompatibility',p_white_background_compat,
    'whiteBackgroundPages',p_white_background_pages,
    'documentType',document_type);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text,3817));
  SELECT * INTO existing FROM public.scholar_translation_jobs
    WHERE user_id=p_user_id AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF (existing.request_options || jsonb_build_object(
      'whiteBackgroundCompatibility',COALESCE(
        (existing.request_options->>'whiteBackgroundCompatibility')::boolean,false),
      'whiteBackgroundPages',existing.request_options->>'whiteBackgroundPages',
      'documentType',COALESCE(existing.request_options->>'documentType','auto')))
       IS DISTINCT FROM requested THEN
      RAISE EXCEPTION 'idempotency key reused with different request' USING ERRCODE='PT409';
    END IF;
    RETURN existing;
  END IF;
  SELECT v.* INTO source_row FROM public.scholar_file_versions v
    JOIN public.scholar_document_files df
      ON df.user_id=v.user_id AND df.file_id=v.file_id
    JOIN public.files f ON f.user_id=v.user_id AND f.id=v.file_id
    WHERE v.user_id=p_user_id AND v.file_id=p_source_file_id
      AND v.version_id=p_source_version_id AND v.state='ready'
      AND df.role IN ('original','version') AND f.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'source PDF not found' USING ERRCODE='42501'; END IF;
  IF source_row.file_size < 1 OR source_row.file_size > 104857600 THEN
    RAISE EXCEPTION 'source PDF exceeds translation limit' USING ERRCODE='PT413';
  END IF;
  SELECT count(*) INTO active_count FROM public.scholar_translation_jobs
    WHERE user_id=p_user_id AND state IN ('queued','running');
  IF active_count >= 2 THEN RAISE EXCEPTION 'translation queue is full' USING ERRCODE='PT429'; END IF;
  INSERT INTO public.scholar_translation_jobs (
    id,user_id,source_file_id,source_version_id,source_sha256,source_size,
    idempotency_key,request_options,mode,target_language,engine,model,glossary_sha256,
    model_config_nonce,model_config_ciphertext,model_config_auth_tag)
  VALUES (p_job_id,p_user_id,p_source_file_id,p_source_version_id,source_row.sha256,
          source_row.file_size,p_idempotency_key,requested,p_mode,p_target_language,
          p_engine,p_model,p_glossary_sha256,p_model_config_nonce,
          p_model_config_ciphertext,p_model_config_auth_tag)
  RETURNING * INTO existing;
  RETURN existing;
END; $$;
REVOKE ALL ON FUNCTION public.enqueue_scholar_translation_job_v5(
  uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,boolean,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_scholar_translation_job_v5(
  uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,boolean,text,text)
  TO service_role;

CREATE FUNCTION public.retry_scholar_translation_job_v5(
  p_job_id uuid,p_user_id uuid,p_prior_job_id uuid,p_idempotency_key uuid,
  p_model text,p_model_provider text,p_model_config_fingerprint text,
  p_model_config_nonce text,p_model_config_ciphertext text,p_model_config_auth_tag text
) RETURNS public.scholar_translation_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE prior_job public.scholar_translation_jobs;
        next_job public.scholar_translation_jobs;
BEGIN
  SELECT * INTO prior_job FROM public.scholar_translation_jobs
    WHERE user_id=p_user_id AND id=p_prior_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'translation job not found' USING ERRCODE='42501'; END IF;
  IF prior_job.state NOT IN ('failed','canceled') THEN
    RAISE EXCEPTION 'only failed or canceled jobs can be retried' USING ERRCODE='PT409';
  END IF;
  SELECT * INTO next_job FROM public.enqueue_scholar_translation_job_v5(
    p_job_id,p_user_id,prior_job.source_file_id,prior_job.source_version_id,
    p_idempotency_key,prior_job.mode,prior_job.target_language,
    prior_job.engine,p_model,p_model_provider,p_model_config_fingerprint,
    p_model_config_nonce,p_model_config_ciphertext,p_model_config_auth_tag,
    prior_job.glossary_sha256,
    COALESCE((prior_job.request_options->>'whiteBackgroundCompatibility')::boolean,false),
    prior_job.request_options->>'whiteBackgroundPages',
    COALESCE(prior_job.request_options->>'documentType','auto'));
  IF next_job.id<>prior_job.id AND next_job.retry_of IS NULL THEN
    UPDATE public.scholar_translation_jobs SET retry_of=prior_job.id
      WHERE id=next_job.id RETURNING * INTO next_job;
  END IF;
  RETURN next_job;
END; $$;
REVOKE ALL ON FUNCTION public.retry_scholar_translation_job_v5(
  uuid,uuid,uuid,uuid,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.retry_scholar_translation_job_v5(
  uuid,uuid,uuid,uuid,text,text,text,text,text,text) TO service_role;

CREATE FUNCTION public.publish_scholar_translation_outputs_v2(
  p_job_id uuid,p_lease_token uuid,p_outputs jsonb,p_engine_version text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job public.scholar_translation_jobs;
        document_id uuid;
        item jsonb;
        kind text;
        object_key text;
        digest text;
        size_bytes bigint;
        pages integer;
        created_file uuid;
        expected_count integer;
        is_book boolean;
        expected_key text;
BEGIN
  SELECT * INTO job FROM public.scholar_translation_jobs
    WHERE id=p_job_id AND state='running' AND lease_token=p_lease_token
      AND lease_until>=now() AND NOT cancel_requested
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF jsonb_typeof(p_outputs)<>'array' OR jsonb_array_length(p_outputs)=0
  THEN RAISE EXCEPTION 'invalid translation output metadata' USING ERRCODE='22023'; END IF;
  is_book:=jsonb_array_length(p_outputs)=1 AND (p_outputs->0->>'kind')='epub';
  expected_count:=CASE WHEN is_book THEN 1 WHEN job.mode='both' THEN 2 ELSE 1 END;
  IF jsonb_array_length(p_outputs)<>expected_count
     OR p_engine_version IS NULL OR length(p_engine_version) NOT BETWEEN 1 AND 80
  THEN RAISE EXCEPTION 'invalid translation output metadata' USING ERRCODE='22023'; END IF;

  SELECT df.document_id INTO document_id
    FROM public.scholar_document_files df
    JOIN public.scholar_file_versions v
      ON v.user_id=df.user_id AND v.file_id=df.file_id
    JOIN public.files f ON f.user_id=df.user_id AND f.id=df.file_id
    WHERE df.user_id=job.user_id AND df.file_id=job.source_file_id
      AND df.role IN ('original','version')
      AND v.version_id=job.source_version_id AND v.state='ready'
      AND v.sha256=job.source_sha256 AND f.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_outputs) LOOP
    kind:=item->>'kind';
    object_key:=item->>'objectKey';
    digest:=item->>'sha256';
    IF kind='epub' THEN
      IF is_book IS NOT TRUE OR job.mode<>'mono' THEN
        RAISE EXCEPTION 'invalid translation output metadata' USING ERRCODE='22023';
      END IF;
      expected_key:=job.user_id::text || '/Scholar/translations/' || job.id::text || '/book.epub';
    ELSE
      IF is_book OR kind NOT IN ('mono','dual') OR (job.mode<>'both' AND kind<>job.mode) THEN
        RAISE EXCEPTION 'invalid translation output metadata' USING ERRCODE='22023';
      END IF;
      expected_key:=job.user_id::text || '/Scholar/translations/' || job.id::text || '/' || kind || '.pdf';
    END IF;
    IF object_key IS DISTINCT FROM expected_key
       OR digest IS NULL OR digest !~ '^[0-9a-f]{64}$'
       OR digest=job.source_sha256
       OR (item->>'fileSize') !~ '^[0-9]{1,10}$'
       OR (item->>'pageCount') !~ '^[0-9]{1,4}$'
    THEN RAISE EXCEPTION 'invalid translation output metadata' USING ERRCODE='22023'; END IF;
    size_bytes:=(item->>'fileSize')::bigint;
    pages:=(item->>'pageCount')::integer;
    IF size_bytes<1
       OR size_bytes > (CASE WHEN kind='epub' THEN 268435456 ELSE 209715200 END)
       OR pages<1 OR pages>1000 THEN
      RAISE EXCEPTION 'translated output exceeds limit' USING ERRCODE='PT413';
    END IF;
    INSERT INTO public.files(user_id,file_key,file_size)
      VALUES(job.user_id,object_key,size_bytes)
      RETURNING id INTO created_file;
    INSERT INTO public.scholar_document_files(user_id,document_id,file_id,role)
      VALUES(job.user_id,document_id,created_file,'translation');
    INSERT INTO public.scholar_translation_outputs
      (user_id,job_id,kind,file_id,object_key,sha256,file_size,page_count)
      VALUES(job.user_id,job.id,kind,created_file,object_key,digest,size_bytes,pages);
  END LOOP;
  UPDATE public.scholar_translation_jobs SET
    state='succeeded',progress=100,lease_token=NULL,lease_until=NULL,
    worker_id=NULL,cancel_requested=false,engine_version=p_engine_version,
    finished_at=now(),updated_at=now()
  WHERE id=job.id;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.publish_scholar_translation_outputs_v2(uuid,uuid,jsonb,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_scholar_translation_outputs_v2(uuid,uuid,jsonb,text)
  TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
