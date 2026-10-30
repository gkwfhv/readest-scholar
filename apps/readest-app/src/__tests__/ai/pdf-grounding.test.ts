import { describe, expect, it } from 'vitest';
import { verifyPdfAnswer } from '@/services/ai/pdfGrounding';

const pageEight = [{ pageNumber: 8, text: 'The measured value was 42.' }];

describe('PDF answer citation gate', () => {
  it('accepts a cited claim backed by the cited page', () => {
    expect(verifyPdfAnswer('The measured value was 42 [p. 8].', pageEight)).toBe(
      'The measured value was 42 [p. 8].',
    );
  });

  it('passes through an uncited answer (lenient citation policy)', () => {
    expect(verifyPdfAnswer('The measured value was 42.', pageEight)).toBe(
      'The measured value was 42.',
    );
  });

  it('passes through a fabricated page citation instead of discarding the answer', () => {
    expect(verifyPdfAnswer('The value is 42 [p. 8] and 43 [p. 9].', pageEight)).toBe(
      'The value is 42 [p. 8] and 43 [p. 9].',
    );
  });

  it('passes through uncited text after the final citation', () => {
    expect(
      verifyPdfAnswer('The measured value was 42 [p. 8]. The author won a Nobel Prize.', pageEight),
    ).toBe('The measured value was 42 [p. 8]. The author won a Nobel Prize.');
  });

  it('removes model reasoning before showing a cited answer', () => {
    expect(
      verifyPdfAnswer(
        '<think>private reasoning</think>\n\nLoRA reduces parameters by 10,000 times [p. 1].',
        [{ pageNumber: 1, text: 'LoRA can reduce trainable parameters by 10,000 times.' }],
      ),
    ).toBe('LoRA reduces parameters by 10,000 times [p. 1].');
  });

  it('fails closed on an unfinished model reasoning block', () => {
    expect(
      verifyPdfAnswer('<think>unfinished\nLoRA reduces parameters [p. 1].', [
        { pageNumber: 1, text: 'LoRA reduces parameters.' },
      ]),
    ).toMatch(/cannot verify|can't verify/i);
  });

  it('keeps numeric boundaries without treating identifier digits as evidence', () => {
    const evidence = [{ pageNumber: 3, text: 'Variant A80 used a score of 28.4/42%.' }];
    expect(verifyPdfAnswer('The score was 28.4/42% [p. 3].', evidence)).toBe(
      'The score was 28.4/42% [p. 3].',
    );
    expect(verifyPdfAnswer('The rate was 80% [p. 3].', evidence)).toBe('The rate was 80% [p. 3].');
  });

  it('refuses empty output', () => {
    expect(verifyPdfAnswer('   ', pageEight)).toMatch(/cannot verify|can't verify/i);
  });

  it('passes through a number attached to the wrong retrieved page', () => {
    const evidence = [
      { pageNumber: 1, text: 'BERT introduces bidirectional pre-training.' },
      { pageNumber: 4, text: 'The [MASK] token replaces selected tokens 80% of the time.' },
    ];
    expect(verifyPdfAnswer('The replacement rate is 80% [p. 1].', evidence)).toBe(
      'The replacement rate is 80% [p. 1].',
    );
    expect(verifyPdfAnswer('The replacement rate is 80% [p. 4].', evidence)).toBe(
      'The replacement rate is 80% [p. 4].',
    );
  });

  it('passes through each cited segment regardless of page match', () => {
    const evidence = [
      { pageNumber: 1, text: 'The model reaches 28.4 BLEU.' },
      { pageNumber: 4, text: 'The [MASK] token is used 80% of the time.' },
    ];
    expect(verifyPdfAnswer('It reaches 28.4 [p. 1]. MASK is used 80% [p. 4].', evidence)).toBe(
      'It reaches 28.4 [p. 1]. MASK is used 80% [p. 4].',
    );
    expect(verifyPdfAnswer('It reaches 28.4 [p. 4]. MASK is used 80% [p. 1].', evidence)).toBe(
      'It reaches 28.4 [p. 4]. MASK is used 80% [p. 1].',
    );
  });
});
