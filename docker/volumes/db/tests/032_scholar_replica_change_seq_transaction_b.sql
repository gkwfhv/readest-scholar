BEGIN;
UPDATE public.replicas SET fields_jsonb = '{"writer":"B"}'
WHERE user_id = '11111111-1111-4111-8111-111111111111'
  AND kind = 'dictionary' AND replica_id = 'paper-0004';
COMMIT;
