# Phase 5 local-model PDF answer probe (2026-10-23)

Status: live OpenAI-compatible answer and citation probe passed; **Phase 5 is not yet signed off** because the corpus excerpts and the citation navigation UI were exercised in separate probes, not in one complete native reader flow.

## Private server setup

- Linux builder container `scholar-native-builder`; model API bound to the Docker bridge gateway `172.20.0.1:3168` only.
- Runtime: locally compiled `llama-cpp-python 0.3.36` server from the verified source tarball (SHA-256 `832db0699007f1be95a7e41ef12e88926b02ba836461e36a36372db2760c1a2e`).
- Model: official [Qwen3-0.6B-GGUF](https://modelscope.cn/models/Qwen/Qwen3-0.6B-GGUF), revision `6abe20cd0aed577f4d0b267935868ecae190aee9`, `Qwen3-0.6B-Q8_0.gguf`, SHA-256 `9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031`; Apache-2.0. The model and PDF files remain in private server directories, outside Git.
- Adapter: product `createTauriAdapter` and `OpenRouterProvider` against the live local `/v1/chat/completions` API, using a synthetic key. The test stub supplied a 500-character excerpt from a verified physical page; this isolates generation and citation handling. A separate [browser extraction and BM25 probe](real-paper-pdf-retrieval-2026-10-23.md) checked the product PDF parser and top-three lexical retrieval across nine page facts.

## Observed answer quality

| Paper / physical page | Prompt | Displayed answer | Result |
| --- | --- | --- | --- |
| Attention Is All You Need, p. 1 | English–German BLEU score | `28.4 [p. 1].` | Supported and correct page |
| BERT, p. 4 | Frequency of `[MASK]` replacement | `80% [p. 4]` | Supported and correct page |
| LoRA, p. 1 | Trainable-parameter reduction factor | `The factor by which LoRA can reduce trainable parameters is 10,000 times [p. 1].` | Supported and correct page |
| Each of the same three papers | Three absent biographical/cost questions | `I can't verify that from the indexed PDF. Try re-indexing or ask about a passage in the document.` | 3/3 refused |

The first baseline with full page text returned the fallback for all three supported prompts. Short retrieved-sized excerpts improved this to 1/3. An exact citation format instruction improved it to 2/3. Setting PDF generation temperature to zero and stripping model `<think>` blocks produced the result above: 3/3 supported, 3/3 absent refused. This is a small deterministic smoke set, not a statistical accuracy claim. The citation gate still checks cited page membership, not claim-level entailment.

## Two-page adversarial citation probe

A second set supplied two 500-character excerpts from different verified pages. With Attention pages 1 and 5, the model correctly answered the position-wise feed-forward question from page 5 and cited `[p. 5]` despite the format example citing page 1. With BERT pages 4 and 6, the model refused a question whose page-6 excerpt mentioned the SQuAD benchmark; when asked what SQuAD is, it returned the tautological `SQuAD v1.1 [p. 6].` The page number was valid, but the answer was not useful. This is a model-quality limitation, not a passing claim-support check. A larger local model and complete reader flow remain to be evaluated before Phase 5 acceptance.

## Embedding compatibility finding

This local chat model does not provide a usable OpenAI embedding response by default. Enabling llama-cpp-python's embedding mode yielded per-token nested vectors rather than one numeric vector per input. Before the fix, PDF indexing required embeddings and could not reach its BM25 storage step. The legacy PDF index now falls back to `bm25-only` metadata when embedding fails or returns malformed vectors, and query search skips repeat embedding attempts for that index. Non-PDF indexing remains strict. The optional Reedy backend still requires a compatible embedding model and is not covered by this fallback.

## Regression evidence

- Focused tests: `pdf-index.test.ts`, `pdf-grounding.test.ts`, `TauriChatAdapter.test.ts`: 22/22 passed after red tests for reasoning leakage, deterministic temperature, and missing/malformed embeddings.
- TypeScript `tsc --noEmit` and Biome check of all changed files: passed.
- Full server unit run: 1,243 files / 14,130 tests passed, four files / 16 tests skipped by existing configuration; `/tmp/scholar-phase5-final-unit-v6.log`, exit 0. Web and Tauri static production builds passed; native build and native reader UI citation navigation checks remain to be recorded.
