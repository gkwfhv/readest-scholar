# Phase 5 native PDF answer and source QA (2026-10-23)

Status: native reader replay and final server unit regression passed. The live reader exposed a wrong-page BERT citation; the corrected gate passed focused tests and a rebuilt CEF replay. The Web production build also passed; GitHub checks remain.

## Environment

- All builds and UI runs were on the Linux test server. The current CEF debug build used the repository's Linux CEF wrapper and a production static frontend; no native build ran on the Mac.
- Isolated `scholar-native-qa-b` desktop container at 800 × 600, with real PDF files imported through the app's file picker.
- Locally hosted Qwen3-0.6B-Q8_0 via an OpenAI-compatible endpoint on the Docker bridge. The synthetic API key stayed in GNOME Keyring. The model's embedding endpoint returns HTTP 500, so each PDF was indexed with the product's BM25-only fallback.
- Account scoped indices were observed separately for guest and the synthetic staging account after the desktop client restored its login.

## Full reader observations before the final citation-gate rebuild

| Paper | Reader position | Question / expected fact | Displayed result |
| --- | --- | --- | --- |
| Attention Is All You Need | p. 1 | Abstract's WMT 2014 English–German BLEU | `The value is 28.4 [p. 1].` Correct. The first source card carried the 28.4 passage from physical p. 1. |
| LoRA | p. 1 | Reduction in trainable parameters compared with GPT-3 175B | `The factor is 10,000 times [p. 1].` Correct against the p. 1 abstract. |
| Attention Is All You Need | p. 7 | Unsupported family biography / Nobel date | Refused with the product's unverified-PDF reply. |
| Attention Is All You Need | p. 8 | Warmup steps: 4000 appears in a retrieved p. 7 passage | The small model refused despite the source. This is a false negative, not a wrong factual answer. Selecting that source card moved the open reader from physical p. 8 to p. 7. |
| BERT | p. 4 | Selected MLM tokens replaced by `[MASK]` 80% of the time | **Defect reproduced:** model wrote `80% [p. 1]`, although the retrieved supporting text is on physical p. 4. The old gate admitted p. 1 merely because p. 1 was in the retrieved set. |

The model is a small local smoke-test model; these observations do not establish a population accuracy rate. The reader did not expose source text as an instruction in the three supported questions.

## Post-fix BERT replay

The corrected static build and CEF debug build both exited 0. The same BERT p. 4 question in the rebuilt reader displayed the unverified-PDF refusal, so the incorrect p. 1 citation did not reach the UI. This is a safe refusal, not evidence that the 0.6B model now answers BERT correctly. The raw model completion was not captured, so the UI observation alone cannot distinguish model refusal from the new deterministic gate.

## Correction and limits

- The PDF spoiler boundary now converts the zero-based section index to a one-based physical page. A red/green test reproduced the page-one empty retrieval issue. Without this fix, a first-page query was rejected before model generation.
- The citation gate now takes the actual retrieved text, checks material numeric values against **the page cited for each segment**, and rejects trailing uncited text. The BERT wrong-page answer is rejected in both gate and adapter tests. The PDF prompt also tells the model to cite the page containing each numeric value.
- This deterministic check catches misplaced scientific numbers in the observed examples. It does **not** prove semantic entailment for nonnumeric claims, and it deliberately may refuse a correct small-model answer. The Sources panel remains available for human verification.
- The post-fix CEF build and live BERT replay passed the safety check; the final full server unit regression passed: 1,243 files and 14,135 tests passed; 4 files and 16 tests were skipped by existing configuration. The exit code was 0 in /tmp/scholar-phase5-final-unit-v8.log. The Web production build exited 0 in /tmp/scholar-phase5-citation-web.log; GitHub checks remain pending.

## Captures

- [Attention answer](images/native-attention-answer.png)
- [Attention source cards](images/native-attention-sources.png)
- [LoRA answer](images/native-lora-answer.png)
- [BERT wrong citation before correction](images/native-bert-wrong-citation-before.png)
- [BERT safe refusal after correction](images/native-bert-safe-after.png)
