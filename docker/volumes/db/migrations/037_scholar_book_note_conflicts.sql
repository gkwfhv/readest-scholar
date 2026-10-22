-- Phase 3: compare annotation edits and tombstones under the row lock, and
-- keep both branches. A client-side read/compare/write can race another
-- device; a BEFORE UPDATE trigger sees the committed row under PostgreSQL's
-- upsert lock even when both requests started from the same version.
BEGIN;

CREATE TABLE public.book_note_conflict_versions (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  book_hash text NOT NULL,
  note_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('previous', 'incoming')),
  version_hash text NOT NULL,
  row_data jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, book_hash, note_id, source, version_hash)
);
CREATE INDEX book_note_conflict_versions_account_time
  ON public.book_note_conflict_versions (user_id, recorded_at DESC);

ALTER TABLE public.book_note_conflict_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY book_note_conflict_versions_select ON public.book_note_conflict_versions
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
REVOKE ALL ON public.book_note_conflict_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.book_note_conflict_versions TO authenticated;

CREATE FUNCTION public.merge_book_note_on_update()
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
  IF NEW IS NOT DISTINCT FROM OLD THEN
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

CREATE TRIGGER book_notes_merge_guard
BEFORE UPDATE ON public.book_notes
FOR EACH ROW EXECUTE FUNCTION public.merge_book_note_on_update();

COMMIT;
