DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.scholar_document_books WHERE book_hash = 'gap-book'
  ) OR EXISTS (
    SELECT 1 FROM public.scholar_document_books WHERE book_hash = 'resurrect-book'
  ) THEN
    RAISE EXCEPTION 'migration gap backfill or tombstone exclusion failed';
  END IF;
END;
$$;

SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

INSERT INTO public.books (user_id, book_hash, format)
VALUES ('11111111-1111-4111-8111-111111111111', 'new-book', 'pdf');
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.scholar_document_books WHERE book_hash = 'new-book'
  ) THEN
    RAISE EXCEPTION 'new authenticated book did not receive document identity';
  END IF;
END;
$$;

UPDATE public.books SET deleted_at = NULL WHERE book_hash = 'resurrect-book';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.scholar_document_books WHERE book_hash = 'resurrect-book'
  ) THEN
    RAISE EXCEPTION 'restored book did not receive document identity';
  END IF;
END;
$$;

INSERT INTO public.books (user_id, book_hash, format, deleted_at)
VALUES ('11111111-1111-4111-8111-111111111111', 'new-tombstone', 'pdf', now());
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.scholar_document_books WHERE book_hash = 'new-tombstone'
  ) THEN
    RAISE EXCEPTION 'new tombstone received document identity';
  END IF;
END;
$$;

UPDATE public.books SET deleted_at = NULL WHERE book_hash = 'new-tombstone';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.scholar_document_books WHERE book_hash = 'new-tombstone'
  ) OR (SELECT count(*) FROM public.scholar_document_books WHERE book_hash = 'new-book') <> 1 THEN
    RAISE EXCEPTION 'revived tombstone or mapping uniqueness failed';
  END IF;
END;
$$;
RESET ROLE;
