-- Phase 6: durable translation queue. The API owns authorization; only service_role
-- may mutate these rows or invoke queue operations. All file references are
-- scoped by the same user ID.
BEGIN;

CREATE TABLE public.scholar_translation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_file_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_size bigint NOT NULL CHECK (source_size > 0 AND source_size <= 104857600),
  idempotency_key uuid NOT NULL,
  request_options jsonb NOT NULL,
  mode text NOT NULL CHECK (mode IN ('mono','dual','both')),
  target_language text NOT NULL CHECK (target_language = 'zh-CN'),
  engine text NOT NULL CHECK (engine = 'openai-compatible'),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 120),
  glossary_sha256 text CHECK (glossary_sha256 IS NULL OR glossary_sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued','running','succeeded','failed','canceled')),
  progress smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 3),
  worker_id text,
  lease_token uuid,
  lease_until timestamptz,
  cancel_requested boolean NOT NULL DEFAULT false,
  error_code text,
  engine_version text,
  retry_of uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (user_id,id),
  UNIQUE (user_id,idempotency_key),
  FOREIGN KEY (user_id,source_file_id)
    REFERENCES public.scholar_document_files(user_id,file_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id,source_file_id,source_version_id)
    REFERENCES public.scholar_file_versions(user_id,file_id,version_id),
  FOREIGN KEY (user_id,retry_of)
    REFERENCES public.scholar_translation_jobs(user_id,id),
  CHECK ((state='running') = (lease_token IS NOT NULL)),
  CHECK ((state='running') = (lease_until IS NOT NULL)),
  CHECK (NOT cancel_requested OR state='running')
);
CREATE INDEX scholar_translation_jobs_claim
  ON public.scholar_translation_jobs(state,created_at,id)
  WHERE state IN ('queued','running');
CREATE INDEX scholar_translation_jobs_source
  ON public.scholar_translation_jobs(user_id,source_file_id,created_at DESC);

CREATE TABLE public.scholar_translation_outputs (
  user_id uuid NOT NULL,
  job_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('mono','dual')),
  file_id uuid NOT NULL,
  object_key text NOT NULL UNIQUE,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  file_size bigint NOT NULL CHECK (file_size > 0),
  page_count integer NOT NULL CHECK (page_count > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,job_id,kind),
  UNIQUE (user_id,file_id),
  FOREIGN KEY (user_id,job_id)
    REFERENCES public.scholar_translation_jobs(user_id,id) ON DELETE CASCADE,
  FOREIGN KEY (user_id,file_id)
    REFERENCES public.scholar_document_files(user_id,file_id) ON DELETE CASCADE,
  CHECK (object_key LIKE user_id::text || '/Scholar/translations/%')
);
ALTER TABLE public.scholar_translation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scholar_translation_outputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY scholar_translation_jobs_owner ON public.scholar_translation_jobs
  FOR SELECT TO authenticated USING ((SELECT auth.uid())=user_id);
CREATE POLICY scholar_translation_outputs_owner ON public.scholar_translation_outputs
  FOR SELECT TO authenticated USING ((SELECT auth.uid())=user_id);
REVOKE ALL ON public.scholar_translation_jobs,public.scholar_translation_outputs
  FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.scholar_translation_jobs,public.scholar_translation_outputs
  TO authenticated;
GRANT ALL ON public.scholar_translation_jobs,public.scholar_translation_outputs
  TO service_role;

CREATE FUNCTION public.scholar_translation_terminal_guard_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state IN ('succeeded','failed','canceled') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'translation terminal state is immutable' USING ERRCODE='PT409';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER scholar_translation_terminal_guard
  BEFORE UPDATE ON public.scholar_translation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.scholar_translation_terminal_guard_v1();

CREATE FUNCTION public.enqueue_scholar_translation_job_v1(
  p_user_id uuid,p_source_file_id uuid,p_source_version_id uuid,
  p_idempotency_key uuid,p_mode text,p_target_language text,
  p_engine text,p_model text,p_glossary_sha256 text
) RETURNS public.scholar_translation_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE source_row public.scholar_file_versions;
        requested jsonb; existing public.scholar_translation_jobs;
        active_count integer;
