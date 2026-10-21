DO $$
BEGIN
  IF (SELECT count(*) FROM public.scholar_document_files
      WHERE file_id IN ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa031',
                        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa033')) <> 2
    OR EXISTS (SELECT 1 FROM public.scholar_document_files
               WHERE file_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa032') THEN
    RAISE EXCEPTION 'migration must backfill both file/book orders, not covers';
  END IF;
  IF (SELECT role FROM public.scholar_document_files
      WHERE file_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad') <> 'version' THEN
    RAISE EXCEPTION 'migration changed an explicitly linked version';
  END IF;
END;
$$;

-- The existing sync and upload APIs write through the service role.
SET ROLE service_role;
INSERT INTO public.files (id, user_id, book_hash, file_key)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa034',
        '11111111-1111-4111-8111-111111111111', 'gap-book',
        '11111111-1111-4111-8111-111111111111/Readest/Books/gap-book/paper.pdf');
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.scholar_document_files
                 WHERE file_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa034') THEN
    RAISE EXCEPTION 'file after book was not attached';
  END IF;
END;
$$;

INSERT INTO public.files (id, user_id, book_hash, file_key)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa035',
        '11111111-1111-4111-8111-111111111111', 'future-book',
        '11111111-1111-4111-8111-111111111111/Readest/Books/future-book/paper.pdf');
INSERT INTO public.books (user_id, book_hash, format)
VALUES ('11111111-1111-4111-8111-111111111111', 'future-book', 'pdf');
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.scholar_document_files f
                 JOIN public.scholar_document_books b
                   ON b.user_id = f.user_id AND b.document_id = f.document_id
                 WHERE f.file_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa035'
                   AND b.book_hash = 'future-book') THEN
    RAISE EXCEPTION 'book after file was not attached to the same document';
  END IF;
END;
$$;
RESET ROLE;

-- A row for another account with the same hash cannot borrow account A's
-- document. A later authenticated read must not expose it either.
SET ROLE service_role;
INSERT INTO public.files (id, user_id, book_hash, file_key)
VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb031',
        '22222222-2222-4222-8222-222222222222', 'gap-book',
        '22222222-2222-4222-8222-222222222222/Readest/Books/gap-book/paper.pdf');
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.scholar_document_files
             WHERE file_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb031') THEN
    RAISE EXCEPTION 'cross-account hash collision attached a file';
  END IF;
END;
$$;
RESET ROLE;

SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
INSERT INTO public.books (user_id, book_hash, format, deleted_at)
VALUES ('11111111-1111-4111-8111-111111111111', 'restore-file', 'pdf', now());
INSERT INTO public.files (id, user_id, book_hash, file_key)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa036',
        '11111111-1111-4111-8111-111111111111', 'restore-file',
        '11111111-1111-4111-8111-111111111111/Readest/Books/restore-file/paper.pdf');
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.scholar_document_files
             WHERE file_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa036') THEN
    RAISE EXCEPTION 'tombstoned book file was attached';
  END IF;
END;
$$;
UPDATE public.books SET deleted_at = NULL WHERE book_hash = 'restore-file';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.scholar_document_files
                 WHERE file_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa036') THEN
    RAISE EXCEPTION 'restored book file was not attached';
  END IF;
END;
$$;

INSERT INTO public.books (user_id, book_hash) VALUES
  ('11111111-1111-4111-8111-111111111111', 'late-format');
INSERT INTO public.files (id, user_id, book_hash, file_key)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa037',
        '11111111-1111-4111-8111-111111111111', 'late-format',
        '11111111-1111-4111-8111-111111111111/Readest/Books/late-format/paper.pdf');
UPDATE public.books SET format = 'pdf' WHERE book_hash = 'late-format';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.scholar_document_files
                 WHERE file_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa037') THEN
    RAISE EXCEPTION 'late book format did not attach its file';
  END IF;
END;
$$;

INSERT INTO public.files (id, user_id, book_hash, file_key, deleted_at)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa03c',
        '11111111-1111-4111-8111-111111111111', 'late-format',
        '11111111-1111-4111-8111-111111111111/Readest/Books/late-format/restored.pdf',
        now());
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.scholar_document_files
             WHERE file_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa03c') THEN
    RAISE EXCEPTION 'deleted file was attached';
  END IF;
END;
$$;
UPDATE public.files SET deleted_at = NULL
WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa03c';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.scholar_document_files
                 WHERE file_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa03c') THEN
    RAISE EXCEPTION 'restored file was not attached';
  END IF;
END;
$$;

INSERT INTO public.files (id, user_id, book_hash, file_key, replica_kind) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa038',
   '11111111-1111-4111-8111-111111111111', 'late-format',
   '11111111-1111-4111-8111-111111111111/Readest/Books/late-format/cover.png', NULL),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa039',
   '11111111-1111-4111-8111-111111111111', 'late-format',
   '11111111-1111-4111-8111-111111111111/Readest/Books/late-format/paper.epub', NULL),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa03a',
   '11111111-1111-4111-8111-111111111111', 'late-format',
   '11111111-1111-4111-8111-111111111111/Readest/Books/late-format/replica.pdf', 'dictionary'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa03b',
   '11111111-1111-4111-8111-111111111111', 'late-format',
   '11111111-1111-4111-8111-111111111111/Readest/Books/other/paper.pdf', NULL);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.scholar_document_files WHERE file_id IN
             ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa038',
              'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa039',
              'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa03a',
              'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa03b')) THEN
    RAISE EXCEPTION 'cover, wrong format, replica or wrong path was attached';
  END IF;
END;
$$;
RESET ROLE;
