-- Phase 3: retain immutable Scholar file objects and atomically choose the
-- current version. Bytes are verified by the server before complete() is called.
BEGIN;
CREATE TABLE public.scholar_file_versions (
  user_id uuid NOT NULL,
  file_id uuid NOT NULL,
  version_id uuid NOT NULL DEFAULT gen_random_uuid(),
  op_id uuid NOT NULL,
  object_key text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  file_size bigint NOT NULL CHECK (file_size >= 0),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','ready')),
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  PRIMARY KEY (user_id,file_id,version_id),
  UNIQUE (user_id,file_id,op_id),
  UNIQUE (object_key),
  FOREIGN KEY (user_id,file_id) REFERENCES public.scholar_document_files(user_id,file_id)
    ON DELETE CASCADE,
  CHECK (object_key LIKE user_id::text || '/Scholar/versions/%')
);
CREATE INDEX scholar_file_versions_recent ON public.scholar_file_versions(user_id,file_id,created_at DESC);
CREATE TABLE public.scholar_file_heads (
  user_id uuid NOT NULL,
  file_id uuid NOT NULL,
  version_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,file_id),
  FOREIGN KEY (user_id,file_id,version_id)
    REFERENCES public.scholar_file_versions(user_id,file_id,version_id)
);
ALTER TABLE public.scholar_file_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scholar_file_heads ENABLE ROW LEVEL SECURITY;
CREATE POLICY scholar_file_versions_owner ON public.scholar_file_versions
  FOR SELECT TO authenticated USING ((SELECT auth.uid())=user_id);
CREATE POLICY scholar_file_heads_owner ON public.scholar_file_heads
  FOR SELECT TO authenticated USING ((SELECT auth.uid())=user_id);
REVOKE ALL ON public.scholar_file_versions,public.scholar_file_heads FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.scholar_file_versions,public.scholar_file_heads TO authenticated;
GRANT ALL ON public.scholar_file_versions,public.scholar_file_heads TO service_role;

CREATE FUNCTION public.prepare_scholar_file_version_v1(
  p_file_id uuid,p_op_id uuid,p_sha256 text,p_file_size bigint
) RETURNS TABLE(version_id uuid,object_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); existing public.scholar_file_versions; next_id uuid;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE='42501'; END IF;
  IF p_op_id IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' OR p_file_size IS NULL OR p_file_size<0 THEN
    RAISE EXCEPTION 'invalid file version request' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.scholar_document_files df JOIN public.files f
    ON f.user_id=df.user_id AND f.id=df.file_id
    WHERE df.user_id=actor AND df.file_id=p_file_id AND f.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'file is not owned by account' USING ERRCODE='42501'; END IF;
  SELECT v.* INTO existing FROM public.scholar_file_versions v
    WHERE v.user_id=actor AND v.file_id=p_file_id AND v.op_id=p_op_id;
  IF FOUND THEN
    IF existing.sha256<>p_sha256 OR existing.file_size<>p_file_size THEN
      RAISE EXCEPTION 'operation id reused for different bytes' USING ERRCODE='22023';
    END IF;
    RETURN QUERY SELECT existing.version_id,existing.object_key;
    RETURN;
  END IF;
  next_id:=gen_random_uuid();
  INSERT INTO public.scholar_file_versions(user_id,file_id,version_id,op_id,object_key,sha256,file_size)
  VALUES(actor,p_file_id,next_id,p_op_id,actor::text||'/Scholar/versions/'||next_id::text,p_sha256,p_file_size)
  ON CONFLICT (user_id,file_id,op_id) DO NOTHING;
  SELECT v.* INTO existing FROM public.scholar_file_versions v
    WHERE v.user_id=actor AND v.file_id=p_file_id AND v.op_id=p_op_id;
  IF existing.sha256<>p_sha256 OR existing.file_size<>p_file_size THEN
    RAISE EXCEPTION 'operation id reused for different bytes' USING ERRCODE='22023';
  END IF;
  RETURN QUERY SELECT existing.version_id,existing.object_key;
