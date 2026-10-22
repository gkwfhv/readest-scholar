-- Compare-and-restore one archived metadata field without overwriting a
-- newer edit made after the recovery view was opened. The account counter is
-- locked first, matching the replica change-sequence trigger's lock order.
BEGIN;

CREATE OR REPLACE FUNCTION public.restore_replica_field_v1(
  p_user_id uuid,
  p_kind text,
  p_replica_id text,
  p_source text,
  p_version_hash text,
  p_field text,
  p_expected_current jsonb,
  p_new_hlc text
) RETURNS public.replicas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  saved jsonb;
  current_row public.replicas;
  current_field jsonb;
  new_field jsonb;
  result public.replicas;
  future_limit text;
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'replica account mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN (
    'settings', 'opds_catalog', 'abs_server', 'custom_translator',
    'translation_prompt', 'custom_tts'
  ) OR p_field IS NULL OR length(p_field) NOT BETWEEN 1 AND 256
     OR p_source NOT IN ('previous', 'incoming')
     OR p_version_hash !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'invalid restore target' USING ERRCODE = '22023';
  END IF;
  IF p_new_hlc IS NULL OR p_new_hlc !~ '^[0-9a-f]{13}-[0-9a-f]{8}-.+$' THEN
    RAISE EXCEPTION 'invalid restore clock' USING ERRCODE = '22023';
  END IF;
  future_limit := lpad(
    to_hex((extract(epoch from clock_timestamp()) * 1000)::bigint + 60000),
    13, '0'
  );
  IF left(p_new_hlc, 13) > future_limit THEN
    RAISE EXCEPTION 'restore clock is too far in the future'
      USING ERRCODE = '22023';
  END IF;

  SELECT v.row_data -> 'fields_jsonb' -> p_field INTO saved
  FROM public.replica_conflict_versions AS v
  WHERE v.user_id = p_user_id AND v.kind = p_kind
    AND v.replica_id = p_replica_id AND v.source = p_source
    AND v.version_hash = p_version_hash;
  IF NOT FOUND OR saved IS NULL OR jsonb_typeof(saved) <> 'object'
     OR saved -> 'v' IS NULL THEN
    RAISE EXCEPTION 'archived field not found' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.replica_change_counters
  WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'replica change counter missing' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO current_row FROM public.replicas
  WHERE user_id = p_user_id AND kind = p_kind AND replica_id = p_replica_id
  FOR UPDATE;
  IF NOT FOUND OR current_row.manifest_jsonb IS NOT NULL
     OR current_row.deleted_at_ts IS NOT NULL
     OR current_row.reincarnation IS NOT NULL THEN
    RAISE EXCEPTION 'metadata row is unavailable' USING ERRCODE = '22023';
  END IF;
  current_field := current_row.fields_jsonb -> p_field;
  IF current_field IS DISTINCT FROM p_expected_current THEN
    RAISE EXCEPTION 'field changed since conflict review'
      USING ERRCODE = '40001';
  END IF;
  IF p_new_hlc <= COALESCE(current_field ->> 't', '') THEN
    RAISE EXCEPTION 'restore clock must be newer than current field'
      USING ERRCODE = '22023';
  END IF;
  new_field := jsonb_build_object(
    'v', saved -> 'v', 't', p_new_hlc, 's', 'scholar-restore'
  );
  UPDATE public.replicas AS r SET
    fields_jsonb = jsonb_set(r.fields_jsonb, ARRAY[p_field], new_field, true),
    updated_at_ts = greatest(r.updated_at_ts, p_new_hlc)
  WHERE r.user_id = p_user_id AND r.kind = p_kind
    AND r.replica_id = p_replica_id
  RETURNING * INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_replica_field_v1(
  uuid, text, text, text, text, text, jsonb, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_replica_field_v1(
  uuid, text, text, text, text, text, jsonb, text
) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
