-- Scholar's logical document ID is independent of Readest's file-content hash
-- and of the storage row's UUID. Existing reading/sync keys stay unchanged.
-- A document can group several reader books and several owned binary files.
-- This migration is additive; old clients continue to use books and files.

BEGIN;

-- A same-owner composite FK must be backed by a unique key. files.id remains
-- the original primary key; this index only makes the ownership check atomic.
CREATE UNIQUE INDEX IF NOT EXISTS idx_files_user_id_id
  ON public.files (user_id, id);

CREATE TABLE public.scholar_documents (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE TABLE public.scholar_document_books (
  user_id uuid NOT NULL,
  document_id uuid NOT NULL,
  book_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, book_hash),
  FOREIGN KEY (user_id, document_id)
    REFERENCES public.scholar_documents (user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, book_hash)
    REFERENCES public.books (user_id, book_hash) ON DELETE CASCADE
);
CREATE INDEX idx_scholar_document_books_document
  ON public.scholar_document_books (user_id, document_id);

CREATE TABLE public.scholar_document_files (
  user_id uuid NOT NULL,
  document_id uuid NOT NULL,
  file_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('original', 'translation', 'supplement', 'version')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, file_id),
  FOREIGN KEY (user_id, document_id)
    REFERENCES public.scholar_documents (user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, file_id)
    REFERENCES public.files (user_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_scholar_document_files_document
  ON public.scholar_document_files (user_id, document_id, role);

-- Give each currently live book a stable document ID. The temporary mapping
-- keeps the inserts deterministic within this migration; no book_hash changes.
CREATE TEMP TABLE scholar_document_backfill ON COMMIT DROP AS
  SELECT b.user_id, b.book_hash, gen_random_uuid() AS document_id, b.format
  FROM public.books b
  WHERE b.deleted_at IS NULL;

INSERT INTO public.scholar_documents (user_id, id)
  SELECT user_id, document_id FROM scholar_document_backfill;

INSERT INTO public.scholar_document_books (user_id, document_id, book_hash)
  SELECT user_id, document_id, book_hash FROM scholar_document_backfill;

-- Only attach the known top-level Readest book binary. A row sharing a hash
-- may instead be cover.png or another auxiliary file; those are not scholarly
-- attachments. Unknown layouts remain unlinked for explicit later review.
INSERT INTO public.scholar_document_files (user_id, document_id, file_id, role)
  SELECT f.user_id, b.document_id, f.id, 'original'
  FROM public.files f
  JOIN scholar_document_backfill b
    ON b.user_id = f.user_id AND b.book_hash = f.book_hash
  WHERE f.deleted_at IS NULL
    AND f.replica_kind IS NULL
    AND b.format IS NOT NULL
    AND split_part(f.file_key, '/', 1) = f.user_id::text
    AND split_part(f.file_key, '/', 2) = 'Readest'
    AND split_part(f.file_key, '/', 3) = 'Books'
    AND split_part(f.file_key, '/', 4) = f.book_hash
    AND split_part(f.file_key, '/', 5) <> ''
    AND split_part(f.file_key, '/', 6) = ''
    AND lower(right(f.file_key, length(b.format) + 1)) = '.' || lower(b.format);

ALTER TABLE public.scholar_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scholar_document_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scholar_document_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY scholar_documents_owner ON public.scholar_documents
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY scholar_document_books_owner ON public.scholar_document_books
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY scholar_document_files_owner ON public.scholar_document_files
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.scholar_documents, public.scholar_document_books,
  public.scholar_document_files FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scholar_documents,
  public.scholar_document_books, public.scholar_document_files TO authenticated;
GRANT ALL ON public.scholar_documents, public.scholar_document_books,
  public.scholar_document_files TO service_role;

COMMIT;
