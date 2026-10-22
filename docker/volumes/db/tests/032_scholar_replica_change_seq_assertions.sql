-- Backfilled rows with identical HLCs must all be reachable across page 1000.
DO $$
DECLARE
  first_cursor bigint;
  remaining integer;
  account_b_sequence bigint;
BEGIN
  SELECT max(change_seq) INTO first_cursor
  FROM (
    SELECT change_seq FROM public.replicas
    WHERE user_id = '11111111-1111-4111-8111-111111111111' AND kind = 'dictionary'
    ORDER BY change_seq
    LIMIT 1000
  ) first_page;
  SELECT count(*) INTO remaining FROM public.replicas
  WHERE user_id = '11111111-1111-4111-8111-111111111111'
    AND kind = 'dictionary' AND change_seq > first_cursor;
  IF first_cursor <> 1000 OR remaining <> 1 THEN
    RAISE EXCEPTION 'same-HLC rows were lost after page 1000: cursor=%, remaining=%',
      first_cursor, remaining;
  END IF;
  SELECT change_seq INTO account_b_sequence FROM public.replicas
  WHERE user_id = '22222222-2222-4222-8222-222222222222';
  IF account_b_sequence <> 1 THEN
    RAISE EXCEPTION 'second account did not have its own sequence: %',
      account_b_sequence;
  END IF;
END;
$$;

-- A changed old field timestamp must still receive a new transport sequence.
SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
DO $$
BEGIN
  IF (SELECT count(*) FROM public.replicas) <> 1001 THEN
    RAISE EXCEPTION 'RLS leaked another account before update';
  END IF;
END;
$$;
UPDATE public.replicas
SET fields_jsonb = '{"name":{"v":"offline edit","t":"00000000003e8-00000000-dev-a","s":"dev-a"}}'
WHERE user_id = '11111111-1111-4111-8111-111111111111'
  AND kind = 'dictionary' AND replica_id = 'paper-0001';
DO $$
DECLARE
  seq bigint;
  content_hlc text;
BEGIN
  SELECT change_seq, updated_at_ts INTO seq, content_hlc
  FROM public.replicas WHERE replica_id = 'paper-0001';
  IF seq <= 1001 OR content_hlc <> '00000000003e8-00000000-dev-a' THEN
    RAISE EXCEPTION 'old content HLC was coupled to transport order: seq=%, HLC=%',
      seq, content_hlc;
  END IF;
  IF (SELECT count(*) FROM public.replicas
      WHERE user_id = '22222222-2222-4222-8222-222222222222') <> 0 THEN
    RAISE EXCEPTION 'RLS exposed account B';
  END IF;
END;
$$;
INSERT INTO public.replicas (user_id, kind, replica_id, updated_at_ts)
VALUES ('11111111-1111-4111-8111-111111111111', 'dictionary',
        'new-after-migration', '00000000003e8-00000000-dev-a');
DO $$
BEGIN
  IF (SELECT change_seq FROM public.replicas
      WHERE replica_id = 'new-after-migration') <= 1002 THEN
    RAISE EXCEPTION 'new row was not assigned a transport sequence';
  END IF;
END;
$$;
INSERT INTO public.replicas (user_id, kind, replica_id, updated_at_ts, fields_jsonb)
VALUES ('11111111-1111-4111-8111-111111111111', 'dictionary',
        'new-after-migration', '00000000003e8-00000000-dev-a', '{"retry":true}')
ON CONFLICT (user_id, kind, replica_id) DO UPDATE
SET fields_jsonb = EXCLUDED.fields_jsonb;
DO $$
BEGIN
  IF (SELECT change_seq FROM public.replicas
      WHERE replica_id = 'new-after-migration') <= 1003 THEN
    RAISE EXCEPTION 'conflict update did not receive a fresh sequence';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.replica_change_counters LIMIT 1;
    RAISE EXCEPTION 'authenticated clients can read internal counters';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;
RESET ROLE;

-- Account B advances independently; A's 1002+ revisions do not move it.
SET ROLE authenticated;
SET request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
UPDATE public.replicas SET fields_jsonb = '{"name":{"v":"account B"}}'
WHERE user_id = '22222222-2222-4222-8222-222222222222'
  AND kind = 'dictionary' AND replica_id = 'paper-0001';
DO $$
BEGIN
  IF (SELECT change_seq FROM public.replicas) <> 2 THEN
    RAISE EXCEPTION 'account B did not advance independently';
  END IF;
END;
$$;
RESET ROLE;

-- A failed transaction must not consume an account sequence.
CREATE TEMP TABLE before_rollback AS
SELECT last_seq FROM public.replica_change_counters
WHERE user_id = '11111111-1111-4111-8111-111111111111';
BEGIN;
UPDATE public.replicas SET fields_jsonb = '{"rollback":true}'
WHERE user_id = '11111111-1111-4111-8111-111111111111'
  AND kind = 'dictionary' AND replica_id = 'paper-0002';
ROLLBACK;
DO $$
BEGIN
  IF (SELECT last_seq FROM public.replica_change_counters
      WHERE user_id = '11111111-1111-4111-8111-111111111111')
     <> (SELECT last_seq FROM before_rollback) THEN
    RAISE EXCEPTION 'rolled-back write consumed a sequence';
  END IF;
END;
$$;
