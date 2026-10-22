-- Reserve extra immutable-object bytes under one account row lock. Legacy
-- files remain counted separately because their objects still exist.
BEGIN;
ALTER TABLE public.scholar_file_versions ADD COLUMN expires_at timestamptz
  NOT NULL DEFAULT (now()+interval '1 day');
ALTER TABLE public.scholar_file_versions DROP CONSTRAINT scholar_file_versions_state_check;
ALTER TABLE public.scholar_file_versions ADD CONSTRAINT scholar_file_versions_state_check
  CHECK (state IN ('pending','ready','expired'));
CREATE TABLE public.scholar_storage_reservation_locks (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.scholar_storage_reservation_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.scholar_storage_reservation_locks FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.scholar_storage_reservation_locks TO service_role;
DROP FUNCTION public.prepare_scholar_file_version_v1(uuid,uuid,text,bigint);

-- Only the authenticated API service derives p_user_id and quota from a
-- validated access token. This function serializes all reservations per user.
CREATE FUNCTION public.reserve_scholar_file_version_v1(
  p_user_id uuid,p_file_id uuid,p_op_id uuid,p_sha256 text,
  p_file_size bigint,p_quota_bytes bigint
) RETURNS TABLE(version_id uuid,object_key text,state text,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE existing public.scholar_file_versions; next_id uuid; used_bytes numeric;
BEGIN
  IF p_user_id IS NULL OR p_file_id IS NULL OR p_op_id IS NULL OR
     p_sha256 !~ '^[0-9a-f]{64}$' OR p_file_size IS NULL OR p_file_size<0 OR
     p_quota_bytes IS NULL OR p_quota_bytes<0 THEN
    RAISE EXCEPTION 'invalid file reservation' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.scholar_document_files df JOIN public.files f
    ON f.user_id=df.user_id AND f.id=df.file_id
    WHERE df.user_id=p_user_id AND df.file_id=p_file_id AND f.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'file is not owned by account' USING ERRCODE='42501'; END IF;
  INSERT INTO public.scholar_storage_reservation_locks(user_id) VALUES(p_user_id)
    ON CONFLICT DO NOTHING;
  PERFORM 1 FROM public.scholar_storage_reservation_locks
    WHERE user_id=p_user_id FOR UPDATE;
  UPDATE public.scholar_file_versions v SET state='expired'
    WHERE v.user_id=p_user_id AND v.state='pending' AND v.expires_at<=now();
  SELECT v.* INTO existing FROM public.scholar_file_versions v
    WHERE v.user_id=p_user_id AND v.file_id=p_file_id AND v.op_id=p_op_id;
  IF FOUND THEN
    IF existing.sha256<>p_sha256 OR existing.file_size<>p_file_size THEN
      RAISE EXCEPTION 'operation id reused for different bytes' USING ERRCODE='22023';
    END IF;
    IF existing.state='expired' THEN
      RAISE EXCEPTION 'upload reservation expired' USING ERRCODE='PT410';
    END IF;
    RETURN QUERY SELECT existing.version_id,existing.object_key,existing.state,existing.expires_at;
    RETURN;
  END IF;
  SELECT
    COALESCE((SELECT sum(f.file_size) FROM public.files f
      WHERE f.user_id=p_user_id AND f.deleted_at IS NULL),0)+
    COALESCE((SELECT sum(v.file_size) FROM public.scholar_file_versions v
      WHERE v.user_id=p_user_id AND v.state IN ('pending','ready')),0)
    INTO used_bytes;
  IF used_bytes+p_file_size>p_quota_bytes THEN
    RAISE EXCEPTION 'storage quota exceeded' USING ERRCODE='PT413';
  END IF;
  next_id:=gen_random_uuid();
  INSERT INTO public.scholar_file_versions
    (user_id,file_id,version_id,op_id,object_key,sha256,file_size)
  VALUES(p_user_id,p_file_id,next_id,p_op_id,
    p_user_id::text||'/Scholar/versions/'||next_id::text,p_sha256,p_file_size)
  RETURNING scholar_file_versions.version_id,scholar_file_versions.object_key,
    scholar_file_versions.state,scholar_file_versions.expires_at
    INTO version_id,object_key,state,expires_at;
  RETURN NEXT;
END; $$;
REVOKE ALL ON FUNCTION public.reserve_scholar_file_version_v1(uuid,uuid,uuid,text,bigint,bigint)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_scholar_file_version_v1(uuid,uuid,uuid,text,bigint,bigint)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_scholar_file_version_v1(
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
  IF candidate.state='expired' OR candidate.expires_at<=now() THEN
    RAISE EXCEPTION 'upload reservation expired' USING ERRCODE='PT410';
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
NOTIFY pgrst,'reload schema';
COMMIT;
