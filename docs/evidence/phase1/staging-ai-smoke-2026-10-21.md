# Staging Web synthetic AI smoke — 2026-10-21

## Scope

Authorized Linux x86_64 `scholar-staging-client` at image `sha256:141ac3b06f2df2240addeb94006a24c3e81631a2bc257c8d7850058ea38a4151`, reached through the existing SSH loopback tunnel (Web 3130, API 8130, object 9130). The browser on the Mac used the repository's existing deterministic `synthetic-openai-server.mjs` fixture on `127.0.0.1:3132`; this is a UI/transport/indexing smoke, not a Linux-hosted or quality-assessed model run. The only book was the repository's synthetic `sample-paper.pdf` in the staging account.

## Observed

1. In staging Web settings, enabled AI Assistant, selected OpenAI compatible, used the disposable `scholar-test` marker, `http://127.0.0.1:3132/v1`, `scholar-test-chat`, and `scholar-test-embed`. Model refresh listed both fixture models; “Test connection” showed “已连接”.
2. Opening the two-page sample PDF showed four footer icons in one row within the mobile sidebar; the last is the brain/chat icon. The AI chat created a conversation, indexed the sample, and answered “What is the paper title? Cite the relevant passage.” with “The title shown on page 1 is TITLE OF THE PAPER. This is a deterministic test response.”
3. “View sources” displayed a Page 1 passage containing `TITLE OF THE PAPER` and a Page 2 passage containing `PAGE NUMBERING`. A click to navigate from the source list could not be completed through the browser automation surface; Phase 0 already has a separate production Web citation-navigation check. After reload, the saved conversation, answer, and View sources control were still present.
4. Chat screenshot: [readest-staging-ai-chat-2026-10-21.jpg](readest-staging-ai-chat-2026-10-21.jpg).

## Limits

The fixture returns fixed text and does not assess grounding, citations, hallucination, or a real model service. The fixture was local to the Mac; the staging Linux host did not run a model. No real document, production account, signing key, or production secret was used. The AI setting changed only for the disposable staging account. This evidence is separate from the formal desktop deep-link PR.
