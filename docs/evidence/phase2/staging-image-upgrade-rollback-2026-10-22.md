# Phase 2: server-built Web image, staging upgrade and rollback (2026-10-22)

Scope: synthetic accounts and PDFs only, on the SSH-tunnel-only Linux test host. Source commit `8c384ca71` was already built and tested in the dedicated server builder. This exercise did not push code or an image to GitHub/GHCR and did not expose a public port.

## Candidate image

- Packed the server-built Next standalone tree, static files and public assets into a local image using `docker build --pull=false --network=none`. The local image ID was `sha256:d37f14118facc629fabfcf93bd425cd9205b5e38f217d4615ae94c841c9a335a`; its base was the previously accepted Web runtime image `sha256:f5a0ddae78db6365b5dcce8138434292e548a75b8f71004dc138ad2b44c024cd`.
- Ran that image without source bind mounts on loopback port 3134. `/library` and `/vendor/pdfjs/pdf.worker.min.mjs` both returned HTTP 200. On the real backend, the image issued 201/201 authorized PDF download URLs; downloaded PDFs 001, 101 and 201 matched their fixtures by SHA-256. A second synthetic account received 0 URLs.

## Staging exercise

1. The existing `scholar-staging` project passed Web/Auth/REST/object-storage readiness. Backup `20261022T082651Z` had `STATUS=complete`; it was not restored in this exercise. The database and object-store containers were not recreated.
2. A private Compose override changed only `client.image` to the local image ID. Configuration checks confirmed project `scholar-staging`, Web host binding `127.0.0.1:3130`, and the exact candidate ID. `docker compose up -d --no-deps --force-recreate --pull never client` recreated only the Web container.
3. During the candidate interval, all four readiness probes passed, the PDF worker returned HTTP 200, 201/201 PDF signed URLs were returned, three PDF hashes matched, and the second account received 0 URLs.
4. The same command without the override recreated the Web container from the original digest. All four readiness probes passed and `docker inspect` showed the exact previous image ID `sha256:f5a0ddae78db6365b5dcce8138434292e548a75b8f71004dc138ad2b44c024cd`. The old Web again returned 0/201 URLs for this large request; the separate candidate on port 3132 still returned 201/201. This confirms the running staging Web is the previous accepted version, not the candidate.

This proves a Web-only candidate rollout and rollback on synthetic staging data. It does not prove database rollback, production deployment, external TLS or a published image. Phase 2 still needs the updated desktop three-pane check and a 200+ document Web/desktop bidirectional metadata and collection round trip before acceptance.
