-- Synthetic accounts and 1001 same-HLC rows expose the old 1000-row cursor loss.
INSERT INTO auth.users (id) VALUES
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

CREATE TABLE public.replicas (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  kind text NOT NULL,
  replica_id text NOT NULL,
  fields_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  manifest_jsonb jsonb,
  deleted_at_ts text,
  reincarnation text,
  updated_at_ts text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  modified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, replica_id)
);

ALTER TABLE public.replicas ENABLE ROW LEVEL SECURITY;
CREATE POLICY replicas_select ON public.replicas FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY replicas_insert ON public.replicas FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY replicas_update ON public.replicas FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id);
GRANT SELECT, INSERT, UPDATE ON public.replicas TO authenticated;

INSERT INTO public.replicas (user_id, kind, replica_id, updated_at_ts)
SELECT '11111111-1111-4111-8111-111111111111', 'dictionary',
       'paper-' || lpad(n::text, 4, '0'), '00000000003e8-00000000-dev-a'
FROM generate_series(1, 1001) AS n;

INSERT INTO public.replicas (user_id, kind, replica_id, updated_at_ts)
VALUES ('22222222-2222-4222-8222-222222222222', 'dictionary',
        'paper-0001', '00000000003e8-00000000-dev-b');
