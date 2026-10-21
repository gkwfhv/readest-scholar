-- Run after the matching fixture and migration in the same isolated database.
DO $$
BEGIN
  IF (SELECT count(*) FROM public.scholar_documents) <> 2
    OR (SELECT count(*) FROM public.scholar_document_books) <> 2
    OR (SELECT count(*) FROM public.scholar_document_files) <> 2 THEN
    RAISE EXCEPTION 'backfill must map live books and only their main binaries';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.scholar_document_files
    WHERE file_id IN (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc'
    )
  ) THEN
    RAISE EXCEPTION 'cover or deleted book binary was linked';
  END IF;
END;
$$;

-- A later version can join an existing logical document without changing the
-- original reader book's hash or file UUID.
INSERT INTO public.books (user_id, book_hash, format)
VALUES ('11111111-1111-4111-8111-111111111111', 'book-a-version', 'pdf');
INSERT INTO public.files (id, user_id, book_hash, file_key)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad',
        '11111111-1111-4111-8111-111111111111', 'book-a-version',
        '11111111-1111-4111-8111-111111111111/Readest/Books/book-a-version/book-a-version.pdf');

SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

DO $$
DECLARE
  owned_document uuid;
BEGIN
  SELECT document_id INTO owned_document
  FROM public.scholar_document_books WHERE book_hash = 'book-a';
  IF owned_document IS NULL
    OR (SELECT count(*) FROM public.scholar_documents) <> 1
    OR (SELECT count(*) FROM public.scholar_document_books) <> 1
    OR (SELECT count(*) FROM public.scholar_document_files) <> 1 THEN
    RAISE EXCEPTION 'account A could not read only its own identity rows';
  END IF;

  INSERT INTO public.scholar_document_books (user_id, document_id, book_hash)
  VALUES ('11111111-1111-4111-8111-111111111111', owned_document, 'book-a-version');
  INSERT INTO public.scholar_document_files (user_id, document_id, file_id, role)
  VALUES ('11111111-1111-4111-8111-111111111111', owned_document,
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad', 'version');
  IF (SELECT count(*) FROM public.scholar_document_books WHERE document_id = owned_document) <> 2
    OR (SELECT count(*) FROM public.scholar_document_files WHERE document_id = owned_document) <> 2 THEN
    RAISE EXCEPTION 'one logical document could not group two versions';
  END IF;

  BEGIN
    INSERT INTO public.scholar_document_files (user_id, document_id, file_id, role)
    VALUES ('11111111-1111-4111-8111-111111111111', owned_document,
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'supplement');
    RAISE EXCEPTION 'cross-account file attach unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.scholar_documents (user_id)
    VALUES ('22222222-2222-4222-8222-222222222222');
    RAISE EXCEPTION 'cross-account document insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.scholar_document_books (user_id, document_id, book_hash)
    VALUES ('11111111-1111-4111-8111-111111111111', gen_random_uuid(), 'book-a');
    RAISE EXCEPTION 'book was attached to two documents';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END;
$$;

SET request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
DO $$
BEGIN
  IF (SELECT count(*) FROM public.scholar_documents) <> 1
    OR (SELECT count(*) FROM public.scholar_document_files) <> 1 THEN
    RAISE EXCEPTION 'account B could not read only its own identity rows';
  END IF;
END;
$$;
RESET ROLE;

SET ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM count(*) FROM public.scholar_documents;
    RAISE EXCEPTION 'anonymous document read unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;
RESET ROLE;
