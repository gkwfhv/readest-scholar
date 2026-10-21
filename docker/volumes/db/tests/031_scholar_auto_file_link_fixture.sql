-- Files and books written between migrations 030 and 031 must be backfilled.
INSERT INTO public.books (user_id, book_hash, format)
VALUES ('11111111-1111-4111-8111-111111111111', 'pre-file-gap', 'pdf');
INSERT INTO public.files (id, user_id, book_hash, file_key) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa031',
   '11111111-1111-4111-8111-111111111111', 'pre-file-gap',
   '11111111-1111-4111-8111-111111111111/Readest/Books/pre-file-gap/paper.pdf'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa032',
   '11111111-1111-4111-8111-111111111111', 'pre-file-gap',
   '11111111-1111-4111-8111-111111111111/Readest/Books/pre-file-gap/cover.png');

INSERT INTO public.files (id, user_id, book_hash, file_key)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa033',
        '11111111-1111-4111-8111-111111111111', 'pre-book-gap',
        '11111111-1111-4111-8111-111111111111/Readest/Books/pre-book-gap/paper.pdf');
INSERT INTO public.books (user_id, book_hash, format)
VALUES ('11111111-1111-4111-8111-111111111111', 'pre-book-gap', 'pdf');

-- The real files table already has owner RLS. Add it to the synthetic table
-- so the authenticated upload path exercises invoker privileges too.
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
CREATE POLICY synthetic_files_owner ON public.files FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
GRANT INSERT, UPDATE ON public.files TO authenticated;
