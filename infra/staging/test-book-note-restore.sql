-- Run against an isolated database restored from synthetic staging.
-- The transaction rolls back every synthetic note and history row.
BEGIN;
DO $jwt$
BEGIN
  PERFORM set_config('request.jwt.claim.sub',
    (SELECT id::text FROM auth.users ORDER BY id LIMIT 1), true);
END;
$jwt$;
SET LOCAL ROLE authenticated;
DO $probe$
DECLARE
  account_id uuid := auth.uid();
  probe_hash text := 'phase3-note-restore-probe';
  probe_id text := 'probe-note';
  old_hash text;
  deleted_hash text;
  reviewed jsonb;
  restored public.book_notes;
  denied boolean := false;
  stale boolean := false;
BEGIN
  INSERT INTO public.book_notes
    (user_id, book_hash, id, type, note, created_at, updated_at)
  VALUES
    (account_id, probe_hash, probe_id, 'annotation',
     'original', to_timestamp(1), to_timestamp(1));
  UPDATE public.book_notes SET note = 'current', updated_at = to_timestamp(3)
    WHERE user_id = account_id AND book_hash = probe_hash AND id = probe_id;
  SELECT version_hash INTO old_hash FROM public.book_note_conflict_versions
    WHERE user_id = account_id AND book_hash = probe_hash AND note_id = probe_id
      AND source = 'previous' AND row_data->>'note' = 'original';
  IF old_hash IS NULL THEN RAISE EXCEPTION 'missing archived note'; END IF;
  SELECT to_jsonb(n) INTO reviewed FROM public.book_notes AS n
    WHERE user_id = account_id AND book_hash = probe_hash AND id = probe_id;

  BEGIN
    PERFORM public.restore_book_note_version_v1(
      gen_random_uuid(), probe_hash, probe_id, 'previous', old_hash, reviewed);
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'cross-account restore allowed'; END IF;

  restored := public.restore_book_note_version_v1(
    account_id, probe_hash, probe_id, 'previous', old_hash, reviewed);
  IF restored.note <> 'original' OR restored.deleted_at IS NOT NULL
     OR restored.updated_at <= to_timestamp(3) THEN
    RAISE EXCEPTION 'live note restore failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.book_note_conflict_versions
    WHERE user_id = account_id AND book_hash = probe_hash AND note_id = probe_id
      AND source = 'previous' AND row_data->>'note' = 'current'
  ) THEN RAISE EXCEPTION 'restore did not archive replaced version'; END IF;

  BEGIN
    PERFORM public.restore_book_note_version_v1(
      account_id, probe_hash, probe_id, 'previous', old_hash, reviewed);
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    stale := true;
  END;
  IF NOT stale THEN RAISE EXCEPTION 'stale review was not rejected'; END IF;

  UPDATE public.book_notes SET deleted_at = restored.updated_at + interval '1 second'
    WHERE user_id = account_id AND book_hash = probe_hash AND id = probe_id;
  SELECT to_jsonb(n) INTO reviewed FROM public.book_notes AS n
    WHERE user_id = account_id AND book_hash = probe_hash AND id = probe_id;
  restored := public.restore_book_note_version_v1(
    account_id, probe_hash, probe_id, 'previous', old_hash, reviewed);
  IF restored.deleted_at IS NOT NULL OR restored.note <> 'original' THEN
    RAISE EXCEPTION 'live restore from deletion failed';
  END IF;
  SELECT version_hash INTO deleted_hash FROM public.book_note_conflict_versions
    WHERE user_id = account_id AND book_hash = probe_hash AND note_id = probe_id
      AND source = 'previous' AND row_data->>'deleted_at' IS NOT NULL
    ORDER BY recorded_at DESC LIMIT 1;
  IF deleted_hash IS NULL THEN RAISE EXCEPTION 'missing archived tombstone'; END IF;
  SELECT to_jsonb(n) INTO reviewed FROM public.book_notes AS n
    WHERE user_id = account_id AND book_hash = probe_hash AND id = probe_id;
  restored := public.restore_book_note_version_v1(
    account_id, probe_hash, probe_id, 'previous', deleted_hash, reviewed);
  IF restored.deleted_at IS NULL OR restored.note <> 'original' THEN
    RAISE EXCEPTION 'tombstone restore failed';
  END IF;
END;
$probe$;
RESET ROLE;
ROLLBACK;
