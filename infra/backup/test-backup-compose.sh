#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/ok" "$tmp/fail" "$tmp/wrapper-fail"

cat > "$tmp/bin/docker" <<'MOCK'
#!/usr/bin/env bash
case "$1" in
  info) exit 0 ;;
  compose)
    if [[ "$*" == *"pg_dump"* ]]; then
      printf '%s\n' '-- PostgreSQL database dump' \
        'CREATE SCHEMA graphql_public;' \
        'GRANT ALL ON FUNCTION graphql_public.graphql(text, text, jsonb, jsonb) TO postgres;'
    else
      if [[ "${MOCK_WRAPPER_FAIL:-}" == yes ]]; then exit 1; fi
      printf '%s\n' \
        "CREATE FUNCTION graphql_public.graphql(text, text, jsonb, jsonb) RETURNS jsonb LANGUAGE sql AS 'SELECT ''{}''::jsonb';"
    fi
    ;;
  cp)
    if [[ "${MOCK_CP_FAIL:-}" == yes ]]; then exit 1; fi
    mkdir -p "$3"
    printf '%s\n' object > "$3/object"
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
mode="$(stat -f %Lp "$out" 2>/dev/null || stat -c %a "$out")"
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
echo 'Backup guard, permissions, SQL wrapper, and incomplete-copy tests passed.'
