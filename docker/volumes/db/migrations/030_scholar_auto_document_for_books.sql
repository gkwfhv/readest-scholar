-- Give new cloud-library books a stable Scholar document ID without changing
-- Readest's book_hash, reader state, or existing sync payloads. A book that is
-- inserted as deleted receives no document until it is explicitly restored.

BEGIN;

CREATE FUNCTION public.scholar_assign_document_on_book()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  new_document_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.scholar_document_books
    WHERE user_id = NEW.user_id AND book_hash = NEW.book_hash
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.scholar_documents (user_id)
  VALUES (NEW.user_id)
  RETURNING id INTO new_document_id;

  INSERT INTO public.scholar_document_books (user_id, document_id, book_hash)
  VALUES (NEW.user_id, new_document_id, NEW.book_hash);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.scholar_assign_document_on_book() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scholar_assign_document_on_book()
  TO authenticated, service_role;

CREATE TRIGGER scholar_books_assign_document_insert
  AFTER INSERT ON public.books
  FOR EACH ROW WHEN (NEW.deleted_at IS NULL)
  EXECUTE FUNCTION public.scholar_assign_document_on_book();

CREATE TRIGGER scholar_books_assign_document_restore
  AFTER UPDATE OF deleted_at ON public.books
  FOR EACH ROW WHEN (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL)
  EXECUTE FUNCTION public.scholar_assign_document_on_book();

-- Cover books written between migrations 029 and 030. The trigger is already
-- installed while this transaction holds the book table's DDL lock, so a new
-- committed book cannot slip between the snapshot and the final backfill.
CREATE TEMP TABLE scholar_auto_document_backfill ON COMMIT DROP AS
  SELECT b.user_id, b.book_hash, gen_random_uuid() AS document_id
  FROM public.books b
  WHERE b.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.scholar_document_books m
      WHERE m.user_id = b.user_id AND m.book_hash = b.book_hash
    );

INSERT INTO public.scholar_documents (user_id, id)
  SELECT user_id, document_id FROM scholar_auto_document_backfill;
INSERT INTO public.scholar_document_books (user_id, document_id, book_hash)
  SELECT user_id, document_id, book_hash FROM scholar_auto_document_backfill;

COMMIT;
