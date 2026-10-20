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
- `tsc --noEmit` and Biome lint of the changed component passed. `ai-chat-store.test.ts` and `ai-store.test.ts`: 31 passed.

## Limits and remaining gaps

- The mock returns fixed text regardless of the prompt, so this does not prove grounding or hallucination behavior.
- The Web legacy IndexedDB backend has no CFI on source chunks; its source rows are static and do not navigate to PDF pages. The source list was not restored after reload because `ReedySourceStore` is in memory.
- The upstream production Web settings currently disable the AI tab (`SettingsDialog.tsx`); the staging production image therefore cannot repeat this user path. Production AI and clickable citations remain Phase 0 gaps under the plan's key-path criterion.
- This test did not exercise the Tauri Reedy runtime, a real model, or cross-device sync.
