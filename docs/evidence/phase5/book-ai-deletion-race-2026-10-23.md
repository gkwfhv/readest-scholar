# Phase 5: deletion versus AI indexing (2026-10-23)

Status: server implementation slice on draft PR #53. Phase 5 is not accepted.

## Failure reproduced

- A delayed AI index write could finish after book deletion and recreate its IndexedDB metadata. A new conversation could also be saved while deletion was clearing the book scope. The new real Chromium IndexedDB test failed before the guard because the late conversation write resolved.
- Reedy checked cancellation before an embedding call but not after it. The slow embedding test failed before the fix because the task completed despite deletion. A second test reproduced a task from another window whose old embedding returned after a deletion marker had already been cleared.

## Change

- A durable account/book deletion intent is written before local file removal. It advances a per-scope generation and aborts registered work. If a crash happens between the intent and file removal, startup purges only regenerable AI data. A partial filesystem failure also purges that data and preserves the original deletion error; the user can reindex a book that remains locally.
- Legacy PDF indexing and Reedy indexing register their asynchronous work by account/book scope. Deletion waits for same-window work to settle before its final IndexedDB and Reedy purge. New AI writes reject while the intent is pending.
- Delayed writes carry the captured generation. Even after another window clears the pending marker, work started before the deletion rejects on its next check. Legacy IndexedDB writes check again after opening the database; Reedy checks between extraction, embedding and persistence. Delayed conversation/message writes carry the same guard.
- Existing behavior for a cloud-only file deletion is unchanged; it does not remove local AI data.

## Verification

- Focused server-builder unit tests: Reedy BookIndexer 9/9, app-service 50/50, AI storage 7/7, AI chat store 30/30. Real Chromium IndexedDB account/deletion tests 3/3. The new race cases failed before the implementation and passed afterward.
- TypeScript and Biome lint passed across 2,932 app files before the last formatting pass. A complete one-shot unit run and final server build are in progress.

## Remaining limit

- LocalStorage coordinates windows on the same origin, but it is not an atomic lock with the Reedy SQLite database. A cross-process SQLite write already submitted before the other window records the intent could commit after that window's purge. The generation checks narrow this window; a SQLite transaction-level deletion fence or a two-process fault test is still required before signing off the deletion criterion.
- Real-paper claim support, model compatibility integration, native keychain and final UI navigation remain Phase 5 acceptance items.

The one-shot server unit suite for this slice completed with exit code 0: 1,241 files and 14,119 tests passed; four files/16 tests are skipped by existing project configuration. The run preceded the last PDF extractor change, which has separate focused verification.

Final targeted rerun after formatting: 99 focused unit tests and three Chromium IndexedDB tests passed. Full TypeScript/Biome lint and the server Web production build passed. A direct Vitest invocation without the project dotenv wrapper failed during suite import because the default Supabase URL was absent; rerunning with the repository test environment passed. An accidental `pnpm test:browser -- <path>` invocation started the wider browser suite and was stopped; it is not counted as a Phase 5 result.
