-- A lost-response retry of an unchanged note must not create a false
-- conflict, even when the first insert was stamped for incremental pull.
BEGIN;
CREATE OR REPLACE FUNCTION public.merge_book_note_on_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  old_at timestamptz;
  new_at timestamptz;
  archived jsonb;
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.book_hash IS DISTINCT FROM OLD.book_hash
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'book note identity cannot change' USING ERRCODE = '22023';
  END IF;
  IF NEW IS NOT DISTINCT FROM OLD OR
     to_jsonb(NEW) - 'updated_at' - 'created_at' =
       to_jsonb(OLD) - 'updated_at' - 'created_at' THEN
    RETURN NULL;
  END IF;

  old_at := GREATEST(
    COALESCE(OLD.updated_at, '-infinity'::timestamptz),
    COALESCE(OLD.deleted_at, '-infinity'::timestamptz)
  );
  new_at := GREATEST(
    COALESCE(NEW.updated_at, '-infinity'::timestamptz),
    COALESCE(NEW.deleted_at, '-infinity'::timestamptz)
  );

  IF new_at > old_at OR
     (new_at = old_at AND NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL) THEN
    archived := to_jsonb(OLD);
    INSERT INTO public.book_note_conflict_versions
      (user_id, book_hash, note_id, source, version_hash, row_data)
    VALUES
      (OLD.user_id, OLD.book_hash, OLD.id, 'previous', md5(archived::text), archived)
    ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  archived := to_jsonb(NEW);
  INSERT INTO public.book_note_conflict_versions
    (user_id, book_hash, note_id, source, version_hash, row_data)
  VALUES
    (OLD.user_id, OLD.book_hash, OLD.id, 'incoming', md5(archived::text), archived)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.merge_book_note_on_update() FROM PUBLIC, anon, authenticated;
COMMIT;
