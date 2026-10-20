#!/usr/bin/env bash
# Backup one explicitly selected Readest Compose project.
# Verified against compose.yaml at Readest 2d37bbfc:
#   db container_name supabase-db, database POSTGRES_DB
#   minio service mounts data at /data
# Does not start containers, change ports, or print secrets.
set -euo pipefail
umask 077

if [[ "${SCHOLAR_BACKUP_CONFIRM:-}" != "yes" ]]; then
  echo "Refusing to run. Set SCHOLAR_BACKUP_CONFIRM=yes for a local test stack." >&2
  exit 2
fi

compose_dir="${SCHOLAR_COMPOSE_DIR:-}"
dest="${1:-}"
if [[ ! -f "$compose_dir/compose.yaml" || -z "$dest" || "$dest" != /* ]]; then
  echo "Usage: SCHOLAR_BACKUP_CONFIRM=yes SCHOLAR_COMPOSE_DIR=/path/to/readest-scholar/docker $0 /absolute/backup-directory" >&2
  exit 2
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running." >&2
  exit 3
fi

compose=(docker compose)
if [[ -n "${SCHOLAR_ENV_FILE:-}" ]]; then
  [[ -f "$SCHOLAR_ENV_FILE" ]] || { echo "Staging env file is missing." >&2; exit 2; }
  compose+=(--env-file "$SCHOLAR_ENV_FILE")
fi
compose+=(-f "$compose_dir/compose.yaml")
if [[ -n "${SCHOLAR_COMPOSE_OVERLAY:-}" ]]; then
  [[ -f "$SCHOLAR_COMPOSE_OVERLAY" ]] || { echo "Compose overlay is missing." >&2; exit 2; }
  compose+=(-f "$SCHOLAR_COMPOSE_OVERLAY")
fi
expected_project="${SCHOLAR_COMPOSE_EXPECTED_PROJECT:-readest}"
actual_project="$("${compose[@]}" config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')"
if [[ "$actual_project" != "$expected_project" ]]; then
  echo "Refusing backup: expected Compose project $expected_project, found $actual_project." >&2
  exit 2
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$dest/$stamp"
mkdir -p "$dest"
mkdir "$out"

(
  cd "$compose_dir"
  "${compose[@]}" exec -T db sh -c 'pg_dump -U supabase_admin "$POSTGRES_DB"'
) > "$out/postgres.sql"
if [[ ! -s "$out/postgres.sql" ]]; then
  echo "Database dump is empty; backup is incomplete: $out" >&2
  exit 4
fi

# Supabase's pg_graphql extension creates this public wrapper through an event
# trigger. pg_dump records its grants but omits the extension-generated
# function, so a plain SQL restore stops at the first GRANT. Preserve the
# exact function definition from this database and insert it before that GRANT.
(
  cd "$compose_dir"
  "${compose[@]}" exec -T db psql -X -A -t -U supabase_admin \
    -c "SELECT pg_get_functiondef('graphql_public.graphql(text,text,jsonb,jsonb)'::regprocedure)"
  printf ';\n'
) > "$out/graphql-wrapper.sql"
if [[ ! -s "$out/graphql-wrapper.sql" ]]; then
  echo "GraphQL wrapper is missing; backup is incomplete: $out" >&2
  exit 4
fi
awk -v wrapper="$out/graphql-wrapper.sql" '
  !inserted && /^GRANT ALL ON FUNCTION graphql_public\.graphql\(/ {
    while ((getline line < wrapper) > 0) print line
    close(wrapper)
    inserted = 1
  }
  { print }
  END { if (!inserted) exit 1 }
' "$out/postgres.sql" > "$out/postgres-restorable.sql"

"${compose[@]}" cp minio:/data "$out/minio-data"
printf 'complete\n' > "$out/STATUS"

echo "Backup written to $out"
echo "This copy has not been restored. Rehearse into an empty stack before reuse."
