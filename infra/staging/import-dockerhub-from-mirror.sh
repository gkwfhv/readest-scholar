#!/usr/bin/env bash
# Import only the six pinned Docker Hub images through a registry mirror when
# the host Docker daemon cannot reach Docker Hub. The Web image is on GHCR.
set -euo pipefail
umask 077

root="$(cd "$(dirname "$0")/../.." && pwd)"
environment="${SCHOLAR_STAGING_ENV_FILE:-$root/docker/.env}"
crane="${CRANE_BIN:-crane}"
mirror="${SCHOLAR_DOCKERHUB_MIRROR:-hub.1panel.dev}"

if [[ "$mirror" == *://* || "$mirror" == */* ]]; then
  echo "Mirror must be a registry host name." >&2
  exit 2
fi
command -v "$crane" >/dev/null

images=()
while IFS= read -r reference; do
  images+=("$reference")
done < <(
  docker compose --env-file "$environment" \
    -f "$root/docker/compose.yaml" -f "$root/infra/staging/compose.yaml" \
    config --images | sort -u
)

if [[ "${#images[@]}" != 7 ]]; then
  echo "Expected seven pinned staging images; found ${#images[@]}." >&2
  exit 2
fi

temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
count=0
for reference in "${images[@]}"; do
  if [[ "$reference" != *@sha256:* ]]; then
    echo "Unpinned image: $reference" >&2
    exit 2
  fi
  if [[ "$reference" != docker.io/* ]]; then
    continue
  fi
  tag="${reference%@sha256:*}"
  expected="sha256:${reference##*@sha256:}"
  if docker image inspect "$reference" >/dev/null 2>&1; then
    count=$((count + 1))
    echo "Already present: $tag ($expected)" >&2
    continue
  fi
  mirror_reference="$mirror/${reference#docker.io/}"
  actual="$("$crane" digest --platform linux/amd64 "$mirror_reference")"
  if [[ "$actual" != "$expected" ]]; then
    echo "Mirror digest mismatch for $tag: expected $expected, got $actual" >&2
    exit 3
  fi

  rm -rf "$temporary/oci"
  "$crane" pull --format oci --platform linux/amd64 \
    "$mirror_reference" "$temporary/oci"
  tar -cf "$temporary/image.tar" -C "$temporary/oci" .
  docker image load -i "$temporary/image.tar"
  docker image tag "$expected" "$tag"
  docker image inspect "$reference" >/dev/null
  rm -rf "$temporary/oci" "$temporary/image.tar"
  count=$((count + 1))
  echo "Imported and verified $tag ($expected)" >&2
done

if [[ "$count" != 6 ]]; then
  echo "Expected six Docker Hub images; imported $count." >&2
  exit 2
fi
