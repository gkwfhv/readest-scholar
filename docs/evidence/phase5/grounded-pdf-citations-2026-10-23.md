# Phase 5 PDF citation foundation (2026-10-23)

Status: implementation slice; Phase 5 is not yet accepted.

## Implemented

- Legacy PDF indexing uses the real one-based physical page for every chunk in a PDF section. Existing character-estimated PDF indexes are detected and replaced before reuse. EPUB and other book formats retain their previous estimated page behavior.
- Both legacy IDB and desktop Reedy MVP PDF chat now retrieve passages before generation. If retrieval fails or returns no passages, the assistant gives a deterministic refusal without asking a model to answer from an empty context.
- PDF prompts carry page-labelled passages, instruct the model to cite only those pages, and serialize passage text as untrusted data. Generated PDF answers are buffered until complete; an answer without a citation or with any page outside this turn's retrieved set is replaced by a refusal. The Sources panel retains the actual passages for navigation.
- A real browser test creates a two-page, two-column synthetic PDF and verifies extraction and citation on physical page two.
- AI index and chat keys now include the active account (with a separate guest scope) in both legacy and Reedy paths. On scope changes, the UI clears prior conversations/messages before loading, cancels an active agent turn, and rejects guessed conversation IDs for reads, rename, delete and writes. Old unscoped data is left untouched rather than silently assigned to a different account.
- A PDF with no extractable text reports an OCR-needed error instead of silently ending indexing. The message is translated for Simplified Chinese.
- The customizable selection toolbar offers opt-in Explain, Summarize and Translate with AI actions. A chosen passage is quoted as untrusted source text and placed into the account-scoped assistant composer for review, without automatically sending it. Switching account/book clears pending drafts and aborts an active Reedy turn.

## Verification

- Red/green tests reproduced the old PDF page estimate and the no-evidence model call before the fixes. Replacing only the chat store with the prior HEAD made the new guessed-conversation-id test fail because the promise resolved instead of rejecting; restoring the changed store made it pass.
- The first citation slice passed 25 focused unit tests across four files and one real Chromium PDF extraction test, TypeScript, Biome and Web production build.
- The account-isolation slice passed 55 focused unit tests across six files, plus two real Chromium tests (PDF page extraction and IndexedDB cross-account deletion), TypeScript and Biome. The Web production build passed after the final localization change.
- The selected-text slice passed 133 focused unit tests across 17 files; three real Chromium toolbar tests passed at 390 px LTR, 390 px RTL/e-ink and 1024 px LTR. The [mobile LTR](images/selected-text-ai-toolbar-mobile-ltr.png) and [RTL/e-ink](images/selected-text-ai-toolbar-mobile-rtl-eink.png) screenshots show the three icons inside one toolbar row. These isolated toolbar screenshots do not establish full reader end-to-end layout. TypeScript/Biome lint and the Web production build passed on the Linux server.
- A broad unit run was started but stopped before completion because this is still a draft Phase 5 slice; a complete supported CI matrix is required before Phase 5 acceptance.

## Remaining Phase 5 acceptance work

- Verify answer claims against a real licensed paper set; matching page numbers alone does not prove that every claim is supported by the cited text.
- Move AI API keys to secure native storage and an authenticated server-side vault for Web use. Current settings persistence is not the final security design.
- Verify account switching with two real staging logins in the rendered desktop/Web UI; current checks cover store-level switching, guessed identifiers and real Chromium IndexedDB persistence. Decide whether to expose an explicit, account-verified migration for old unscoped chat history.
- Verify selected-text actions in the rendered reader/assistant flow across desktop and Web; add scanned-PDF text-quality detection, deletion tests for derived indexes and conversations, and model configuration/compatibility tests.
