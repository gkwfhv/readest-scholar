-- Phase 3: retain both sides of a replica field collision for recovery.
-- History is append-only and account scoped. The current row remains the
-- CRDT winner; this table holds the previous server row and any losing
-- incoming version. Repeated delivery is deduplicated by content hash.
BEGIN;

CREATE TABLE public.replica_conflict_versions (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  kind text NOT NULL,
  replica_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('previous', 'incoming')),
  version_hash text NOT NULL,
  row_data jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, replica_id, source, version_hash),
  CONSTRAINT replica_conflict_versions_size CHECK (pg_column_size(row_data) <= 131072)
);
CREATE INDEX replica_conflict_versions_account_time
  ON public.replica_conflict_versions (user_id, recorded_at DESC);

ALTER TABLE public.replica_conflict_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY replica_conflict_versions_select ON public.replica_conflict_versions
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY replica_conflict_versions_insert ON public.replica_conflict_versions
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
REVOKE ALL ON public.replica_conflict_versions FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.replica_conflict_versions TO authenticated;

CREATE OR REPLACE FUNCTION public.archive_previous_replica_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  old_data jsonb;
BEGIN
  IF OLD.fields_jsonb IS NOT DISTINCT FROM NEW.fields_jsonb
     AND OLD.manifest_jsonb IS NOT DISTINCT FROM NEW.manifest_jsonb
     AND OLD.deleted_at_ts IS NOT DISTINCT FROM NEW.deleted_at_ts
     AND OLD.reincarnation IS NOT DISTINCT FROM NEW.reincarnation
     AND OLD.schema_version IS NOT DISTINCT FROM NEW.schema_version THEN
    RETURN NULL;
  END IF;
  old_data := to_jsonb(OLD) - 'created_at' - 'modified_at' - 'change_seq';
  INSERT INTO public.replica_conflict_versions
    (user_id, kind, replica_id, source, version_hash, row_data)
  VALUES
    (OLD.user_id, OLD.kind, OLD.replica_id, 'previous', md5(old_data::text), old_data)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;

CREATE TRIGGER replicas_archive_previous_version
AFTER UPDATE ON public.replicas
FOR EACH ROW EXECUTE FUNCTION public.archive_previous_replica_version();

-- Preserve the incoming branch when its field envelope loses to an existing
-- remote value. This wrapper keeps the original RPC available to old apps.
CREATE OR REPLACE FUNCTION public.crdt_merge_replica_v2(
  p_user_id uuid,
  p_kind text,
  p_replica_id text,
  p_fields_jsonb jsonb,
  p_manifest_jsonb jsonb,
  p_deleted_at_ts text,
  p_reincarnation text,
  p_updated_at_ts text,
  p_schema_version integer
) RETURNS public.replicas
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  result public.replicas;
  incoming_data jsonb;
BEGIN
  IF p_user_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'replica account mismatch' USING ERRCODE = '42501';
  END IF;
  -- A replay whose metadata fields all lost or were already applied must
  -- not create a new transport change. CRDT field maxima are monotone, so
  -- a concurrent writer cannot make an already-losing envelope win. A plain
  -- read also avoids reversing the counter-then-row lock order of inserts.
  IF p_kind IN (
    'settings', 'opds_catalog', 'abs_server', 'custom_translator',
    'translation_prompt', 'custom_tts'
  ) AND p_manifest_jsonb IS NULL AND p_deleted_at_ts IS NULL
    AND p_reincarnation IS NULL THEN
    SELECT r.* INTO result FROM public.replicas AS r
    WHERE r.user_id = p_user_id AND r.kind = p_kind AND r.replica_id = p_replica_id;
    IF NOT FOUND OR result.manifest_jsonb IS NOT NULL
      OR result.deleted_at_ts IS NOT NULL OR result.reincarnation IS NOT NULL
      OR p_schema_version > result.schema_version
      OR public.crdt_merge_fields(
        result.fields_jsonb, COALESCE(p_fields_jsonb, '{}'::jsonb)
      ) IS DISTINCT FROM result.fields_jsonb THEN
      result := public.crdt_merge_replica(
        p_user_id, p_kind, p_replica_id, p_fields_jsonb, p_manifest_jsonb,
        p_deleted_at_ts, p_reincarnation, p_updated_at_ts, p_schema_version
      );
    END IF;
  ELSE
    result := public.crdt_merge_replica(
      p_user_id, p_kind, p_replica_id, p_fields_jsonb, p_manifest_jsonb,
      p_deleted_at_ts, p_reincarnation, p_updated_at_ts, p_schema_version
    );
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(COALESCE(p_fields_jsonb, '{}'::jsonb)) AS f(key, value)
    WHERE result.fields_jsonb -> f.key IS DISTINCT FROM f.value
  ) THEN
    incoming_data := jsonb_build_object(
      'user_id', p_user_id, 'kind', p_kind, 'replica_id', p_replica_id,
      'fields_jsonb', COALESCE(p_fields_jsonb, '{}'::jsonb),
      'manifest_jsonb', p_manifest_jsonb, 'deleted_at_ts', p_deleted_at_ts,
      'reincarnation', p_reincarnation, 'updated_at_ts', p_updated_at_ts,
      'schema_version', p_schema_version
    );
    INSERT INTO public.replica_conflict_versions
      (user_id, kind, replica_id, source, version_hash, row_data)
    VALUES
      (p_user_id, p_kind, p_replica_id, 'incoming', md5(incoming_data::text), incoming_data)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.crdt_merge_replica_v2(
  uuid, text, text, jsonb, jsonb, text, text, text, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crdt_merge_replica_v2(
  uuid, text, text, jsonb, jsonb, text, text, text, integer
) TO authenticated;

COMMIT;