END; $$;
REVOKE ALL ON FUNCTION public.prepare_scholar_file_version_v1(uuid,uuid,text,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.prepare_scholar_file_version_v1(uuid,uuid,text,bigint) TO authenticated;

-- Only the trusted API service may certify object bytes and publish a head.
CREATE FUNCTION public.complete_scholar_file_version_v1(
  p_user_id uuid,p_file_id uuid,p_op_id uuid,p_verified_sha256 text,
  p_verified_size bigint,p_expected_version_id uuid
) RETURNS TABLE(applied boolean,active_version_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE candidate public.scholar_file_versions; active uuid;
BEGIN
  PERFORM 1 FROM public.files f JOIN public.scholar_document_files df
    ON df.user_id=f.user_id AND df.file_id=f.id
    WHERE f.user_id=p_user_id AND f.id=p_file_id AND f.deleted_at IS NULL FOR UPDATE OF f;
  IF NOT FOUND THEN RAISE EXCEPTION 'file not found' USING ERRCODE='22023'; END IF;
  SELECT v.* INTO candidate FROM public.scholar_file_versions v
    WHERE v.user_id=p_user_id AND v.file_id=p_file_id AND v.op_id=p_op_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'upload operation not found' USING ERRCODE='22023'; END IF;
  IF candidate.sha256 IS DISTINCT FROM p_verified_sha256 OR
     candidate.file_size IS DISTINCT FROM p_verified_size THEN
    RAISE EXCEPTION 'verified bytes do not match prepared version' USING ERRCODE='23514';
  END IF;
  SELECT h.version_id INTO active FROM public.scholar_file_heads h
    WHERE h.user_id=p_user_id AND h.file_id=p_file_id;
  IF candidate.state='ready' THEN
    RETURN QUERY SELECT active IS NOT DISTINCT FROM candidate.version_id,active;
    RETURN;
  END IF;
  UPDATE public.scholar_file_versions v SET state='ready',verified_at=now()
    WHERE v.user_id=p_user_id AND v.file_id=p_file_id AND v.version_id=candidate.version_id;
  IF p_expected_version_id IS NULL THEN
    INSERT INTO public.scholar_file_heads(user_id,file_id,version_id)
      VALUES(p_user_id,p_file_id,candidate.version_id) ON CONFLICT DO NOTHING;
  ELSE
    UPDATE public.scholar_file_heads h SET version_id=candidate.version_id,updated_at=now()
      WHERE h.user_id=p_user_id AND h.file_id=p_file_id AND h.version_id=p_expected_version_id;
  END IF;
  SELECT h.version_id INTO active FROM public.scholar_file_heads h
    WHERE h.user_id=p_user_id AND h.file_id=p_file_id;
  RETURN QUERY SELECT active IS NOT DISTINCT FROM candidate.version_id,active;
END; $$;
REVOKE ALL ON FUNCTION public.complete_scholar_file_version_v1(uuid,uuid,uuid,text,bigint,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_scholar_file_version_v1(uuid,uuid,uuid,text,bigint,uuid)
  TO service_role;

CREATE FUNCTION public.restore_scholar_file_version_v1(
  p_file_id uuid,p_version_id uuid,p_expected_version_id uuid
) RETURNS public.scholar_file_heads
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); current_head public.scholar_file_heads; restored public.scholar_file_heads;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.files f JOIN public.scholar_document_files df
    ON df.user_id=f.user_id AND df.file_id=f.id
    WHERE f.user_id=actor AND f.id=p_file_id AND f.deleted_at IS NULL FOR UPDATE OF f;
  IF NOT FOUND THEN RAISE EXCEPTION 'file is not owned by account' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.scholar_file_versions v WHERE v.user_id=actor AND v.file_id=p_file_id
    AND v.version_id=p_version_id AND v.state='ready';
  IF NOT FOUND THEN RAISE EXCEPTION 'verified version not found' USING ERRCODE='22023'; END IF;
  SELECT * INTO current_head FROM public.scholar_file_heads h
    WHERE h.user_id=actor AND h.file_id=p_file_id FOR UPDATE;
  IF NOT FOUND OR current_head.version_id IS DISTINCT FROM p_expected_version_id THEN
    RAISE EXCEPTION 'file changed since review' USING ERRCODE='PT409';
  END IF;
  UPDATE public.scholar_file_heads h SET version_id=p_version_id,updated_at=now()
    WHERE h.user_id=actor AND h.file_id=p_file_id RETURNING * INTO restored;
  RETURN restored;
END; $$;
REVOKE ALL ON FUNCTION public.restore_scholar_file_version_v1(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.restore_scholar_file_version_v1(uuid,uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
