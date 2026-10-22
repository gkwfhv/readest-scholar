-- Only the account-checked merge RPC and replica update trigger may archive
-- conflict versions. Direct authenticated writes would let a client forge a
-- recovery history entry for its own account.
BEGIN;

DROP POLICY IF EXISTS replica_conflict_versions_insert
  ON public.replica_conflict_versions;
REVOKE INSERT ON public.replica_conflict_versions FROM authenticated;

-- Both functions were created by supabase_admin, the owner of these tables.
-- They retain a fixed search path. The RPC rejects any user id other than
-- auth.uid(); the trigger can only fire through an authorized replica update.
ALTER FUNCTION public.archive_previous_replica_version() SECURITY DEFINER;
ALTER FUNCTION public.crdt_merge_replica_v2(
  uuid, text, text, jsonb, jsonb, text, text, text, integer
) SECURITY DEFINER;

COMMIT;
