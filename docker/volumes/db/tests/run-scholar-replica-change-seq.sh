#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
container="scholar-replica-seq-test-$$"
image="${SCHOLAR_TEST_POSTGRES_IMAGE:-supabase/postgres:15.8.1.085}"
first_log=""
second_log=""

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  [ -z "$first_log" ] || rm -f "$first_log"
  [ -z "$second_log" ] || rm -f "$second_log"
}
trap cleanup EXIT

docker run --rm -d --name "$container" \
  -e POSTGRES_PASSWORD=scholar_synthetic_test "$image" >/dev/null

ready=false
for _ in $(seq 1 90); do
  if [ "$(docker inspect --format '{{.State.Health.Status}}' "$container")" = healthy ] &&
     docker exec "$container" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [ "$ready" != true ]; then
  docker logs --tail 40 "$container" >&2
  exit 1
fi

docker cp "$script_dir/032_scholar_replica_change_seq_fixture.sql" "$container:/tmp/fixture.sql"
docker cp "$script_dir/032_scholar_replica_change_seq_assertions.sql" "$container:/tmp/assertions.sql"
docker exec -e PGPASSWORD=scholar_synthetic_test "$container" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -f /tmp/fixture.sql

if [ "${SCHOLAR_REPLICA_SEQ_SKIP_MIGRATION:-0}" != 1 ]; then
  docker cp "$script_dir/../migrations/032_scholar_replica_change_seq.sql" "$container:/tmp/migration.sql"
  docker exec -e PGPASSWORD=scholar_synthetic_test "$container" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -f /tmp/migration.sql
  if [ "${SCHOLAR_REPLICA_SEQ_REPEAT_MIGRATION:-0}" = 1 ]; then
    docker exec -e PGPASSWORD=scholar_synthetic_test "$container" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -f /tmp/migration.sql
  fi
fi

if [ "${SCHOLAR_REPLICA_SEQ_SKIP_MIGRATION:-0}" != 1 ]; then
  docker cp "$script_dir/../migrations/033_scholar_replica_changes_page.sql" "$container:/tmp/page-migration.sql"
  docker cp "$script_dir/033_scholar_replica_changes_page_assertions.sql" "$container:/tmp/page-assertions.sql"
  if [ "${SCHOLAR_REPLICA_SEQ_SKIP_PAGE_MIGRATION:-0}" != 1 ]; then
    docker exec -e PGPASSWORD=scholar_synthetic_test "$container" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -f /tmp/page-migration.sql
    if [ "${SCHOLAR_REPLICA_SEQ_REPEAT_MIGRATION:-0}" = 1 ]; then
      docker exec -e PGPASSWORD=scholar_synthetic_test "$container" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -f /tmp/page-migration.sql
    fi
  fi
  docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/page-assertions.sql
fi
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/assertions.sql

# Writer B must wait for writer A's transaction to commit before receiving
# the next sequence. This tests the per-account counter row lock, not just the
# final numeric ordering after both writers happen to finish.
docker cp "$script_dir/032_scholar_replica_change_seq_transaction_a.sql" "$container:/tmp/txn-a.sql"
docker cp "$script_dir/032_scholar_replica_change_seq_transaction_b.sql" "$container:/tmp/txn-b.sql"
first_log="$(mktemp)"
second_log="$(mktemp)"
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/txn-a.sql >"$first_log" 2>&1 &
first_pid=$!
locked=false
for _ in $(seq 1 50); do
  if grep -q SEQ_LOCKED "$first_log"; then
    locked=true
    break
  fi
  sleep 0.1
done
if [ "$locked" != true ]; then
  cat "$first_log" >&2
  exit 1
fi

docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/txn-b.sql >"$second_log" 2>&1 &
second_pid=$!
sleep 0.3
if ! kill -0 "$second_pid" 2>/dev/null; then
  cat "$second_log" >&2
  echo "writer B finished before writer A committed" >&2
  exit 1
fi
visible_b="$(docker exec "$container" psql -At -U postgres -d postgres -c "
  SELECT change_seq FROM public.replicas
  WHERE user_id = '11111111-1111-4111-8111-111111111111'
    AND kind = 'dictionary' AND replica_id = 'paper-0004'")"
if [ "$visible_b" != 4 ]; then
  echo "writer B became visible while writer A was uncommitted: $visible_b" >&2
  exit 1
fi
wait "$first_pid"
wait "$second_pid"
docker cp "$script_dir/032_scholar_replica_change_seq_transaction_assertions.sql" "$container:/tmp/txn-assertions.sql"
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/txn-assertions.sql
