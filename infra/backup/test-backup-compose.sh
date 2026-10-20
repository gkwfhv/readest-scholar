#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/ok" "$tmp/fail" "$tmp/wrapper-fail" "$tmp/wrong-project" "$tmp/staging"

cat > "$tmp/bin/docker" <<'MOCK'
#!/usr/bin/env bash
case "$1" in
  info) exit 0 ;;
  compose)
    if [[ "$*" == *"config --format json"* ]]; then
      printf '{"name":"%s"}\n' "${MOCK_PROJECT:-readest}"
    elif [[ "$*" == *"cp minio:/data"* ]]; then
      if [[ "${MOCK_CP_FAIL:-}" == yes ]]; then exit 1; fi
      mkdir -p "${@: -1}"
      printf '%s\n' object > "${@: -1}/object"
    elif [[ "$*" == *"pg_dump"* ]]; then
      printf '%s\n' '-- PostgreSQL database dump' \
        'CREATE SCHEMA graphql_public;' \
        'GRANT ALL ON FUNCTION graphql_public.graphql(text, text, jsonb, jsonb) TO postgres;'
    else
      if [[ "${MOCK_WRAPPER_FAIL:-}" == yes ]]; then exit 1; fi
      printf '%s\n' \
        "CREATE FUNCTION graphql_public.graphql(text, text, jsonb, jsonb) RETURNS jsonb LANGUAGE sql AS 'SELECT ''{}''::jsonb';"
    fi
    ;;
  *) exit 99 ;;
esac
MOCK
chmod +x "$tmp/bin/docker"

if PATH="$tmp/bin:$PATH" SCHOLAR_COMPOSE_DIR="$root/docker" \
  "$here/backup-compose.sh" "$tmp/ok" >/dev/null 2>&1; then
  echo 'Backup ran without explicit confirmation' >&2
  exit 1
fi

PATH="$tmp/bin:$PATH" SCHOLAR_BACKUP_CONFIRM=yes \
  SCHOLAR_COMPOSE_DIR="$root/docker" \
  "$here/backup-compose.sh" "$tmp/ok" >/dev/null
out="$(find "$tmp/ok" -mindepth 1 -maxdepth 1 -type d -print -quit)"
[[ -n "$out" && -s "$out/postgres.sql" && -s "$out/postgres-restorable.sql" && -s "$out/minio-data/object" ]]
awk '
  /^CREATE FUNCTION graphql_public\.graphql\(/ { wrapper = NR }
  /^GRANT ALL ON FUNCTION graphql_public\.graphql\(/ { grant = NR }
  END { exit !(wrapper > 0 && grant > wrapper) }
' "$out/postgres-restorable.sql"
[[ "$(cat "$out/STATUS")" == complete ]]
mode="$(stat -c %a "$out" 2>/dev/null || stat -f %Lp "$out")"
[[ "$mode" == 700 ]]

if PATH="$tmp/bin:$PATH" MOCK_CP_FAIL=yes SCHOLAR_BACKUP_CONFIRM=yes \
  SCHOLAR_COMPOSE_DIR="$root/docker" \
  "$here/backup-compose.sh" "$tmp/fail" >/dev/null 2>&1; then
  echo 'Backup reported success after object copy failed' >&2
  exit 1
fi
failed="$(find "$tmp/fail" -mindepth 1 -maxdepth 1 -type d -print -quit)"
[[ -n "$failed" && ! -e "$failed/STATUS" ]]
if PATH="$tmp/bin:$PATH" MOCK_WRAPPER_FAIL=yes SCHOLAR_BACKUP_CONFIRM=yes \
  SCHOLAR_COMPOSE_DIR="$root/docker" \
  "$here/backup-compose.sh" "$tmp/wrapper-fail" >/dev/null 2>&1; then
  echo 'Backup reported success without GraphQL wrapper' >&2
  exit 1
fi
failed="$(find "$tmp/wrapper-fail" -mindepth 1 -maxdepth 1 -type d -print -quit)"
[[ -n "$failed" && ! -e "$failed/STATUS" ]]

if PATH="$tmp/bin:$PATH" SCHOLAR_BACKUP_CONFIRM=yes \
  SCHOLAR_COMPOSE_DIR="$root/docker" SCHOLAR_COMPOSE_EXPECTED_PROJECT=scholar-staging \
  "$here/backup-compose.sh" "$tmp/wrong-project" >/dev/null 2>&1; then
  echo 'Backup selected the wrong Compose project' >&2
  exit 1
fi
[[ -z "$(find "$tmp/wrong-project" -mindepth 1 -maxdepth 1 -print -quit)" ]]

PATH="$tmp/bin:$PATH" MOCK_PROJECT=scholar-staging SCHOLAR_BACKUP_CONFIRM=yes \
  SCHOLAR_COMPOSE_DIR="$root/docker" \
  SCHOLAR_COMPOSE_OVERLAY="$root/infra/staging/compose.yaml" \
  SCHOLAR_COMPOSE_EXPECTED_PROJECT=scholar-staging \
  "$here/backup-compose.sh" "$tmp/staging" >/dev/null
staging_out="$(find "$tmp/staging" -mindepth 1 -maxdepth 1 -type d -print -quit)"
[[ -n "$staging_out" && -s "$staging_out/minio-data/object" && "$(cat "$staging_out/STATUS")" == complete ]]
echo 'Backup guard, project isolation, permissions, SQL wrapper, and incomplete-copy tests passed.'
