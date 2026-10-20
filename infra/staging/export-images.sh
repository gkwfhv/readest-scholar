#!/usr/bin/env bash
# Run on a trusted registry-connected machine. Stream a verified amd64 Docker
# archive to stdout; pipe it through gzip and SSH to `docker image load`.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
SCHOLAR_STAGING_ENV_FILE="$temporary/staging.env" python3 "$root/infra/staging/prepare-env.py" >&2

images=()
while IFS= read -r reference; do
  images+=("$reference")
done < <(
  docker compose --env-file "$temporary/staging.env" \
    -f "$root/docker/compose.yaml" -f "$root/infra/staging/compose.yaml" \
    config --format json |
    python3 -c 'import json,sys; c=json.load(sys.stdin); print("\n".join(sorted({s["image"] for s in c["services"].values()})))'
)

if [[ "${#images[@]}" != 7 ]]; then
  echo "Expected seven pinned staging images; found ${#images[@]}." >&2
  exit 2
fi

tags=()
for reference in "${images[@]}"; do
  if [[ "$reference" != *@sha256:* ]]; then
    echo "Unpinned image: $reference" >&2
    exit 2
  fi
  tag="${reference%@sha256:*}"
  expected="sha256:${reference##*@sha256:}"
  docker pull --platform linux/amd64 "$tag" >&2
  actual="$(docker image inspect --platform linux/amd64 "$tag" --format '{{.Id}}')"
  if [[ "$actual" != "$expected" ]]; then
    echo "Image digest mismatch for $tag: expected $expected, got $actual" >&2
    exit 3
  fi
  echo "Verified $tag ($expected)" >&2
  tags+=("$tag")
done

docker image save --platform linux/amd64 "${tags[@]}"
