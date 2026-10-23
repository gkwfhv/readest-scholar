BEGIN;
UPDATE public.replicas SET fields_jsonb = '{"writer":"A"}'
WHERE user_id = '11111111-1111-4111-8111-111111111111'
  AND kind = 'dictionary' AND replica_id = 'paper-0003';
\echo SEQ_LOCKED
SELECT pg_sleep(4);
COMMIT;
