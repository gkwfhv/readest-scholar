# Web AI conversation smoke test — 2026-10-20

## Scope

This is a **development-build transport and UI smoke test**, not a model-quality or production acceptance test. The OpenAI-compatible endpoint is a deterministic local fixture and receives only the repository's synthetic `sample-paper.pdf`.

## Setup and reproduction

1. Run `node docs/evidence/phase0/synthetic-openai-server.mjs`. It listens on `127.0.0.1:3132` and serves `/v1/models`, `/v1/embeddings`, and `/v1/chat/completions`.
2. Start the Web app in development mode and open its AI settings. Set provider to OpenAI compatible, base URL to `http://127.0.0.1:3132/v1`, API key to a disposable value such as `scholar-test`, chat model to `scholar-test-chat`, and embedding model to `scholar-test-embed`. The connection test displayed “已连接”.
3. Import `apps/readest-app/src/__tests__/fixtures/data/sample-paper.pdf`, open it, and start indexing from the AI notebook. Ask “What is the paper title? Please cite the relevant passage.”
4. Open “View sources”, then reload and reopen the conversation to check history.

## Observed result

- Before the fix, selecting an indexed conversation raised `TypeError: Cannot set properties of undefined (setting '_getInitializePromise')` in `@assistant-ui/react@0.11.58`. The package called an extracted instance method without its receiver.
- After binding that call to `runtimeCore`, the exception stopped. A second defect left newly created empty conversations blank because `ThreadPrimitive.Empty` was rendered only when there was no active conversation. Showing the empty state after history loading restored the composer.
- The synthetic answer appeared, “View sources” showed passages including `TITLE OF THE PAPER`, and the exchange remained visible after reload. Screenshot: [ai-chat-synthetic-sources.png](ai-chat-synthetic-sources.png).
- A regression test for an active empty conversation failed against the old `!hasActiveConversation` gate with `Unable to find an element with the text: Ask about this book`, then passed after the change. With `ai-chat-store.test.ts` and `ai-store.test.ts`, the focused suite had **33 passed**. `tsc --noEmit` and Biome check of the changed component and test passed.

## CI follow-up

- The first PR run rejected an incomplete patch hunk during `pnpm install --frozen-lockfile`. Commit `81885b74b` reduced the patch to the runtime file and updated the lock hash; the next run passed dependency installation, Web build, and Scholar `source-inventory`.
- That run's Web browser shard failed an unrelated existing notebook mutation performance assertion: 256 KiB p95 was **62.46 ms** against the approved **50 ms** limit on the shared GitHub runner. The same browser test passed locally, **2/2**, when run alone. This is an unresolved CI result, not an AI feature pass or an accepted relaxation of the limit.

## Limits and remaining gaps

- The mock returns fixed text regardless of the prompt, so this does not prove grounding or hallucination behavior.
- The Web legacy IndexedDB backend has no CFI on source chunks; its source rows are static and do not navigate to PDF pages. The source list was not restored after reload because `ReedySourceStore` is in memory.
- The upstream production Web settings currently disable the AI tab (`SettingsDialog.tsx`); the staging production image therefore cannot repeat this user path. Production AI and clickable citations remain Phase 0 gaps under the plan's key-path criterion.
- This test did not exercise the Tauri Reedy runtime, a real model, or cross-device sync.
