-- Publish verified derived PDFs atomically with their document attachments.
-- The isolated worker verifies S3 object bytes and PDF parseability before
-- invoking this service-role-only function.
BEGIN;

CREATE FUNCTION public.publish_scholar_translation_outputs_v1(
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
BEGIN
  SELECT * INTO job FROM public.scholar_translation_jobs
    WHERE id=p_job_id AND state='running' AND lease_token=p_lease_token
      AND lease_until>=now() AND NOT cancel_requested
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  expected_count:=CASE WHEN job.mode='both' THEN 2 ELSE 1 END;
  IF jsonb_typeof(p_outputs)<>'array'
     OR jsonb_array_length(p_outputs)<>expected_count
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
    IF kind NOT IN ('mono','dual')
       OR (job.mode<>'both' AND kind<>job.mode)
       OR object_key IS DISTINCT FROM
         job.user_id::text || '/Scholar/translations/' || job.id::text || '/' || kind || '.pdf'
       OR digest IS NULL OR digest !~ '^[0-9a-f]{64}$'
       OR digest=job.source_sha256
       OR (item->>'fileSize') !~ '^[0-9]{1,10}$'
       OR (item->>'pageCount') !~ '^[0-9]{1,4}$'
    THEN RAISE EXCEPTION 'invalid translation output metadata' USING ERRCODE='22023'; END IF;
    size_bytes:=(item->>'fileSize')::bigint;
    pages:=(item->>'pageCount')::integer;
    IF size_bytes<1 OR size_bytes>209715200 OR pages<1 OR pages>1000 THEN
      RAISE EXCEPTION 'translated PDF exceeds output limit' USING ERRCODE='PT413';
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
REVOKE ALL ON FUNCTION public.publish_scholar_translation_outputs_v1(uuid,uuid,jsonb,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_scholar_translation_outputs_v1(uuid,uuid,jsonb,text)
  TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
