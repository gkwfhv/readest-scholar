-- User-owned glossary snapshots for PDF translation. The queue references a
-- content hash; changing a glossary creates a new identity and cache namespace.
BEGIN;

CREATE TABLE public.scholar_translation_glossaries (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  csv_text text NOT NULL CHECK (octet_length(csv_text) BETWEEN 22 AND 65536),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sha256)
);
ALTER TABLE public.scholar_translation_glossaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY scholar_translation_glossaries_owner
  ON public.scholar_translation_glossaries FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
REVOKE ALL ON public.scholar_translation_glossaries FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.scholar_translation_glossaries TO authenticated;
GRANT ALL ON public.scholar_translation_glossaries TO service_role;

CREATE FUNCTION public.scholar_translation_glossary_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.glossary_sha256 IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.scholar_translation_glossaries
    WHERE user_id=NEW.user_id AND sha256=NEW.glossary_sha256
  ) THEN
    RAISE EXCEPTION 'translation glossary not found' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER scholar_translation_glossary_guard
  BEFORE INSERT ON public.scholar_translation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.scholar_translation_glossary_guard_v1();
REVOKE ALL ON FUNCTION public.scholar_translation_glossary_guard_v1()
  FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
