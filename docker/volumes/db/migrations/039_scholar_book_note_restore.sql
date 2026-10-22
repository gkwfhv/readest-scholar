-- Restore one archived note under a row lock. The client must submit the
-- version it reviewed; a concurrent edit or deletion rejects the restore.
BEGIN;

CREATE FUNCTION public.restore_book_note_version_v1(
  p_user_id uuid,
  p_book_hash text,
  p_note_id text,
  p_source text,
  p_version_hash text,
  p_expected_current jsonb
) RETURNS public.book_notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  saved jsonb;
  saved_row public.book_notes;
  current_row public.book_notes;
  restored public.book_notes;
  restore_at timestamptz;
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'book note account mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_source NOT IN ('previous', 'incoming')
     OR p_version_hash !~ '^[0-9a-f]{32}$'
     OR p_book_hash IS NULL OR p_note_id IS NULL
     OR jsonb_typeof(p_expected_current) <> 'object' THEN
    RAISE EXCEPTION 'invalid book note restore target' USING ERRCODE = '22023';
  END IF;

  SELECT v.row_data INTO saved FROM public.book_note_conflict_versions AS v
  WHERE v.user_id = p_user_id AND v.book_hash = p_book_hash
    AND v.note_id = p_note_id AND v.source = p_source
    AND v.version_hash = p_version_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'archived book note version not found' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO saved_row FROM jsonb_populate_record(NULL::public.book_notes, saved);
  IF saved_row.user_id IS DISTINCT FROM p_user_id
     OR saved_row.book_hash IS DISTINCT FROM p_book_hash
     OR saved_row.id IS DISTINCT FROM p_note_id THEN
    RAISE EXCEPTION 'archived book note identity mismatch' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO current_row FROM public.book_notes
  WHERE user_id = p_user_id AND book_hash = p_book_hash AND id = p_note_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'book note no longer exists' USING ERRCODE = '22023';
  END IF;
  IF to_jsonb(current_row) IS DISTINCT FROM p_expected_current THEN
    RAISE EXCEPTION 'book note changed since conflict review'
      USING ERRCODE = '40001';
  END IF;
  IF to_jsonb(saved_row) - 'updated_at' - 'created_at' =
     to_jsonb(current_row) - 'updated_at' - 'created_at' THEN
    RETURN current_row;
  END IF;

  restore_at := GREATEST(
    clock_timestamp(),
    COALESCE(current_row.updated_at, '-infinity'::timestamptz) + interval '1 millisecond',
    COALESCE(current_row.deleted_at, '-infinity'::timestamptz) + interval '1 millisecond'
  );
  UPDATE public.book_notes SET
    meta_hash = saved_row.meta_hash,
    type = saved_row.type,
    cfi = saved_row.cfi,
    xpointer0 = saved_row.xpointer0,
    xpointer1 = saved_row.xpointer1,
    page = saved_row.page,
    text = saved_row.text,
    style = saved_row.style,
    color = saved_row.color,
    note = saved_row.note,
    global = saved_row.global,
    ink = saved_row.ink,
    created_at = saved_row.created_at,
    updated_at = restore_at,
    deleted_at = CASE WHEN saved_row.deleted_at IS NULL THEN NULL ELSE restore_at END
  WHERE user_id = p_user_id AND book_hash = p_book_hash AND id = p_note_id
  RETURNING * INTO restored;
  RETURN restored;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_book_note_version_v1(
  uuid, text, text, text, text, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_book_note_version_v1(
  uuid, text, text, text, text, jsonb
) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
