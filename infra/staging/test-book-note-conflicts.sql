-- Run only against an isolated database restored from synthetic staging.
-- The entire probe is rolled back; no note or history row remains.
BEGIN;
DO $probe$
DECLARE
  account_id uuid;
  current_note public.book_notes;
  archive_count integer;
  probe_hash text := 'phase3-note-clock-probe';
  probe_id text := 'probe-note';
BEGIN
  SELECT id INTO account_id FROM auth.users ORDER BY id LIMIT 1;
  IF account_id IS NULL THEN
    RAISE EXCEPTION 'synthetic auth user required';
  END IF;
  INSERT INTO public.book_notes
    (user_id, book_hash, id, type, cfi, note, created_at, updated_at)
  VALUES
    (account_id, probe_hash, probe_id, 'annotation', 'epubcfi(/6/2)',
     'live edit', to_timestamp(1), to_timestamp(3));

  -- Replaying the same insert with its original timestamp is a no-op,
  -- not a conflict version (the API may stamp the first insert for pull).
  UPDATE public.book_notes SET updated_at = to_timestamp(1),
    created_at = to_timestamp(2)
    WHERE user_id = account_id AND book_hash = probe_hash AND id = probe_id;
  SELECT count(*) INTO archive_count FROM public.book_note_conflict_versions
    WHERE user_id = account_id AND book_hash = probe_hash AND note_id = probe_id;
  IF archive_count <> 0 THEN
    RAISE EXCEPTION 'identical lost-response retry created conflict history';
  END IF;

  -- A deletion at t=2 must not overwrite a live edit at t=3, even though
  -- the existing row has no deleted_at at all.
  UPDATE public.book_notes
    SET note = 'stale deletion', updated_at = to_timestamp(1),
        deleted_at = to_timestamp(2)
    WHERE user_id = account_id AND book_hash = probe_hash AND id = probe_id;
  SELECT * INTO current_note FROM public.book_notes
    WHERE user_id = account_id AND book_hash = probe_hash AND id = probe_id;
  IF current_note.note <> 'live edit' OR current_note.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'stale deletion replaced newer live edit';
  END IF;
  SELECT count(*) INTO archive_count FROM public.book_note_conflict_versions
    WHERE user_id = account_id AND book_hash = probe_hash AND note_id = probe_id
      AND source = 'incoming';
  IF archive_count <> 1 THEN
    RAISE EXCEPTION 'losing incoming deletion was not archived';
  END IF;

  -- Lost-response retry is idempotent: same incoming payload adds no version.
  UPDATE public.book_notes
    SET note = 'stale deletion', updated_at = to_timestamp(1),
        deleted_at = to_timestamp(2)
    WHERE user_id = account_id AND book_hash = probe_hash AND id = probe_id;
  SELECT count(*) INTO archive_count FROM public.book_note_conflict_versions
    WHERE user_id = account_id AND book_hash = probe_hash AND note_id = probe_id
      AND source = 'incoming';
  IF archive_count <> 1 THEN
    RAISE EXCEPTION 'duplicate losing request added another archived version';
  END IF;

  -- A later deletion wins and retains the prior live text.
  UPDATE public.book_notes
    SET note = 'later deletion', updated_at = to_timestamp(1),
        deleted_at = to_timestamp(5)
    WHERE user_id = account_id AND book_hash = probe_hash AND id = probe_id;
  SELECT * INTO current_note FROM public.book_notes
    WHERE user_id = account_id AND book_hash = probe_hash AND id = probe_id;
  IF current_note.deleted_at <> to_timestamp(5) THEN
    RAISE EXCEPTION 'later deletion did not win';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.book_note_conflict_versions
    WHERE user_id = account_id AND book_hash = probe_hash AND note_id = probe_id
      AND source = 'previous' AND row_data->>'note' = 'live edit'
  ) THEN
    RAISE EXCEPTION 'previous live version was not archived';
  END IF;

  -- An equal-time live edit must not resurrect the tombstone.
  UPDATE public.book_notes
    SET note = 'tied live edit', updated_at = to_timestamp(5), deleted_at = NULL
    WHERE user_id = account_id AND book_hash = probe_hash AND id = probe_id;
  SELECT * INTO current_note FROM public.book_notes
    WHERE user_id = account_id AND book_hash = probe_hash AND id = probe_id;
  IF current_note.deleted_at <> to_timestamp(5) THEN
    RAISE EXCEPTION 'equal-time edit resurrected tombstone';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.book_note_conflict_versions
    WHERE user_id = account_id AND book_hash = probe_hash AND note_id = probe_id
      AND source = 'incoming' AND row_data->>'note' = 'tied live edit'
  ) THEN
    RAISE EXCEPTION 'losing equal-time edit was not archived';
  END IF;

  -- A strictly newer live edit wins and keeps the tombstone in history.
  UPDATE public.book_notes
    SET note = 'newer live edit', updated_at = to_timestamp(6), deleted_at = NULL
    WHERE user_id = account_id AND book_hash = probe_hash AND id = probe_id;
  SELECT * INTO current_note FROM public.book_notes
    WHERE user_id = account_id AND book_hash = probe_hash AND id = probe_id;
  IF current_note.note <> 'newer live edit' OR current_note.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'newer live edit did not win';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.book_note_conflict_versions
    WHERE user_id = account_id AND book_hash = probe_hash AND note_id = probe_id
      AND source = 'previous' AND row_data->>'note' = 'later deletion'
  ) THEN
    RAISE EXCEPTION 'previous deletion was not archived';
  END IF;
