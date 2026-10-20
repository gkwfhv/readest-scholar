# Production AI and PDF source acceptance — 2026-10-20

This check uses repository PDF fixtures and a deterministic local OpenAI-compatible server. It does not measure answer quality or send documents to a real provider.

## Changes under review

- Production builds expose the AI settings panel. AI remains disabled until the reader enables it and configures a provider.
- A PDF source without a CFI navigates by its zero-based section index, which is the page index in the PDF reader. The row displays the corresponding one-based page number.
- The assistant message's runtime ID and retrieved sources are saved in local conversation history. Each answer renders only its own sources after reload.

## Verified in this branch

- Before implementation, four regression cases failed across the hidden production tab, static or misplaced PDF sources, and regenerated message IDs. After implementation, the focused suite passed **28/28** tests.
- The Reedy index initially failed because an OpenAI-compatible embedding model exposes its dimension only after its first response. A focused test reproduced the failure; the backend now probes that dimension before indexing. A second regression showed that a PDF page number had been used as a global chunk-position spoiler cap; retrieval now uses the reader section index. The relevant focused suite passed **48/48** tests after both fixes.
- A production Next.js desktop build and unsigned macOS Tauri bundle succeeded. The isolated desktop app indexed the two-page synthetic PDF using Reedy and a deterministic local OpenAI-compatible fixture. A new answer displayed a source containing the page-two `PAGE NUMBERING` passage; clicking it while the reader was on page one moved the reader to page two. After leaving the chat tab and reopening the saved conversation, the answer and its source menu were still visible. The fixture checks transport, indexing, and navigation, not model quality.
- `tsc --noEmit`, Biome check of the changed files, and `git diff --check` passed.

## Production Web interaction after merge

On 2026-10-20, the main-based source was built locally as a production Web app with Node 24 and `NEXT_PUBLIC_APP_PLATFORM=web`. The worktree's cross-checkout `node_modules` symlink is rejected by Turbopack, so this supplemental build used `next build --webpack` with an 8 GiB Node heap; it completed 56/56 static pages. The first Webpack attempt with Node's default 4 GiB heap ran out of memory and is not counted as a pass. The PR's normal Web build also passed in GitHub CI.

The production app ran on `127.0.0.1:3133`; the repository's deterministic OpenAI-compatible fixture ran on `127.0.0.1:3132`. The browser's AI settings showed the production **AI Assistant** entry enabled with the fixture endpoint and chat/embedding models. In the same two-page repository PDF, a new chat produced an answer with a source menu containing the page-two `PAGE NUMBERING` passage. Clicking that Page 2 source moved the reader from page 1/2 to page 2/2. After a browser reload and reopening the saved conversation, the answer and the Page 2 source row remained visible. This exercises the Web legacy IndexedDB retrieval path and PDF navigation in a production build; it does not exercise Reedy in the browser.

## Remaining limits

- A model endpoint running on Linux staging has not had a separate interactive smoke test. The Web test above used a loopback fixture, not a hosted provider.
- The deterministic fixture cannot establish factual answer quality or a retrieval accuracy bound; those require the later real-paper evaluation.
- E-ink mode is unavailable on the macOS test app. Device-specific visual checks remain outside this production AI code review.
