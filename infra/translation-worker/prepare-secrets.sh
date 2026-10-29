#!/bin/sh
# Generate translation secrets once. Never print their value.
set -eu

secret_dir=${1:-docker/secrets}
umask 077
mkdir -p "$secret_dir"

vault_key="$secret_dir/scholar-ai-vault.key"
client_token="$secret_dir/translation-worker-client.token"
worker_token="$secret_dir/translation-worker.token"

if [ ! -f "$vault_key" ]; then
  openssl rand -base64 32 > "$vault_key"
fi
if [ ! -f "$client_token" ] || [ ! -f "$worker_token" ]; then
  openssl rand -base64 32 | tr '+/' '-_' | tr -d '\n=' > "$client_token"
  cp "$client_token" "$worker_token"
fi
chmod 600 "$vault_key" "$client_token" "$worker_token"
secret_dir_abs=$(cd "$secret_dir" && pwd)
docker run --rm --user 0:0 -v "$secret_dir_abs:/secrets" alpine:3.21 \
  sh -ec 'chown 0:0 /secrets/translation-worker.token && chmod 400 /secrets/translation-worker.token'
