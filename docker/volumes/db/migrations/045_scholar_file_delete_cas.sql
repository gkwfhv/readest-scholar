-- Phase 3: delete a Scholar file only if the client reviewed its current head.
-- The logical file is tombstoned; immutable version objects remain retained.
BEGIN;

CREATE TABLE public.scholar_file_delete_ops (
  user_id uuid NOT NULL,
  file_id uuid NOT NULL,
  op_id uuid NOT NULL,
  expected_version_id uuid,
  active_version_id uuid,
  deleted_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, file_id, op_id),
  FOREIGN KEY (user_id, file_id)
    REFERENCES public.scholar_document_files(user_id, file_id) ON DELETE CASCADE
);
ALTER TABLE public.scholar_file_delete_ops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.scholar_file_delete_ops FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.scholar_file_delete_ops TO service_role;

CREATE FUNCTION public.delete_scholar_file_v1(
  p_file_key text, p_op_id uuid, p_expected_version_id uuid
) RETURNS TABLE(file_id uuid, active_version_id uuid, deleted_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); target public.files; prior public.scholar_file_delete_ops;
        current_version uuid; deletion_time timestamptz;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE='42501';
  END IF;
  IF p_op_id IS NULL OR p_file_key IS NULL OR
     split_part(p_file_key,'/',1)<>actor::text OR
     split_part(p_file_key,'/',2)<>'Readest' OR
     split_part(p_file_key,'/',3)<>'Books' OR
     split_part(p_file_key,'/',4)='' OR
     split_part(p_file_key,'/',5)='' OR
     split_part(p_file_key,'/',6)<>'' THEN
    RAISE EXCEPTION 'invalid Scholar delete request' USING ERRCODE='22023';
  END IF;

  -- Upload completion locks this same file row before comparing the head.
  -- This serializes a concurrent upload and delete in either order.
  SELECT f.* INTO target FROM public.files f
    WHERE f.user_id=actor AND f.file_key=p_file_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scholar file not found' USING ERRCODE='PT404';
  END IF;
  PERFORM 1 FROM public.scholar_document_files df
    WHERE df.user_id=actor AND df.file_id=target.id AND df.role='original';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scholar file not found' USING ERRCODE='PT404';
  END IF;

  SELECT d.* INTO prior FROM public.scholar_file_delete_ops d
    WHERE d.user_id=actor AND d.file_id=target.id AND d.op_id=p_op_id;
  IF FOUND THEN
    IF prior.expected_version_id IS DISTINCT FROM p_expected_version_id THEN
      RAISE EXCEPTION 'operation id reused for different version' USING ERRCODE='22023';
    END IF;
    RETURN QUERY SELECT target.id, prior.active_version_id, prior.deleted_at;
    RETURN;
  END IF;
  IF target.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Scholar file already deleted' USING ERRCODE='PT410';
  END IF;

  SELECT h.version_id INTO current_version FROM public.scholar_file_heads h
    WHERE h.user_id=actor AND h.file_id=target.id FOR UPDATE;
  IF current_version IS DISTINCT FROM p_expected_version_id THEN
    RAISE EXCEPTION 'Scholar file changed before deletion' USING ERRCODE='PT409';
  END IF;

  deletion_time:=now();
  UPDATE public.files f SET deleted_at=deletion_time, updated_at=deletion_time
    WHERE f.user_id=actor AND f.id=target.id;
  INSERT INTO public.scholar_file_delete_ops(
    user_id,file_id,op_id,expected_version_id,active_version_id,deleted_at
  ) VALUES (
    actor,target.id,p_op_id,p_expected_version_id,current_version,deletion_time
  );
  RETURN QUERY SELECT target.id,current_version,deletion_time;
END; $$;
REVOKE ALL ON FUNCTION public.delete_scholar_file_v1(text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_scholar_file_v1(text,uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
