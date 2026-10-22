-- Register a Scholar book file without writing a mutable legacy object.
-- The first immutable version supplies the bytes after its verified CAS.
BEGIN;
CREATE FUNCTION public.register_scholar_file_v1(
  p_user_id uuid,p_file_key text,p_book_hash text
) RETURNS TABLE(file_id uuid,active_version_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE existing_id uuid; existing_hash text; existing_deleted timestamptz;
        book_format text; current_version uuid;
BEGIN
  IF p_user_id IS NULL OR p_file_key IS NULL OR p_book_hash IS NULL OR
     split_part(p_file_key,'/',1)<>p_user_id::text OR
     split_part(p_file_key,'/',2)<>'Readest' OR
     split_part(p_file_key,'/',3)<>'Books' OR
     split_part(p_file_key,'/',4)<>p_book_hash OR
     split_part(p_file_key,'/',5)='' OR split_part(p_file_key,'/',6)<>'' THEN
    RAISE EXCEPTION 'invalid Scholar file key' USING ERRCODE='22023';
  END IF;
  SELECT b.format INTO book_format FROM public.books b
    WHERE b.user_id=p_user_id AND b.book_hash=p_book_hash
      AND b.deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'book not found' USING ERRCODE='PT404'; END IF;
  IF book_format IS NULL OR
     lower(right(p_file_key,length(book_format)+1))<>'.'||lower(book_format) THEN
    RAISE EXCEPTION 'not a main book file' USING ERRCODE='PT409';
  END IF;
  INSERT INTO public.scholar_storage_reservation_locks(user_id) VALUES(p_user_id)
    ON CONFLICT DO NOTHING;
  PERFORM 1 FROM public.scholar_storage_reservation_locks
    WHERE user_id=p_user_id FOR UPDATE;
  SELECT f.id,f.book_hash,f.deleted_at INTO existing_id,existing_hash,existing_deleted
    FROM public.files f WHERE f.user_id=p_user_id AND f.file_key=p_file_key FOR UPDATE;
  IF existing_id IS NOT NULL THEN
    IF existing_deleted IS NOT NULL THEN
      RAISE EXCEPTION 'file is deleted' USING ERRCODE='PT410';
    END IF;
    IF existing_hash IS DISTINCT FROM p_book_hash THEN
      RAISE EXCEPTION 'file belongs to a different book' USING ERRCODE='PT409';
    END IF;
  ELSE
    INSERT INTO public.files(user_id,book_hash,file_key,file_size)
      VALUES(p_user_id,p_book_hash,p_file_key,0)
      RETURNING id INTO existing_id;
  END IF;
  PERFORM 1 FROM public.scholar_document_files df
    WHERE df.user_id=p_user_id AND df.file_id=existing_id AND df.role='original';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'file is not linked to a Scholar document' USING ERRCODE='PT409';
  END IF;
  SELECT h.version_id INTO current_version FROM public.scholar_file_heads h
    WHERE h.user_id=p_user_id AND h.file_id=existing_id;
  RETURN QUERY SELECT existing_id,current_version;
END; $$;
REVOKE ALL ON FUNCTION public.register_scholar_file_v1(uuid,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_scholar_file_v1(uuid,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
