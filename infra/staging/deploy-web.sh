#!/usr/bin/env bash
# Roll out one digest-pinned Scholar Web image to the isolated staging project.
set -euo pipefail
umask 077

if [[ "${SCHOLAR_STAGING_DEPLOY_CONFIRM:-}" != yes ]]; then
  echo "Set SCHOLAR_STAGING_DEPLOY_CONFIRM=yes for the isolated test stack." >&2
  exit 2
fi

candidate="${1:-}"
if [[ ! "$candidate" =~ ^ghcr\.io/gkwfhv/readest@sha256:[0-9a-f]{64}$ ]]; then
  echo "Pass a full ghcr.io/gkwfhv/readest@sha256:<64 hex> image reference." >&2
  exit 2
fi

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
environment="$root/docker/.env"
compose=(docker compose --env-file "$environment" -f "$root/docker/compose.yaml" -f "$root/infra/staging/compose.yaml")
lock_dir="$HOME/.cache/scholar-staging"
mkdir -p "$lock_dir"
chmod 700 "$lock_dir"
exec 9>"$lock_dir/deploy.lock"
flock -n 9 || { echo "Another staging Web rollout is running." >&2; exit 3; }

read_image() {
  python3 - "$environment" <<'PY'
import pathlib, stat, sys
p = pathlib.Path(sys.argv[1])
if p.is_symlink() or stat.S_IMODE(p.stat().st_mode) != 0o600:
    raise SystemExit("Staging env must be a regular 0600 file")
values = [line.split("=", 1)[1] for line in p.read_text().splitlines() if line.startswith("READEST_IMAGE=")]
if len(values) != 1 or "@sha256:" not in values[0]:
    raise SystemExit("Expected exactly one digest-pinned READEST_IMAGE")
print(values[0])
PY
}

set_image() {
  python3 - "$environment" "$1" <<'PY'
import os, pathlib, tempfile, sys
p = pathlib.Path(sys.argv[1])
image = sys.argv[2]
lines = p.read_text().splitlines(keepends=True)
matches = [i for i, line in enumerate(lines) if line.startswith("READEST_IMAGE=")]
if len(matches) != 1:
    raise SystemExit("Expected exactly one READEST_IMAGE entry")
lines[matches[0]] = "READEST_IMAGE=" + image + "\n"
fd, name = tempfile.mkstemp(prefix=".scholar-env-", dir=p.parent)
try:
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.writelines(lines)
    os.replace(name, p)
finally:
    if os.path.exists(name):
        os.unlink(name)
PY
}

previous="$(read_image)"
if [[ "$candidate" == "$previous" ]]; then
  python3 infra/staging/check-readiness.py
  echo "Staging already uses $candidate"
  exit 0
fi

"${compose[@]}" config --format json | python3 -c '
import json, sys
config = json.load(sys.stdin)
assert config["name"] == "scholar-staging"
assert config["services"]["client"]["image"] == sys.argv[1]
expected = {("client", 3000, 3130), ("kong", 8000, 8130),
            ("minio", 9000, 9130), ("minio", 9001, 9131)}
actual = {(service, int(port["target"]), int(port["published"]))
          for service, definition in config["services"].items()
          for port in definition.get("ports", [])}
assert actual == expected
assert all(port["host_ip"] == "127.0.0.1"
           for definition in config["services"].values()
           for port in definition.get("ports", []))
' "$previous"

python3 infra/staging/check-readiness.py
docker image inspect "$previous" >/dev/null

backup_log="$(SCHOLAR_BACKUP_CONFIRM=yes \
  SCHOLAR_COMPOSE_DIR="$root/docker" \
  SCHOLAR_COMPOSE_OVERLAY="$root/infra/staging/compose.yaml" \
  SCHOLAR_COMPOSE_EXPECTED_PROJECT=scholar-staging \
  SCHOLAR_ENV_FILE="$environment" \
  bash infra/backup/backup-compose.sh "${SCHOLAR_STAGING_BACKUPS:-$HOME/scholar-staging-backups}")"
printf '%s\n' "$backup_log"
snapshot="$(printf '%s\n' "$backup_log" | sed -n 's/^Backup written to //p')"
[[ -n "$snapshot" && "$(cat "$snapshot/STATUS")" == complete && -s "$snapshot/postgres-restorable.sql" && -d "$snapshot/minio-data" ]]

if docker image inspect "$candidate" >/dev/null 2>&1; then
  echo "Using the already imported digest-pinned candidate $candidate"
else
  docker pull "$candidate"
fi
changed=0
rollback() {
  status=$?
  trap - EXIT
  if [[ "$changed" == 1 ]]; then
    echo "Candidate failed; restoring the previous Web image $previous" >&2
    if ! set_image "$previous"; then
      echo "Could not restore the previous image in docker/.env." >&2
      exit 1
    fi
    "${compose[@]}" up -d --no-deps --force-recreate --pull never client || true
    for attempt in {1..30}; do
      if python3 infra/staging/check-readiness.py >/dev/null 2>&1; then
        echo "Previous Web image is healthy again." >&2
        exit "$status"
      fi
      sleep 2
    done
    echo "Rollback did not restore health; inspect staging immediately." >&2
  fi
  exit "$status"
}
trap rollback EXIT

changed=1
set_image "$candidate"
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
  echo "Candidate Web image did not become healthy." >&2
  exit 1
fi
python3 infra/staging/check-readiness.py
changed=0
echo "Staging Web rollout passed: $candidate"
echo "Previous image: $previous"
echo "Pre-rollout backup: $snapshot"
