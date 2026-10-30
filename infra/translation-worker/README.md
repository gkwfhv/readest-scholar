# Scholar PDF translation worker

This self-hosted pdf2zh Next 2.9.0 worker creates Chinese, bilingual, or both PDF outputs through the durable Scholar queue.

## Model selection and secrets

The worker uses the model currently selected in the signed-in user's **AI Assistant** settings:

- **AI Gateway** uses its official OpenAI-compatible endpoint.
- **OpenAI-compatible** (shown as "OpenRouter (Custom)") uses the configured endpoint, chat model, and API key.
- **Ollama** remains local to the device. A loopback or LAN endpoint on a desktop cannot safely be sent to a server worker.

The Web API encrypts each profile with AES-256-GCM and binds it to its user and job. The worker receives it only after it has a live job lease through Docker's private network. The model key is neither a server-wide environment variable nor written to worker logs.

## Deployment

Apply the normal production migrations, then prepare three server-local secret files and bring up the overlay:

```sh
infra/translation-worker/prepare-secrets.sh
docker compose -f docker/compose.yaml -f docker/compose.production.yaml \
  -f docker/compose.translation-worker.yaml up -d --build
```

The overlay publishes no worker port. It starts a one-shot asset warmup job, then a restricted `translator` service with 2 CPU and 4 GiB memory limits. Keep the named `scholar_translation_assets` volume across restarts so BabelDOC assets are not downloaded again.

The vault key and client token under `docker/secrets/` remain mode `0600`; the matching worker token is mode `0400` for root only. The duplicate tokens let the Web container and root worker authenticate each other while the unprivileged pdf2zh subprocess cannot read either token. None of these files may be committed or printed, and they must be backed up with production secrets. Rotating the vault key makes queued profile envelopes unreadable, so allow in-progress jobs to finish before rotation.

For development and synthetic staging, use `infra/staging/translation-worker.yaml` after supplying the same restricted secret files. No server-wide model environment variable is required.
