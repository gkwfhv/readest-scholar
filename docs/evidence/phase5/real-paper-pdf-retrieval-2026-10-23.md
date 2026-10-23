# Phase 5 real-paper PDF extraction and lexical retrieval (2026-10-23)

Status: server-side evaluation of the Phase 5 PDF extraction path. This is **not** a model-answer quality acceptance or Phase 5 sign-off.

## Corpus and method

Three public arXiv PDFs were fetched directly to a private directory on the Linux test server, verified by SHA-256, and served only inside the isolated builder browser probe. They were never committed to Git. The temporary browser fixture was removed before the final build and commit. The probe used the product `makePDF` loader, `extractTextFromDocument`, `chunkSection`, `AIStore.saveChunks`, `AIStore.saveBM25Index`, and `AIStore.bm25Search` in Chromium. The test asserted every chunk’s one-based physical PDF page and that each fact phrase appeared on its independently checked page and in the top three lexical search results.

| Paper | SHA-256 | Physical pages | Fact phrase → expected physical page |
| --- | --- | ---: | --- |
| [Attention Is All You Need](https://arxiv.org/abs/1706.03762) | `bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697` | 15 | `28.4` → 1; `position-wise` → 5; `label smoothing` → 8 |
| [BERT](https://arxiv.org/abs/1810.04805) | `5692a5514787a8c6727b4ff3b726a3385798bc68e12138d1d4af83947e2acf6e` | 16 | `80.5` → 1; `80% of the time` → 4; `SQuAD` → 6 |
| [LoRA](https://arxiv.org/abs/2106.09685) | `e9a0d3128767db616085dc0f4e6e455e672e89af823e8ed1282793682787395a` | 26 | `10,000` → 1; `rank-deficiency` → 13; `trainable parameters` → 5 |

## Result

- Chromium browser probe: 3/3 papers, 9/9 page assertions, 9/9 fact phrases within the top three BM25 results.
- The first probe exposed a real extraction bug: PDF.js splits `80% of the time` across presentation spans and `<br>`, while plain `textContent` collapsed it to `80% ofthe time`. A red unit test reproduced that text and the extractor now inserts word boundaries for PDF presentation runs. Repeated real-PDF probes passed after the fix.
- An earlier full one-shot unit run for the deletion/indexing slice passed 1,241 files and 14,119 tests, with four files/16 tests skipped by existing project configuration. That run preceded the final PDF extractor change; focused extractor and browser probes passed afterward. The final Phase 5 tree passed a one-shot full unit run in the server builder on 2026-10-23: 1,243 files and 14,130 tests passed; four files and 16 tests were skipped by existing configuration. Log: `/tmp/scholar-phase5-final-unit-v6.log` inside `scholar-native-builder`, exit 0.

## Remaining acceptance scope

The exact-phrase probe measures parsing, physical-page preservation, and lexical search on searchable PDFs. It does not measure semantic retrieval, scanned-image OCR, model-generated claim support, UI navigation from citations, or refusal behavior with a live OpenAI-compatible model. Those remain separate Phase 5 acceptance gates.
