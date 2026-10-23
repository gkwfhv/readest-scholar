-- A versioned pull primitive. The sequence leaves PostgreSQL as text so
-- PostgREST and JavaScript cannot round a bigint before the API sees it.
-- Invoker rights plus the explicit auth.uid() predicate keep rows account scoped.
BEGIN;

CREATE OR REPLACE FUNCTION public.replica_changes_page(
  p_kind text,
  p_after bigint,
  p_limit integer
)
RETURNS TABLE (seq text, row_data jsonb)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT r.change_seq::text, to_jsonb(r) - 'change_seq'
  FROM public.replicas AS r
  WHERE r.user_id = (SELECT auth.uid())
    AND r.kind = p_kind
    AND r.change_seq > p_after
  ORDER BY r.change_seq
  LIMIT least(greatest(coalesce(p_limit, 1), 1), 1001);
$$;

REVOKE ALL ON FUNCTION public.replica_changes_page(text, bigint, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replica_changes_page(text, bigint, integer)
  TO authenticated;

COMMIT;
