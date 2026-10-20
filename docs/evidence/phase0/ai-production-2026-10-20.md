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

## Remaining limits

- The production Web AI path and a model endpoint running on staging have not had a separate interactive smoke test. CI's Web build is a compile check, not that interaction.
- The deterministic fixture cannot establish factual answer quality or a retrieval accuracy bound; those require the later real-paper evaluation.
- E-ink mode is unavailable on the macOS test app. Device-specific visual checks remain outside this production AI code review.
