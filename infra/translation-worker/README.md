# Scholar PDF translation worker

The isolated Worker uses pdf2zh Next 2.9.0 to create a new translated PDF. It never writes the source object. The database queue stores the source version and SHA-256; the Worker verifies both before starting and verifies uploaded output bytes before publishing a separate attachment on the same document.

## Staging configuration

Apply database migrations 051 and 052 after the preceding Scholar translation migrations. Use `infra/staging/translation-worker.yaml` as the Compose overlay. Keep the model endpoint and PostgreSQL/MinIO on a private Docker network; this overlay publishes no Worker port. The warmup job downloads BabelDOC assets into a named volume and verifies their published hashes before the Worker starts. Keep the asset volume for subsequent restarts.

Set these private environment values outside Git:

- `SCHOLAR_TRANSLATION_BASE_URL`: an OpenAI-compatible `/v1` model endpoint reachable from the Worker.
- `SCHOLAR_TRANSLATION_MODEL`: the exact model ID used by the Web API and local model endpoint.
- `SCHOLAR_TRANSLATION_MODEL_KEY_FILE`: a 0600 file containing the model API key, or a local-only test token if the model is isolated and does not enforce authentication.

The Compose overlay limits the Worker to 2 CPU cores, 4 GiB RAM, 128 PIDs and a 650 MiB temporary filesystem. The model service needs its own capacity; a 4B CPU model took about 18 minutes for a two-page, two-pass sample on the 10 GiB staging host. Translation duration depends strongly on model speed and paper complexity. Each pdf2zh pass has a 30-minute Worker timeout.

## White-background pages

Ordinary vector translation preserves figures but can leave source text visible under the Chinese on some white pages. The UI offers an explicit compatibility option with a page list such as `2,4-6`. The Worker first translates normally, then runs pdf2zh's OCR workaround for only those pages and replaces them in the output PDF. Select text-heavy pages: the workaround can cover text labels inside diagrams. The page list is one-based and limited to source pages.

A PDF that is structurally invalid, identical to the source, over the output size limit, or contains newly generated visible `<style` markup is rejected before publication. A rejected task leaves the original source intact and can be retried. The model still requires visual review for layout and translation quality; the automated checks do not measure fluency.

## Recovery

Cancel requests stop the child translation process. Retrying a failed or canceled job creates a new queue row with the original source version, mode, glossary and compatibility pages. If a Worker container is lost, the expired lease moves the job to a visible failed state; an explicit retry is required before another model call. Before upgrading a running Worker, let active jobs finish or explicitly cancel them. Keep a database backup before applying migrations and retain the previous image digest for rollback.
