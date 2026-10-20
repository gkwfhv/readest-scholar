#!/usr/bin/env bash
# Rehearse a failed Web-only deployment against disposable, tunnel-only staging.
# The database and object storage are not recreated. This does not exercise a
# schema migration or prove that a real candidate image is backward compatible.
set -euo pipefail
umask 077

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
environment="$root/docker/.env"
compose=(docker compose --env-file "$environment" -f "$root/docker/compose.yaml" -f "$root/infra/staging/compose.yaml")
backups="${SCHOLAR_STAGING_BACKUPS:-$HOME/scholar-staging-backups}"

"${compose[@]}" config --format json | python3 -c '
import json,sys
c=json.load(sys.stdin)
assert c["name"] == "scholar-staging"
assert all(p["host_ip"] == "127.0.0.1" for s in c["services"].values() for p in s.get("ports", []))
'
python3 infra/staging/check-readiness.py

SCHOLAR_BACKUP_CONFIRM=yes \
  SCHOLAR_COMPOSE_DIR="$root/docker" \
  SCHOLAR_COMPOSE_OVERLAY="$root/infra/staging/compose.yaml" \
  SCHOLAR_COMPOSE_EXPECTED_PROJECT=scholar-staging \
  SCHOLAR_ENV_FILE="$environment" \
  bash infra/backup/backup-compose.sh "$backups"

temporary="$(mktemp -d)"
cat > "$temporary/failure.yaml" <<'YAML'
services:
  client:
    entrypoint: ["/bin/sh", "-c", "exit 42"]
    restart: "no"
YAML

changed=0
cleanup() {
  if [[ "$changed" == 1 ]]; then
    echo "Restoring original Web container after interrupted rehearsal." >&2
    "${compose[@]}" up -d --no-deps --force-recreate --pull never client || true
  fi
  rm -rf "$temporary"
}
trap cleanup EXIT

changed=1
"${compose[@]}" -f "$temporary/failure.yaml" up -d --no-deps --force-recreate --pull never client
if python3 infra/staging/check-readiness.py >/dev/null 2>&1; then
  echo "Expected the injected Web failure to fail readiness, but it passed." >&2
  exit 1
fi
echo "Injected Web failure was detected by readiness check."

"${compose[@]}" up -d --no-deps --force-recreate --pull never client
ready=0
for attempt in {1..30}; do
  if python3 infra/staging/check-readiness.py >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
if [[ "$ready" != 1 ]]; then
  echo "Web did not recover after restoring the original Compose configuration." >&2
  exit 1
fi
changed=0
python3 infra/staging/check-readiness.py
echo "Web-only failure rollback rehearsal passed. Database and object volumes were retained."
