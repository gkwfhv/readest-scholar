# Phase 5 SQLite deletion fence (2026-10-23)

Status: server-side implementation slice on draft PR #53. Phase 5 is not accepted.

## Reproduced race

Two independent Turso connections opened the same temporary `reedy.db`. An index write was paused before its SQL batch. The second connection purged the book, then explicitly reopened the scope for a new import. Without a persisted SQLite generation, the delayed old batch could insert chunks after the purge and reimport. The new test first failed because `beginBookIndex` did not exist.

## Implementation

- Reedy migration `2026102301_reedy_book_deletion_fence` adds a per-book generation and deletion flag in the same SQLite file as the index.
- Each index operation captures a generation. Metadata, chunks, embeddings, status and re-index cleanup use a generation predicate inside their SQL statements, then check the generation again before returning. The book/session memory service captures the same generation when the assistant opens; its row and vector writes carry that generation through model latency.
- Purge rotates the generation and sets the deletion flag in the same transaction as the book/session data removal. The model-wide wipe also invalidates old generations.
- A completed native import explicitly opens a fresh generation for that account/book; a pending AI deletion is retried first. Web IndexedDB uses its separate deletion journal and browser transaction ordering.

## Verification

- The two-connection test passed after the change: old queued write rejects even after reimport, no old chunk remains, new indexing succeeds, and a later purge removes the new row. A second two-connection test confirms an old assistant cannot restore book memory after deletion/reimport, while a new assistant can write a row and embedding. Re-importing an already live book keeps its generation unchanged.
- ReedyDb, BookIndexer, app-service and deletion-fence target suites: 78 tests passed at the index-only step. After memory fencing, the final six focused suites passed 101 tests; TypeScript and Biome checked 2,934 app files with no findings. The reader remounts the assistant when the account/book scope changes.
- The final server builds and complete unit suite are tracked separately before Phase 5 acceptance.

## Limit

The new assistant and indexer paths carry the SQLite generation. An already-running older app binary that does not know this schema can still write while the deletion tombstone is present; process handover compatibility needs an explicit check before release. Native keychain and real-model claim evaluation remain separate gates.

## Full-suite integration replay

The first server one-shot unit run on `eaf681fe0` exposed seven older import test fixtures that returned an empty object for the mocked native database. The new import-completion fence calls `execute`, so 61 of 14,140 tests failed with `this.db.execute is not a function`. Those seven fixtures now provide an `execute` stub; all 71 tests in the affected files pass. This was a test-fixture compatibility failure, not a production database error. The second server one-shot run passed 1,243 files and 14,124 tests; 4 files and 16 tests remained skipped by the existing configuration, with zero failures. TypeScript/Biome passed across 2,934 files. The same checkout passed Web production build, Tauri static build and a Linux CEF debug build; the initial CEF command failed before compilation because the container PATH omitted `/root/.cargo/bin`, then passed with the correct PATH.
