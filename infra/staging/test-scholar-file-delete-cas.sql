-- Synthetic staging probe. All rows and the file tombstone roll back.
\set ON_ERROR_STOP on
SELECT id AS actor_id FROM auth.users ORDER BY id LIMIT 1 \gset
SELECT gen_random_uuid() AS document_id, gen_random_uuid() AS file_id,
       gen_random_uuid() AS version_id, gen_random_uuid() AS version_op,
       gen_random_uuid() AS delete_op, gen_random_uuid() AS other_id \gset
BEGIN;
SELECT set_config('probe.actor', :'actor_id', true),
       set_config('probe.other', :'other_id', true),
       set_config('probe.file_id', :'file_id', true),
       set_config('probe.version_id', :'version_id', true),
       set_config('probe.delete_op', :'delete_op', true),
       set_config('probe.file_key', :'actor_id' || '/Readest/Books/scholar-delete-probe/probe.pdf', true);
INSERT INTO public.scholar_documents(user_id,id) VALUES (:'actor_id', :'document_id');
INSERT INTO public.files(user_id,id,file_key,file_size)
  VALUES (:'actor_id', :'file_id', :'actor_id' || '/Readest/Books/scholar-delete-probe/probe.pdf', 11);
INSERT INTO public.scholar_document_files(user_id,document_id,file_id,role)
  VALUES (:'actor_id', :'document_id', :'file_id', 'original');
INSERT INTO public.scholar_file_versions(
  user_id,file_id,version_id,op_id,object_key,sha256,file_size,state,verified_at
) VALUES (
  :'actor_id', :'file_id', :'version_id', :'version_op',
  :'actor_id' || '/Scholar/versions/' || :'version_id',
  repeat('a',64),11,'ready',now()
);
INSERT INTO public.scholar_file_heads(user_id,file_id,version_id)
  VALUES (:'actor_id', :'file_id', :'version_id');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'actor_id', true);
DO $probe$
BEGIN
  BEGIN
    PERFORM * FROM public.delete_scholar_file_v1(
      current_setting('probe.file_key'), current_setting('probe.delete_op')::uuid, NULL);
    RAISE EXCEPTION 'stale delete succeeded';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', current_setting('probe.other'), true);
  BEGIN
    PERFORM * FROM public.delete_scholar_file_v1(
      current_setting('probe.file_key'), current_setting('probe.delete_op')::uuid,
      current_setting('probe.version_id')::uuid);
    RAISE EXCEPTION 'cross-account delete succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', current_setting('probe.actor'), true);
END $probe$;
SELECT file_id AS deleted_file,active_version_id AS deleted_head,deleted_at AS deleted_time
  FROM public.delete_scholar_file_v1(:'actor_id' || '/Readest/Books/scholar-delete-probe/probe.pdf',
    :'delete_op', :'version_id') \gset
SELECT file_id AS replayed_file,active_version_id AS replayed_head,deleted_at AS replayed_time
  FROM public.delete_scholar_file_v1(:'actor_id' || '/Readest/Books/scholar-delete-probe/probe.pdf',
    :'delete_op', :'version_id') \gset
SELECT set_config('probe.deleted_file', :'deleted_file', true),
       set_config('probe.replayed_file', :'replayed_file', true),
       set_config('probe.deleted_time', :'deleted_time', true),
       set_config('probe.replayed_time', :'replayed_time', true);
DO $probe$
BEGIN
  IF current_setting('probe.file_id')::uuid <> current_setting('probe.deleted_file')::uuid OR
     current_setting('probe.deleted_file')::uuid <> current_setting('probe.replayed_file')::uuid OR
     current_setting('probe.deleted_time')::timestamptz <>
       current_setting('probe.replayed_time')::timestamptz THEN
    RAISE EXCEPTION 'delete retry was not idempotent';
  END IF;
END $probe$;
RESET ROLE;
DO $probe$
BEGIN
  IF (SELECT deleted_at IS NULL FROM public.files WHERE id=current_setting('probe.file_id')::uuid) THEN
    RAISE EXCEPTION 'file was not tombstoned';
  END IF;
  IF (SELECT count(*) FROM public.scholar_file_versions
      WHERE file_id=current_setting('probe.file_id')::uuid AND state='ready') <> 1 THEN
    RAISE EXCEPTION 'immutable version was removed';
  END IF;
  IF (SELECT version_id FROM public.scholar_file_heads
      WHERE file_id=current_setting('probe.file_id')::uuid) <>
      current_setting('probe.version_id')::uuid THEN
    RAISE EXCEPTION 'head changed on delete';
  END IF;
  IF (SELECT count(*) FROM public.scholar_file_delete_ops
      WHERE file_id=current_setting('probe.file_id')::uuid) <> 1 THEN
    RAISE EXCEPTION 'retry inserted a second delete operation';
  END IF;
END $probe$;
ROLLBACK;
