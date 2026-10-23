# Phase 4 PDF reading and notes verification (2026-10-23)

Status: implementation candidate; Phase 4 is **not yet accepted**.

## Scope completed

- PDF text selections now store a normalized page index and rectangles together with their CFI. Range edits replace stale geometry, including an explicit clear when recapture fails. Readest JSON export/import carries the geometry only for the same PDF hash and matching CFI.
- The PDF text layer in the pinned foliate-js fork is rotated with the rendered bitmap. This fixes selection alignment on /Rotate pages.
- The note export dialog can write a copy of the source PDF with standard Highlight, Underline and Squiggly annotations. It reports notes that cannot be represented, such as legacy notes without geometry. The source PDF stays unchanged.
- A server-side sync compatibility fix retains existing geometry when an older client edits a note at the same CFI and page. A changed source location clears it; a new client can explicitly send null to clear it.

## Evidence

- The server build container passed the relevant unit tests for geometry, PDF export, JSON transfer, DB transform, note editing, source jump and export UI. TypeScript, Biome lint and format passed. Web production and Linux CEF debug builds passed. The final sync compatibility change passed its own four unit cases and another Web production build; the Linux CEF build predates that API-only change.
- A real Chromium browser test generates a two-column PDF and checks that selected text intersects dark pixels in PDF.js's rendered bitmap at 2x zoom and at 0°, 90°, 180° and 270°. [Zoomed two-column baseline](pdf-zoomed-anchor-baseline.png) and [rotated baseline](pdf-rotated-anchor-baseline.png) are synthetic PDF images. The geometry browser test passed in the full suite.
- Standard PDF export was re-read by pdf-lib and PDF.js. It validated /QuadPoints, note contents, crop offsets, all quarter-turn rotations, and an unchanged source buffer.
- The real-browser export dialog check passed at 390px light, 390px RTL/e-ink, and 1200px e-ink. It checked the action and omission report bounds and long text wrapping. [Mobile light](pdf-export-mobile-light.png), [mobile RTL/e-ink](pdf-export-mobile-rtl-eink.png), and [desktop e-ink](pdf-export-desktop-eink.png) are synthetic-data layout baselines.
- Before changing staging, the database was saved on the server to `/home/gavin/scholar-staging-backups/phase4-before-pdf-anchor/postgres.dump` (mode 0600). Migrations 043–046 are now recorded in its ledger. Migrations 043–045 were made replayable where test-created functions/tables already existed; their rollback SQL probes and the note restore probe passed. The original staging Web image remains online with Web, Auth, REST and object-storage readiness checks passing.
- [GitHub Nix dependency hash run 39918750002](https://github.com/gkwfhv/readest-scholar/actions/runs/39918750002) passed after the hash update in commit 42194078e.
- The isolated Phase 4 Web candidate listens only on `127.0.0.1:3153`. `infra/staging/test-pdf-note-anchor.py` used a synthetic account and verified candidate POST, independent GET, and database read, then a legacy edit retaining geometry and an explicit null clearing it. The probe deletes its row in `finally`.

## Remaining gates

- The server's Debian Chromium 155 full browser run had 745 passed, 1 skipped and 2 failed out of 748 tests. The failing existing paginator chunk and Word Lens cases also failed when run alone; they do not import the modified PDF module. The repo's Playwright 1.60 browser is Chromium 148. Resolve this against the supported CI browser before declaring the full browser gate green.
- Complete full unit verification, final Linux CEF build, supported-browser PR CI, and review before Phase 4 self acceptance. The staging Web has not been replaced for this candidate. No signing or production deployment occurred.
