-- Synthetic isolated database only; all rows roll back.
\set ON_ERROR_STOP on
SELECT id AS actor_id FROM auth.users ORDER BY id LIMIT 1 \gset
SELECT md5(gen_random_uuid()::text) AS book_hash \gset
BEGIN;
INSERT INTO public.books(user_id,book_hash,format)
  VALUES (:'actor_id',:'book_hash','PDF');
SELECT file_id AS first_file_id, active_version_id AS first_head
  FROM public.register_scholar_file_v1(
    :'actor_id',:'actor_id' || '/Readest/Books/' || :'book_hash' || '/paper.pdf',:'book_hash') \gset
SELECT set_config('probe.file_id',:'first_file_id',true),
       set_config('probe.actor',:'actor_id',true),
       set_config('probe.hash',:'book_hash',true);
DO $probe$
DECLARE retry record; bad boolean:=false; n integer;
BEGIN
  SELECT * INTO retry FROM public.register_scholar_file_v1(
    current_setting('probe.actor')::uuid,
    current_setting('probe.actor') || '/Readest/Books/' || current_setting('probe.hash') || '/paper.pdf',
    current_setting('probe.hash'));
  IF retry.file_id<>current_setting('probe.file_id')::uuid OR retry.active_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'registration retry changed file identity or head';
  END IF;
  SELECT count(*) INTO n FROM public.files WHERE id=retry.file_id AND file_size=0;
  IF n<>1 THEN RAISE EXCEPTION 'placeholder file missing or nonzero'; END IF;
  SELECT count(*) INTO n FROM public.scholar_document_files
    WHERE user_id=current_setting('probe.actor')::uuid
      AND file_id=retry.file_id AND role='original';
  IF n<>1 THEN RAISE EXCEPTION 'Scholar document link missing'; END IF;
  BEGIN
    PERFORM public.register_scholar_file_v1(
      current_setting('probe.actor')::uuid,
      current_setting('probe.actor') || '/Readest/Books/' || current_setting('probe.hash') || '/cover.png',
      current_setting('probe.hash'));
  EXCEPTION WHEN SQLSTATE 'PT409' THEN bad:=true;
  END;
  IF NOT bad THEN RAISE EXCEPTION 'non-PDF key registered as a main file'; END IF;
  IF has_function_privilege('authenticated',
    'public.register_scholar_file_v1(uuid,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated client may register as another account';
  END IF;
END $probe$;
ROLLBACK;
