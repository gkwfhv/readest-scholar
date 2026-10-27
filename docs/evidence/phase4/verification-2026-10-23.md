# Phase 4 PDF reading and notes verification (2026-10-23)

Status: Phase 4 self-accepted on 2026-10-23 after server and supported GitHub CI verification.

## Scope completed

- PDF text selections now store a normalized page index and rectangles together with their CFI. Range edits replace stale geometry, including an explicit clear when recapture fails. Readest JSON export/import carries the geometry only for the same PDF hash and matching CFI.
- The PDF text layer in the pinned foliate-js fork is rotated with the rendered bitmap. This fixes selection alignment on /Rotate pages.
- The note export dialog can write a copy of the source PDF with standard Highlight, Underline and Squiggly annotations. It reports notes that cannot be represented, such as legacy notes without geometry. The source PDF stays unchanged.
- A server-side sync compatibility fix retains existing geometry when an older client edits a note at the same CFI and page. A changed source location clears it; a new client can explicitly send null to clear it.

## Evidence

- On final server candidate 2e17d4959, the complete unit suite passed: 1,226 files and 14,054 tests passed; 4 files and 16 tests skipped. The build container used an empty SELF_HOSTED value because its default true value made legacy non-self-hosted fixtures fail. TypeScript, Biome lint and format, Web production build, and Linux CEF debug build passed.
- A real Chromium browser test generates a two-column PDF and checks that selected text intersects dark pixels in PDF.js's rendered bitmap at 2x zoom and at 0°, 90°, 180° and 270°. [Zoomed two-column baseline](pdf-zoomed-anchor-baseline.png) and [rotated baseline](pdf-rotated-anchor-baseline.png) are synthetic PDF images. The geometry browser test passed in the full suite.
- Standard PDF export was re-read by pdf-lib and PDF.js. It validated /QuadPoints, note contents, crop offsets, all quarter-turn rotations, and an unchanged source buffer.
- The real-browser export dialog check passed at 390px light, 390px RTL/e-ink, and 1200px e-ink. It checked the action and omission report bounds and long text wrapping. [Mobile light](pdf-export-mobile-light.png), [mobile RTL/e-ink](pdf-export-mobile-rtl-eink.png), and [desktop e-ink](pdf-export-desktop-eink.png) are synthetic-data layout baselines.
- Before changing staging, the database was saved on the server to `/home/gavin/scholar-staging-backups/phase4-before-pdf-anchor/postgres.dump` (mode 0600). Migrations 043–046 are now recorded in its ledger. Migrations 043–045 were made replayable where test-created functions/tables already existed; their rollback SQL probes and the note restore probe passed. The original staging Web image remains online with Web, Auth, REST and object-storage readiness checks passing.
- [GitHub Nix dependency hash run 39918750002](https://github.com/gkwfhv/readest-scholar/actions/runs/39918750002) passed after the hash update in commit 42194078e.
- GitHub [PR checks run 39920336166](https://github.com/gkwfhv/readest-scholar/actions/runs/39920336166) passed, including both unit shards, Web and Tauri builds, Rust lint, and the supported Playwright browser suite: 105 files and 750 tests passed, 1 test skipped. [Scholar baseline](https://github.com/gkwfhv/readest-scholar/actions/runs/39920336150), [CodeQL](https://github.com/gkwfhv/readest-scholar/actions/runs/39920336177), and [Nix dependency hash](https://github.com/gkwfhv/readest-scholar/actions/runs/39920336190) also passed on commit 2e17d4959.
- The isolated Phase 4 Web candidate listens only on `127.0.0.1:3153`. `infra/staging/test-pdf-note-anchor.py` used a synthetic account and verified candidate POST, independent GET, and database read, then a legacy edit retaining geometry and an explicit null clearing it. The probe deletes its row in `finally`.

## Acceptance and integration

- The PDF accuracy criterion passed for zoom, all quarter-turn rotations and two-column selection. Note source-jump, anchor transfer and PDF export cases passed in the complete unit suite and focused browser tests.
- The server Debian Chromium 155 run had 745 passes, 1 skip and 2 failures in existing paginator chunk and Word Lens cases, reproduced in isolation. The supported Playwright browser in GitHub CI passed the complete suite with 750 passes and 1 skip, including the three new layout cases. The server-only failures are recorded as an environment difference.
- Phase 3 PR #51 remains open pending merge approval. Phase 4 PR #52 remains draft and stacked on Phase 3 after its temporary main-based CI run. The existing staging Web image remains online; no signing or production deployment occurred.