BEGIN
  IF p_user_id IS NULL OR p_source_file_id IS NULL OR p_source_version_id IS NULL
     OR p_idempotency_key IS NULL OR p_mode NOT IN ('mono','dual','both')
     OR p_target_language IS DISTINCT FROM 'zh-CN'
     OR p_engine IS DISTINCT FROM 'openai-compatible'
     OR p_model IS NULL OR length(p_model) NOT BETWEEN 1 AND 120
     OR (p_glossary_sha256 IS NOT NULL AND p_glossary_sha256 !~ '^[0-9a-f]{64}$')
  THEN RAISE EXCEPTION 'invalid translation request' USING ERRCODE='22023'; END IF;
  requested:=jsonb_build_object(
    'sourceFileId',p_source_file_id,'sourceVersionId',p_source_version_id,
    'mode',p_mode,'targetLanguage',p_target_language,'engine',p_engine,
    'model',p_model,'glossarySha256',p_glossary_sha256);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text,3817));
  SELECT * INTO existing FROM public.scholar_translation_jobs
    WHERE user_id=p_user_id AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF existing.request_options IS DISTINCT FROM requested THEN
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
  IF active_count >= 2 THEN
    RAISE EXCEPTION 'translation queue is full' USING ERRCODE='PT429';
  END IF;
  INSERT INTO public.scholar_translation_jobs (
    user_id,source_file_id,source_version_id,source_sha256,source_size,
    idempotency_key,request_options,mode,target_language,engine,model,glossary_sha256)
  VALUES (p_user_id,p_source_file_id,p_source_version_id,source_row.sha256,
          source_row.file_size,p_idempotency_key,requested,p_mode,p_target_language,
          p_engine,p_model,p_glossary_sha256)
  RETURNING * INTO existing;
  RETURN existing;
