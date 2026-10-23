# Phase 5: native AI API key storage (2026-10-23)

Status: implementation slice on the draft Phase 5 branch. Phase 5 is **not accepted**.

## Behavior

- Desktop AI Gateway and OpenAI-compatible API keys use the existing native bridge to the operating system keychain. The keychain item name includes the active account scope; a guest uses a separate scope.
- The desktop settings writer removes both API key fields from `settings.json` and `settings.json.bak`. The in-memory settings retain the active account key so existing AI providers can use it.
- When desktop settings are loaded, keys come from the current account's keychain slot. Old plaintext settings keys have no reliable account owner, so they are scrubbed from both settings files and must be entered again. The AI settings panel shows a dismissible re-entry notice and the app logs a generic message without the key value.
- A native key edit is saved on field blur. A rejected keychain write leaves the persisted settings unchanged and shows an error in the AI settings panel.
- Login and logout clear the prior account's in-memory keys before loading the next account. A delayed keychain read or settings load from an earlier account cannot replace the newer account's keys; the settings store rejects snapshots with a different in-memory credential owner. A token refresh for the same account does not clear keys.

## Red/green verification

- The new credential tests initially failed because the module was missing. After implementation, 6/6 storage, persistence, hydration and startup-race tests passed in the server builder container.
- A dedicated rendered AuthProvider test passed 2/2 account-switch checks, including a delayed old-account keychain response.
- The AI settings model test initially failed when the new account context was absent from the test fixture. After updating that fixture, 4/4 tests passed, including native save-on-blur and the legacy-key re-entry notice. Another 2/2 settings-store tests reject a delayed old-account snapshot.
- Existing auth context tests passed 4/4. `pnpm lint` passed TypeScript and Biome across 2,922 files at the final native credential changes.
- The first broad test attempt inherited `NODE_ENV=production` and `SELF_HOSTED=true` from the builder container. React test rendering and ordinary Readest environment expectations failed under those values. Isolated reproductions passed with `NODE_ENV=test SELF_HOSTED=false`. The first `pnpm test` command also entered watch mode and was stopped. The first one-shot retry with `SELF_HOSTED=false` passed 14,088 tests but failed two tests that deliberately stub `NEXT_PUBLIC_SELF_HOSTED=true` (the explicit nonempty `SELF_HOSTED=false` masked that stub), plus one 5-second timeout under concurrent build load. All three passed in isolation with the deployment-only variable removed. The final one-shot command `env -u SELF_HOSTED NODE_ENV=test pnpm test:pr:web:unit` passed: 1,235 test files and 14,095 tests passed; 4 files and 16 tests were skipped by the existing configuration; 0 failed. It ran for 641 seconds on the server builder container. The Web production build (`pnpm build-web`) and Tauri static frontend build (`pnpm build`) passed on the same server checkout. After those builds, only the two new Chinese locale strings were added; both locale JSON files parsed, `git diff --check` passed, and the final `pnpm lint` passed TypeScript plus Biome across 2,922 files.

## Limits before Phase 5 acceptance

- Browser/Web keys still use the older client settings path. They need an authenticated encrypted server vault and account-switch integration before the Phase 5 security criterion passes.
- Native keychain calls are mocked in unit tests. A real desktop keychain write/restart/read must be tested on a supported OS. An unavailable keychain intentionally rejects new key saves.
- Scrubbing an older plaintext key requires a user to re-enter it; the AI settings panel now shows a dismissible notice.
- Real-paper claim support, PDF citation accuracy, deletion/indexing races, and the remaining Phase 5 acceptance checks are tracked in `grounded-pdf-citations-2026-10-23.md`.
