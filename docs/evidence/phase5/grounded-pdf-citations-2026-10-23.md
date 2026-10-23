# Phase 5 PDF citation foundation (2026-10-23)

Status: implementation slice; Phase 5 is not yet accepted.

## Implemented

- Legacy PDF indexing uses the real one-based physical page for every chunk in a PDF section. Existing character-estimated PDF indexes are detected and replaced before reuse. EPUB and other book formats retain their previous estimated page behavior.
- Both legacy IDB and desktop Reedy MVP PDF chat now retrieve passages before generation. If retrieval fails or returns no passages, the assistant gives a deterministic refusal without asking a model to answer from an empty context.
- PDF prompts carry page-labelled passages, instruct the model to cite only those pages, and serialize passage text as untrusted data. Generated PDF answers are buffered until complete; an answer without a citation or with any page outside this turn's retrieved set is replaced by a refusal. The Sources panel retains the actual passages for navigation.
- A real browser test creates a two-page, two-column synthetic PDF and verifies extraction and citation on physical page two.

## Verification

- Red/green tests reproduced the old PDF page estimate and the no-evidence model call before the fixes.
- The server build container passed 25 focused unit tests across four files and one real Chromium PDF extraction test. TypeScript, Biome lint and format, and the Web production build passed. The full supported CI matrix remains pending for this Phase 5 candidate.

## Remaining Phase 5 acceptance work

- Verify answer claims against a real licensed paper set; matching page numbers alone does not prove that every claim is supported by the cited text.
- Move AI API keys to secure native storage and an authenticated server-side vault for Web use. Current settings persistence is not the final security design.
- Isolate local indexes and conversation history by account, and test account switching and guessed identifiers.
- Add selected-text explain/translate/summarize actions, scanned-PDF text-quality detection, deletion tests for derived indexes and conversations, and model configuration/compatibility tests.