END; $$;
REVOKE ALL ON FUNCTION public.enqueue_scholar_translation_job_v1(
  uuid,uuid,uuid,uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_scholar_translation_job_v1(
  uuid,uuid,uuid,uuid,text,text,text,text,text) TO service_role;

CREATE FUNCTION public.claim_scholar_translation_job_v1(
  p_worker_id text,p_lease_seconds integer
) RETURNS public.scholar_translation_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE candidate uuid; claimed public.scholar_translation_jobs;
BEGIN
  IF p_worker_id IS NULL OR length(p_worker_id) NOT BETWEEN 1 AND 120
     OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 10 AND 300 THEN
    RAISE EXCEPTION 'invalid worker lease' USING ERRCODE='22023';
  END IF;
  -- Expired leases become visible failures for explicit retry. This avoids
  -- automatically starting a second billable model call after a crash.
  UPDATE public.scholar_translation_jobs SET
    state='failed',error_code='worker_lease_expired',lease_token=NULL,
    lease_until=NULL,worker_id=NULL,cancel_requested=false,
    finished_at=now(),updated_at=now()
  WHERE state='running' AND lease_until < now();
  SELECT id INTO candidate FROM public.scholar_translation_jobs
    WHERE state='queued' ORDER BY created_at,id
    FOR UPDATE SKIP LOCKED LIMIT 1;
  IF candidate IS NULL THEN RETURN NULL; END IF;
  UPDATE public.scholar_translation_jobs SET
    state='running',attempt=attempt+1,worker_id=p_worker_id,
    lease_token=gen_random_uuid(),
    lease_until=now()+make_interval(secs=>p_lease_seconds),
    started_at=now(),updated_at=now()
  WHERE id=candidate RETURNING * INTO claimed;
  RETURN claimed;
END; $$;
REVOKE ALL ON FUNCTION public.claim_scholar_translation_job_v1(text,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_scholar_translation_job_v1(text,integer)
  TO service_role;

CREATE FUNCTION public.renew_scholar_translation_lease_v1(
  p_job_id uuid,p_lease_token uuid,p_progress integer,p_lease_seconds integer
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE updated_job uuid;
BEGIN
  IF p_progress IS NULL OR p_progress NOT BETWEEN 0 AND 99
     OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 10 AND 300 THEN
    RETURN false;
  END IF;
  UPDATE public.scholar_translation_jobs SET
    progress=GREATEST(progress,p_progress),
    lease_until=now()+make_interval(secs=>p_lease_seconds),updated_at=now()
  WHERE id=p_job_id AND state='running' AND lease_token=p_lease_token
    AND lease_until>=now() AND NOT cancel_requested
  RETURNING id INTO updated_job;
  RETURN updated_job IS NOT NULL;
END; $$;
REVOKE ALL ON FUNCTION public.renew_scholar_translation_lease_v1(uuid,uuid,integer,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.renew_scholar_translation_lease_v1(uuid,uuid,integer,integer)
  TO service_role;

CREATE FUNCTION public.cancel_scholar_translation_job_v1(
  p_user_id uuid,p_job_id uuid
) RETURNS public.scholar_translation_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job public.scholar_translation_jobs;
BEGIN
  SELECT * INTO job FROM public.scholar_translation_jobs
    WHERE user_id=p_user_id AND id=p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'translation job not found' USING ERRCODE='42501'; END IF;
  IF job.state='queued' THEN
    UPDATE public.scholar_translation_jobs SET state='canceled',progress=0,
      finished_at=now(),updated_at=now()
    WHERE id=p_job_id RETURNING * INTO job;
  ELSIF job.state='running' THEN
    UPDATE public.scholar_translation_jobs SET cancel_requested=true,updated_at=now()
    WHERE id=p_job_id RETURNING * INTO job;
  END IF;
  RETURN job;
END; $$;
REVOKE ALL ON FUNCTION public.cancel_scholar_translation_job_v1(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_scholar_translation_job_v1(uuid,uuid)
  TO service_role;

CREATE FUNCTION public.finish_scholar_translation_job_v1(
  p_job_id uuid,p_lease_token uuid,p_state text,p_error_code text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job public.scholar_translation_jobs;
        expected integer; actual integer;
BEGIN
  IF p_state NOT IN ('succeeded','failed','canceled') THEN RETURN false; END IF;
  SELECT * INTO job FROM public.scholar_translation_jobs
    WHERE id=p_job_id AND state='running' AND lease_token=p_lease_token
      AND lease_until>=now() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF job.cancel_requested AND p_state <> 'canceled' THEN RETURN false; END IF;
  IF p_state='succeeded' THEN
    expected:=CASE WHEN job.mode='both' THEN 2 ELSE 1 END;
    SELECT count(*) INTO actual FROM public.scholar_translation_outputs
      WHERE user_id=job.user_id AND job_id=job.id
        AND (job.mode='both' OR kind=job.mode);
    IF actual<>expected THEN RETURN false; END IF;
  END IF;
  UPDATE public.scholar_translation_jobs SET
    state=p_state,progress=CASE WHEN p_state='succeeded' THEN 100 ELSE progress END,
    lease_token=NULL,lease_until=NULL,worker_id=NULL,cancel_requested=false,
    error_code=CASE WHEN p_state='failed' THEN left(p_error_code,120) ELSE NULL END,
    finished_at=now(),updated_at=now()
  WHERE id=job.id;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.finish_scholar_translation_job_v1(uuid,uuid,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_scholar_translation_job_v1(uuid,uuid,text,text)
  TO service_role;

CREATE FUNCTION public.retry_scholar_translation_job_v1(
  p_user_id uuid,p_job_id uuid,p_idempotency_key uuid
) RETURNS public.scholar_translation_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE prior_job public.scholar_translation_jobs;
        next_job public.scholar_translation_jobs;
BEGIN
  SELECT * INTO prior_job FROM public.scholar_translation_jobs
    WHERE user_id=p_user_id AND id=p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'translation job not found' USING ERRCODE='42501'; END IF;
  IF prior_job.state NOT IN ('failed','canceled') THEN
    RAISE EXCEPTION 'only failed or canceled jobs can be retried' USING ERRCODE='PT409';
  END IF;
  SELECT * INTO next_job FROM public.enqueue_scholar_translation_job_v1(
    p_user_id,prior_job.source_file_id,prior_job.source_version_id,
    p_idempotency_key,prior_job.mode,prior_job.target_language,
    prior_job.engine,prior_job.model,prior_job.glossary_sha256);
  IF next_job.id<>prior_job.id AND next_job.retry_of IS NULL THEN
    UPDATE public.scholar_translation_jobs SET retry_of=prior_job.id
      WHERE id=next_job.id RETURNING * INTO next_job;
  END IF;
  RETURN next_job;
END; $$;
REVOKE ALL ON FUNCTION public.retry_scholar_translation_job_v1(uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.retry_scholar_translation_job_v1(uuid,uuid,uuid)
  TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
