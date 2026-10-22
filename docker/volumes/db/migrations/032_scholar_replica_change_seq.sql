-- Phase 3: server-assigned, per-account replica change order.
-- Content HLCs remain CRDT data; clients must not use them as a transport
-- cursor. The counter row lock lasts to commit, so committed changes for one
-- account cannot become visible out of sequence. This migration is additive:
-- the legacy HLC pull route and columns remain available to old clients.
BEGIN;

LOCK TABLE public.replicas IN ACCESS EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS public.replica_change_counters (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  last_seq bigint NOT NULL CHECK (last_seq >= 0)
);
ALTER TABLE public.replica_change_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.replica_change_counters FROM PUBLIC, anon, authenticated;

ALTER TABLE public.replicas ADD COLUMN IF NOT EXISTS change_seq bigint;

-- One-time deterministic backfill. A repeated migration after a completed
-- run finds no null rows; the migration runner also records the file name.
WITH ranked AS (
  SELECT user_id, kind, replica_id,
         row_number() OVER (
           PARTITION BY user_id ORDER BY updated_at_ts, kind, replica_id
         ) AS seq
  FROM public.replicas
  WHERE change_seq IS NULL
)
UPDATE public.replicas AS r
SET change_seq = ranked.seq
FROM ranked
WHERE r.user_id = ranked.user_id
  AND r.kind = ranked.kind
  AND r.replica_id = ranked.replica_id;

INSERT INTO public.replica_change_counters AS c (user_id, last_seq)
SELECT user_id, max(change_seq)
FROM public.replicas
GROUP BY user_id
ON CONFLICT (user_id) DO UPDATE
  SET last_seq = greatest(c.last_seq, EXCLUDED.last_seq);

ALTER TABLE public.replicas ALTER COLUMN change_seq SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_replicas_account_change_seq
  ON public.replicas (user_id, change_seq);
CREATE INDEX IF NOT EXISTS idx_replicas_kind_change_seq
  ON public.replicas (user_id, kind, change_seq);

CREATE OR REPLACE FUNCTION public.assign_replica_change_seq()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'replica user_id cannot change';
  END IF;

  INSERT INTO public.replica_change_counters AS c (user_id, last_seq)
  VALUES (NEW.user_id, 1)
  ON CONFLICT (user_id) DO UPDATE SET last_seq = c.last_seq + 1
  RETURNING last_seq INTO NEW.change_seq;

  NEW.modified_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS replicas_assign_change_seq ON public.replicas;
CREATE TRIGGER replicas_assign_change_seq
BEFORE INSERT OR UPDATE ON public.replicas
FOR EACH ROW EXECUTE FUNCTION public.assign_replica_change_seq();

COMMIT;
