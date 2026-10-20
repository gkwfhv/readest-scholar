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

if [[ "${SCHOLAR_STAGING_EXPORT_WEB_ONLY:-0}" == 1 ]]; then
  web=()
  for reference in "${images[@]}"; do
    if [[ "$reference" == ghcr.io/* ]]; then
      web+=("$reference")
    fi
  done
  if [[ "${#web[@]}" != 1 ]]; then
    echo "Expected one GHCR Web image; found ${#web[@]}." >&2
    exit 2
  fi
  images=("${web[@]}")
fi

web_override="${SCHOLAR_STAGING_EXPORT_WEB_IMAGE:-}"
if [[ -n "$web_override" ]]; then
  if [[ "${SCHOLAR_STAGING_EXPORT_WEB_ONLY:-0}" != 1 || \
        ! "$web_override" =~ ^ghcr\.io/gkwfhv/readest@sha256:[0-9a-f]{64}$ ]]; then
    echo "The Web override requires WEB_ONLY=1 and a full Scholar platform digest." >&2
    exit 2
  fi
  images=("$web_override")
fi

save_refs=()
for reference in "${images[@]}"; do
  if [[ "$reference" != *@sha256:* ]]; then
    echo "Unpinned image: $reference" >&2
    exit 2
  fi
  tag="${reference%@sha256:*}"
  expected="sha256:${reference##*@sha256:}"
  if [[ -n "$web_override" ]]; then
    docker pull --platform linux/amd64 "$reference" >&2
    save_ref="$reference"
  else
    docker pull --platform linux/amd64 "$tag" >&2
    save_ref="$tag"
  fi
  actual="$(docker image inspect --platform linux/amd64 "$save_ref" --format '{{.Id}}')"
  if [[ "$actual" != "$expected" ]]; then
    echo "Image digest mismatch for $save_ref: expected $expected, got $actual" >&2
    exit 3
  fi
  echo "Verified $save_ref ($expected)" >&2
  save_refs+=("$save_ref")
done

docker image save --platform linux/amd64 "${save_refs[@]}"
