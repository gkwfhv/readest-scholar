-- Rows written after migration 029 but before 030, plus a legacy tombstone.
INSERT INTO public.books (user_id, book_hash, format)
VALUES ('11111111-1111-4111-8111-111111111111', 'gap-book', 'pdf');
INSERT INTO public.books (user_id, book_hash, format, deleted_at)
VALUES ('11111111-1111-4111-8111-111111111111', 'resurrect-book', 'pdf', now());

ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
CREATE POLICY synthetic_books_owner ON public.books FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
GRANT SELECT, INSERT, UPDATE ON public.books TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.books TO service_role;
