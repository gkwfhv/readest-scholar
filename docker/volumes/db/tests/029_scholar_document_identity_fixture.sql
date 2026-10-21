-- Minimal pre-migration rows for an isolated PostgreSQL instance. The two
-- UUIDs represent synthetic accounts; no real auth or storage is involved.
CREATE TABLE public.books (
  user_id uuid NOT NULL REFERENCES auth.users (id),
  book_hash text NOT NULL,
  format text,
  deleted_at timestamptz,
  PRIMARY KEY (user_id, book_hash)
);
CREATE TABLE public.files (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id),
  book_hash text,
  file_key text NOT NULL,
  replica_kind text,
  deleted_at timestamptz
);
GRANT SELECT ON public.books, public.files TO authenticated;

INSERT INTO auth.users (id) VALUES
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
INSERT INTO public.books (user_id, book_hash, format, deleted_at) VALUES
  ('11111111-1111-4111-8111-111111111111', 'book-a', 'pdf', NULL),
  ('22222222-2222-4222-8222-222222222222', 'book-b', 'pdf', NULL),
  ('11111111-1111-4111-8111-111111111111', 'deleted-book', 'epub', now());
INSERT INTO public.files (id, user_id, book_hash, file_key) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '11111111-1111-4111-8111-111111111111', 'book-a',
   '11111111-1111-4111-8111-111111111111/Readest/Books/book-a/book-a.pdf'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
   '11111111-1111-4111-8111-111111111111', 'book-a',
   '11111111-1111-4111-8111-111111111111/Readest/Books/book-a/cover.png'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   '22222222-2222-4222-8222-222222222222', 'book-b',
   '22222222-2222-4222-8222-222222222222/Readest/Books/book-b/book-b.pdf'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc',
   '22222222-2222-4222-8222-222222222222', 'book-a',
   '22222222-2222-4222-8222-222222222222/Readest/Books/book-a/book-a.pdf'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
   '11111111-1111-4111-8111-111111111111', 'deleted-book',
   '11111111-1111-4111-8111-111111111111/Readest/Books/deleted-book/deleted-book.epub');
