DO $$
BEGIN
  IF (SELECT change_seq FROM public.replicas
      WHERE user_id = '11111111-1111-4111-8111-111111111111'
        AND kind = 'dictionary' AND replica_id = 'paper-0004')
     <= (SELECT change_seq FROM public.replicas
         WHERE user_id = '11111111-1111-4111-8111-111111111111'
           AND kind = 'dictionary' AND replica_id = 'paper-0003') THEN
    RAISE EXCEPTION 'transaction commit order did not match change sequence';
  END IF;
END;
$$;