END;
$probe$;
-- The history is readable only by its owner and cannot be forged by clients.
INSERT INTO public.book_note_conflict_versions
  (user_id, book_hash, note_id, source, version_hash, row_data)
SELECT id, 'phase3-note-clock-probe', 'foreign-note', 'incoming',
       md5('foreign-version'), '{"note":"foreign"}'::jsonb
FROM auth.users ORDER BY id OFFSET 1 LIMIT 1;
DO $jwt$
BEGIN
  PERFORM set_config('request.jwt.claim.sub',
    (SELECT id::text FROM auth.users ORDER BY id LIMIT 1), true);
END;
$jwt$;
SET LOCAL ROLE authenticated;
DO $access$
DECLARE
  own_count integer;
  foreign_count integer;
  denied boolean := false;
  upsert_result public.book_notes;
BEGIN
  -- Exercise the same authenticated INSERT ... ON CONFLICT route as PostgREST.
  INSERT INTO public.book_notes
    (user_id, book_hash, id, type, note, created_at, updated_at, deleted_at)
  VALUES
    (auth.uid(), 'phase3-note-clock-probe', 'probe-note', 'annotation',
     'stale authenticated upsert', to_timestamp(1), to_timestamp(2), to_timestamp(4))
  ON CONFLICT (user_id, book_hash, id) DO UPDATE
    SET note = EXCLUDED.note, updated_at = EXCLUDED.updated_at,
        deleted_at = EXCLUDED.deleted_at
  RETURNING * INTO upsert_result;
  IF upsert_result.id IS NOT NULL THEN
    RAISE EXCEPTION 'stale authenticated upsert returned a loser';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.book_note_conflict_versions
    WHERE user_id = auth.uid() AND book_hash = 'phase3-note-clock-probe'
      AND note_id = 'probe-note' AND row_data->>'note' = 'stale authenticated upsert'
  ) THEN
    RAISE EXCEPTION 'stale authenticated upsert was not archived';
  END IF;
  SELECT count(*) INTO own_count FROM public.book_note_conflict_versions
    WHERE book_hash = 'phase3-note-clock-probe' AND note_id = 'probe-note';
  SELECT count(*) INTO foreign_count FROM public.book_note_conflict_versions
    WHERE book_hash = 'phase3-note-clock-probe' AND note_id = 'foreign-note';
  IF own_count < 2 OR foreign_count <> 0 THEN
    RAISE EXCEPTION 'conflict history account isolation failed';
  END IF;
  BEGIN
    INSERT INTO public.book_note_conflict_versions
      (user_id, book_hash, note_id, source, version_hash, row_data)
    VALUES
      (auth.uid(), 'phase3-note-clock-probe', 'forged', 'incoming',
       md5('forged'), '{}'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'authenticated client could forge conflict history';
  END IF;
END;
$access$;
RESET ROLE;
ROLLBACK;
