-- Link the known Readest book binary to its Scholar document whether the
-- storage row or the synced book row arrives first. Covers, replicas and
-- unknown layouts stay out of the document's original-file relation.

BEGIN;

CREATE FUNCTION public.scholar_attach_main_book_files(
  p_user_id uuid, p_book_hash text, p_file_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.scholar_document_files (user_id, document_id, file_id, role)
  SELECT f.user_id, m.document_id, f.id, 'original'
  FROM public.files f
  JOIN public.books b
    ON b.user_id = f.user_id AND b.book_hash = f.book_hash
  JOIN public.scholar_document_books m
    ON m.user_id = b.user_id AND m.book_hash = b.book_hash
  WHERE f.user_id = p_user_id
    AND f.book_hash = p_book_hash
    AND (p_file_id IS NULL OR f.id = p_file_id)
    AND f.deleted_at IS NULL
    AND b.deleted_at IS NULL
    AND f.replica_kind IS NULL
    AND b.format IS NOT NULL
    AND split_part(f.file_key, '/', 1) = f.user_id::text
    AND split_part(f.file_key, '/', 2) = 'Readest'
    AND split_part(f.file_key, '/', 3) = 'Books'
    AND split_part(f.file_key, '/', 4) = f.book_hash
    AND split_part(f.file_key, '/', 5) <> ''
    AND split_part(f.file_key, '/', 6) = ''
    AND lower(right(f.file_key, length(b.format) + 1)) = '.' || lower(b.format)
  ON CONFLICT (user_id, file_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.scholar_attach_main_book_files(uuid, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scholar_attach_main_book_files(uuid, text, uuid)
  TO authenticated, service_role;

-- Both writers take the same transaction lock before checking the other
-- table. This closes the concurrent file/book insert gap under READ COMMITTED:
-- the second writer waits for the first to commit, then sees its row.
CREATE OR REPLACE FUNCTION public.scholar_assign_document_on_book()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  new_document_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.user_id::text || ':' || NEW.book_hash, 0)
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.scholar_document_books
    WHERE user_id = NEW.user_id AND book_hash = NEW.book_hash
  ) THEN
    INSERT INTO public.scholar_documents (user_id)
    VALUES (NEW.user_id)
    RETURNING id INTO new_document_id;

    INSERT INTO public.scholar_document_books (user_id, document_id, book_hash)
    VALUES (NEW.user_id, new_document_id, NEW.book_hash);
  END IF;

  PERFORM public.scholar_attach_main_book_files(NEW.user_id, NEW.book_hash);
  RETURN NEW;
END;
$$;

CREATE TRIGGER scholar_books_attach_file_on_format
  AFTER UPDATE OF format ON public.books
  FOR EACH ROW WHEN (
    NEW.deleted_at IS NULL AND NEW.format IS DISTINCT FROM OLD.format
  )
  EXECUTE FUNCTION public.scholar_assign_document_on_book();

CREATE FUNCTION public.scholar_attach_document_on_file()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.user_id::text || ':' || NEW.book_hash, 0)
  );
  PERFORM public.scholar_attach_main_book_files(
    NEW.user_id, NEW.book_hash, NEW.id
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.scholar_attach_document_on_file()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scholar_attach_document_on_file()
  TO authenticated, service_role;

CREATE TRIGGER scholar_files_attach_document_insert
  AFTER INSERT ON public.files
  FOR EACH ROW WHEN (
    NEW.book_hash IS NOT NULL AND NEW.deleted_at IS NULL
    AND NEW.replica_kind IS NULL
  )
  EXECUTE FUNCTION public.scholar_attach_document_on_file();

CREATE TRIGGER scholar_files_attach_document_restore
  AFTER UPDATE OF deleted_at ON public.files
  FOR EACH ROW WHEN (
    OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
    AND NEW.book_hash IS NOT NULL AND NEW.replica_kind IS NULL
  )
  EXECUTE FUNCTION public.scholar_attach_document_on_file();

-- DDL locks on both source tables keep the gap backfill atomic with trigger
-- installation. Preserve any file that was explicitly grouped as a version.
INSERT INTO public.scholar_document_files (user_id, document_id, file_id, role)
SELECT f.user_id, m.document_id, f.id, 'original'
FROM public.files f
JOIN public.books b
  ON b.user_id = f.user_id AND b.book_hash = f.book_hash
JOIN public.scholar_document_books m
  ON m.user_id = b.user_id AND m.book_hash = b.book_hash
WHERE f.deleted_at IS NULL
  AND b.deleted_at IS NULL
  AND f.replica_kind IS NULL
  AND b.format IS NOT NULL
  AND split_part(f.file_key, '/', 1) = f.user_id::text
  AND split_part(f.file_key, '/', 2) = 'Readest'
  AND split_part(f.file_key, '/', 3) = 'Books'
  AND split_part(f.file_key, '/', 4) = f.book_hash
  AND split_part(f.file_key, '/', 5) <> ''
  AND split_part(f.file_key, '/', 6) = ''
  AND lower(right(f.file_key, length(b.format) + 1)) = '.' || lower(b.format)
ON CONFLICT (user_id, file_id) DO NOTHING;

COMMIT;
