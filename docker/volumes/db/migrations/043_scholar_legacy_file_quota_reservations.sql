-- Legacy file uploads and immutable Scholar versions share one account quota
-- lock. Retained original objects and all live versions both consume bytes.
BEGIN;
CREATE OR REPLACE FUNCTION public.reserve_storage_file_v1(
  p_user_id uuid,p_file_key text,p_file_size bigint,p_quota_bytes bigint,
  p_book_hash text,p_replica_kind text,p_replica_id text
) RETURNS TABLE(file_id uuid,object_size bigint,usage_bytes bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE existing_id uuid; existing_size bigint; existing_deleted timestamptz; used_bytes numeric;
BEGIN
  IF p_user_id IS NULL OR p_file_key IS NULL OR
     left(p_file_key,length(p_user_id::text)+1)<>p_user_id::text||'/' OR
     p_file_size IS NULL OR p_file_size<=0 OR p_quota_bytes IS NULL OR p_quota_bytes<0 THEN
    RAISE EXCEPTION 'invalid file reservation' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.scholar_storage_reservation_locks(user_id) VALUES(p_user_id)
    ON CONFLICT DO NOTHING;
  PERFORM 1 FROM public.scholar_storage_reservation_locks
    WHERE user_id=p_user_id FOR UPDATE;
  UPDATE public.scholar_file_versions v SET state='expired'
    WHERE v.user_id=p_user_id AND v.state='pending' AND v.expires_at<=now();
  SELECT f.id,f.file_size,f.deleted_at INTO existing_id,existing_size,existing_deleted
    FROM public.files f WHERE f.user_id=p_user_id AND f.file_key=p_file_key FOR UPDATE;
  SELECT
    COALESCE((SELECT sum(f.file_size) FROM public.files f
      WHERE f.user_id=p_user_id AND f.deleted_at IS NULL),0)+
    COALESCE((SELECT sum(v.file_size) FROM public.scholar_file_versions v
      WHERE v.user_id=p_user_id AND v.state IN ('pending','ready')),0)
    INTO used_bytes;
  IF existing_id IS NOT NULL THEN
    IF existing_deleted IS NOT NULL THEN
      RAISE EXCEPTION 'file is deleted' USING ERRCODE='PT410';
    END IF;
    IF existing_size<>p_file_size THEN
      RAISE EXCEPTION 'file size differs from existing object' USING ERRCODE='PT409';
    END IF;
    RETURN QUERY SELECT existing_id,existing_size,used_bytes::bigint;
    RETURN;
  END IF;
  IF used_bytes+p_file_size>p_quota_bytes THEN
    RAISE EXCEPTION 'storage quota exceeded' USING ERRCODE='PT413';
  END IF;
  INSERT INTO public.files(user_id,book_hash,replica_kind,replica_id,file_key,file_size)
    VALUES(p_user_id,p_book_hash,p_replica_kind,p_replica_id,p_file_key,p_file_size)
    RETURNING id INTO existing_id;
  RETURN QUERY SELECT existing_id,p_file_size,(used_bytes+p_file_size)::bigint;
END; $$;
REVOKE ALL ON FUNCTION public.reserve_storage_file_v1(uuid,text,bigint,bigint,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_storage_file_v1(uuid,text,bigint,bigint,text,text,text)
  TO service_role;
-- Read the same live objects used by both reservation functions. The endpoint
-- also uses this to show retained immutable version bytes to the account.
CREATE OR REPLACE FUNCTION public.get_storage_usage_v1(p_user_id uuid)
RETURNS TABLE(file_count bigint,file_bytes bigint,version_count bigint,
              version_bytes bigint,usage_bytes bigint)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp STABLE AS $$
  SELECT f.n,f.bytes,v.n,v.bytes,f.bytes+v.bytes FROM
    (SELECT count(*) AS n,COALESCE(sum(file_size),0)::bigint AS bytes
       FROM public.files WHERE user_id=p_user_id AND deleted_at IS NULL) f,
    (SELECT count(*) AS n,COALESCE(sum(file_size),0)::bigint AS bytes
       FROM public.scholar_file_versions
       WHERE user_id=p_user_id AND state IN ('pending','ready')
         AND (state='ready' OR expires_at>now())) v;
$$;
REVOKE ALL ON FUNCTION public.get_storage_usage_v1(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_storage_usage_v1(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
