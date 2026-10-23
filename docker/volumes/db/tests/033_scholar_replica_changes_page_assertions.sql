-- Run immediately after migration 032, before the write-path assertions.
SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
DO $$
DECLARE
  boundary bigint;
  tail_count integer;
  total_count integer;
BEGIN
  SELECT max(seq::bigint) INTO boundary FROM
    public.replica_changes_page('dictionary', 0, 1000);
  SELECT count(*) INTO tail_count FROM
    public.replica_changes_page('dictionary', boundary, 1000);
  SELECT count(*) INTO total_count FROM
    public.replica_changes_page('dictionary', 0, 1001);
  IF boundary <> 1000 OR tail_count <> 1 OR total_count <> 1001 THEN
    RAISE EXCEPTION 'change pages lost equal-HLC row at 1000/1001: %, %, %',
      boundary, tail_count, total_count;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.replica_changes_page('dictionary', 0, 1001)
    WHERE row_data->>'user_id' <> '11111111-1111-4111-8111-111111111111'
  ) THEN
    RAISE EXCEPTION 'page leaked another account';
  END IF;
END;
$$;
RESET ROLE;

SET ROLE authenticated;
SET request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
DO $$
BEGIN
  IF (SELECT count(*) FROM public.replica_changes_page('dictionary', 0, 1001)) <> 1
     OR (SELECT seq FROM public.replica_changes_page('dictionary', 0, 1001)) <> '1' THEN
    RAISE EXCEPTION 'account B page was not isolated';
  END IF;
END;
$$;
RESET ROLE;

-- An old content HLC update is still visible after the prior transport cursor.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
UPDATE public.replicas SET fields_jsonb = '{"offline":true}'
WHERE user_id = '11111111-1111-4111-8111-111111111111'
  AND kind = 'dictionary' AND replica_id = 'paper-0001';
DO $$
BEGIN
  IF (SELECT count(*) FROM public.replica_changes_page('dictionary', 1001, 2)
      WHERE row_data->>'updated_at_ts' = '00000000003e8-00000000-dev-a') <> 1 THEN
    RAISE EXCEPTION 'old content HLC update was missed by change cursor';
  END IF;
END;
$$;
ROLLBACK;

SET ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.replica_changes_page('dictionary', 0, 1);
    RAISE EXCEPTION 'anonymous role can execute replica changes RPC';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;
RESET ROLE;

-- A sequence beyond JavaScript's exact integer range must be emitted as text.
BEGIN;
UPDATE public.replica_change_counters
SET last_seq = 9007199254740992
WHERE user_id = '11111111-1111-4111-8111-111111111111';
INSERT INTO public.replicas (user_id, kind, replica_id, updated_at_ts)
VALUES ('11111111-1111-4111-8111-111111111111', 'dictionary',
        'high-precision-seq', '00000000003e8-00000000-dev-a');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
DO $$
BEGIN
  IF (SELECT seq FROM public.replica_changes_page(
      'dictionary', 9007199254740992, 2)) <> '9007199254740993' THEN
    RAISE EXCEPTION 'bigint sequence lost precision in RPC';
  END IF;
END;
$$;
ROLLBACK;
