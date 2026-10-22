# Phase 2: 201 PDF browser import and cloud round trip (2026-10-22)

Scope: synthetic data on the existing loopback-only staging backend, with a separate candidate Web container on server port 3132 and SSH tunnel to the test browser. The accepted staging Web container on port 3130 was not replaced. No GitHub push or production data was involved.

## Reproduced failures and fixes

1. Selecting all 201 synthetic PDFs through the library's “Import from local files” UI initially failed because the dedicated manual Web build had omitted `pnpm setup-vendors`; `/vendor/pdfjs/pdf.worker.min.mjs` returned 404. Running that repository script in `scholar-dev-builder` and restarting the candidate returned HTTP 200 for the worker.
2. All 201 PDFs then imported locally, but file uploads failed because the browser's SSH tunnel origin and the absolute API address embedded as a build fallback differed. Scholar Web browser requests now use the same-origin `/api` path. The desktop and ordinary Readest URL behavior remain covered by the existing environment tests.
3. Retrying sync for the 201 locally imported books returned `Failed to push changes: URI too long`. `POST /api/sync` built one PostgREST OR filter for 100 rows. The lookup batch is now 25 rows. A 201-book route test reproduces HTTP 500 on the old implementation and returns HTTP 200 with all 201 records after the change; each simulated encoded filter remains below 6000 characters.

## Verification on server and test browser

- Dedicated container: 40 targeted tests and the full sync API group (13 files, 61 tests) passed; TypeScript `--noEmit`, Biome, and Scholar Web `next build --webpack` completed with exit 0. The new origin test also failed as expected against the prior implementation (`http://127.0.0.1:3133/api` versus `/api`).
- Browser file chooser selected 201 distinct PDFs in one operation. The library displayed 203 books including two pre-existing local demo titles. After the fixes, the server-side synthetic account contained exactly 201 `books` and 201 `scholar_documents`.
- The browser's Cloud File Transfers “Retry All” completed **201 uploads, 0 failures**. [Queue screenshot](phase2-ui-201-upload-complete.png).
- Authenticated storage check identified 201 PDF keys. The candidate download API returned 201/201 signed URLs; SHA-256 of downloaded PDFs 001, 101 and 201 matched the fixture bytes. The second synthetic account received 0 signed URLs and had 0 rows in `books`, `files`, and `scholar_documents`.
- The primary account had 402 `files` records after upload. The signed-download check selected the 201 PDF keys specifically; the other file records were not counted as PDFs.
- Browser refresh to the visible 203-book library took 744, 490 and 505 ms (median 505 ms) in three local SSH-tunnel samples. This measures visible library readiness on the test Mac; it is not a cross-platform or cold-device benchmark.

## Collection and metadata UI check

Using the same 201-document browser account, Paper 101 was assigned to a new `Phase2 UI Review` collection. The three-pane library showed 203 local books (201 imports plus two existing demo books), the collection count of 1, Paper 101 in the middle pane, and its DOI `10.5555/readest-scholar.phase2.101` and tags `Phase2 UI QA` / `Cross-device` in the right pane. [Three-pane screenshot](phase2-three-pane-201-group.jpg). An authenticated server-side read of the `books` row confirmed `group_name=Phase2 UI Review` and both tags. This is Web → server evidence, not a Web ↔ desktop round trip.

## Remaining acceptance

The packaged candidate completed a [server-only staging upgrade and rollback exercise](staging-image-upgrade-rollback-2026-10-22.md). Accepted staging was restored to its previous Web image; it still returns 0 signed URLs for this 201-key request, while the separate candidate returns 201. A separate [201-document Web ↔ desktop round trip](cross-device-201-collections-2026-10-22.md) now covers collection and tag edits while preserving DOI. Phase 2 still requires an updated three-pane native build and visual check. This evidence does not approve Phase 2 or production release.
