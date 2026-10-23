BEGIN;

-- Ciphertext only. All access goes through the authenticated Scholar API;
-- browser and ordinary authenticated SQL roles receive no table grant.
CREATE TABLE public.scholar_ai_credentials (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('aiGatewayApiKey', 'openrouterApiKey')),
  nonce text NOT NULL,
  ciphertext text NOT NULL,
  auth_tag text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind)
);
ALTER TABLE public.scholar_ai_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.scholar_ai_credentials FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.scholar_ai_credentials TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
