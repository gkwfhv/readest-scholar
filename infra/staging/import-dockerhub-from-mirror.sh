#!/usr/bin/env bash
# Import only the six pinned Docker Hub images through a registry mirror when
# the host Docker daemon cannot reach Docker Hub. The Web image is on GHCR.
set -euo pipefail
umask 077

root="$(cd "$(dirname "$0")/../.." && pwd)"
environment="${SCHOLAR_STAGING_ENV_FILE:-$root/docker/.env}"
crane="${CRANE_BIN:-crane}"
mirror="${SCHOLAR_DOCKERHUB_MIRROR:-hub.1panel.dev}"
cache="${SCHOLAR_CRANE_CACHE:-$HOME/.cache/scholar-staging-crane}"

if [[ "$mirror" == *://* || "$mirror" == */* ]]; then
  echo "Mirror must be a registry host name." >&2
  exit 2
fi
command -v "$crane" >/dev/null
mkdir -p "$cache"
exec 9>"$cache/.lock"
if ! flock -n 9; then
  echo "Another staging image import is using $cache." >&2
  exit 2
fi

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

  pulled=0
  for attempt in 1 2 3; do
    rm -rf "$temporary/oci"
    "$crane" manifest --platform linux/amd64 "$mirror_reference" |
      python3 -c '
import hashlib,json,pathlib,sys
cache=pathlib.Path(sys.argv[1])
manifest=json.load(sys.stdin)
for layer in manifest["layers"]:
    path=cache/layer["digest"]
    if not path.is_file():
        continue
    valid=path.stat().st_size == layer["size"]
    if valid:
        digest=hashlib.sha256()
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024*1024), b""):
                digest.update(chunk)
        valid=digest.hexdigest() == layer["digest"].split(":",1)[1]
    if not valid:
        path.unlink()
        print("Discarded incomplete cached layer "+layer["digest"],file=sys.stderr)
' "$cache"
    protocol_debug="${GODEBUG:-}"
    if [[ "$attempt" != 1 ]]; then
      protocol_debug="${protocol_debug:+$protocol_debug,}http2client=0"
    fi
    if GODEBUG="$protocol_debug" "$crane" pull --cache_path "$cache" --format oci --platform linux/amd64 \
      "$mirror_reference" "$temporary/oci"; then
      pulled=1
      break
    fi
    echo "Mirror pull attempt $attempt failed for $tag." >&2
    if [[ "$attempt" != 3 ]]; then
      sleep "$((attempt * 5))"
    fi
  done
  if [[ "$pulled" != 1 ]]; then
    echo "Could not import $tag after three attempts." >&2
    exit 4
  fi
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
