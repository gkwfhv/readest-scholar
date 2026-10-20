# Production AI and PDF source acceptance — 2026-10-20

This check uses repository PDF fixtures and a deterministic local OpenAI-compatible server. It does not measure answer quality or send documents to a real provider.

## Changes under review

- Production builds expose the AI settings panel. AI remains disabled until the reader enables it and configures a provider.
- A PDF source without a CFI navigates by its zero-based section index, which is the page index in the PDF reader. The row displays the corresponding one-based page number.
- The assistant message's runtime ID and retrieved sources are saved in local conversation history. Each answer renders only its own sources after reload.

## Verified in this branch

- Before implementation, four regression cases failed across the hidden production tab, static or misplaced PDF sources, and regenerated message IDs. After implementation, the focused suite passed **28/28** tests.
- `tsc --noEmit`, Biome check of the changed files, and `git diff --check` passed.

## Runtime checks still required

- Open the two-page synthetic PDF in a production Web build, index it, ask the deterministic model a question, click the page-two source and confirm page two appears, then reload and confirm that the source stays with its answer.
- Repeat an indexed answer with the desktop Reedy retrieval backend and the isolated staging backend. Record the model fixture and whether a real external model was used.
- Check the empty conversation composer in light, dark, e-ink, RTL, and narrow safe-area layouts before merging the startup dependency PR.
