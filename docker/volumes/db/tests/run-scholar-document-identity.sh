#!/usr/bin/env bash
set -euo pipefail

# Run the migration against a fresh, isolated Supabase PostgreSQL instance.
# No host port, persistent volume, account credential or existing database is used.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
container="scholar-identity-test-$$"
image="${SCHOLAR_TEST_POSTGRES_IMAGE:-supabase/postgres:15.8.1.085}"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --rm -d --name "$container" \
  -e POSTGRES_PASSWORD=scholar_synthetic_test "$image" >/dev/null

ready=false
for _ in $(seq 1 90); do
  if [ "$(docker inspect --format '{{.State.Health.Status}}' "$container")" = healthy ] && \
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

docker cp "$script_dir/029_scholar_document_identity_fixture.sql" "$container:/tmp/fixture.sql"
docker cp "$script_dir/../migrations/029_scholar_document_file_identity.sql" "$container:/tmp/migration.sql"
docker cp "$script_dir/029_scholar_document_identity_assertions.sql" "$container:/tmp/assertions.sql"
docker cp "$script_dir/030_scholar_document_auto_link_fixture.sql" "$container:/tmp/auto-fixture.sql"
docker cp "$script_dir/../migrations/030_scholar_auto_document_for_books.sql" "$container:/tmp/auto-migration.sql"
docker cp "$script_dir/030_scholar_document_auto_link_assertions.sql" "$container:/tmp/auto-assertions.sql"
docker cp "$script_dir/031_scholar_auto_file_link_fixture.sql" "$container:/tmp/file-fixture.sql"
docker cp "$script_dir/../migrations/031_scholar_auto_file_link.sql" "$container:/tmp/file-migration.sql"
docker cp "$script_dir/031_scholar_auto_file_link_assertions.sql" "$container:/tmp/file-assertions.sql"

for sql in fixture migration assertions auto-fixture auto-migration auto-assertions \
  file-fixture file-migration file-assertions; do
  docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f "/tmp/$sql.sql"
done
