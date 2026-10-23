import { describe, expect, it } from 'vitest';
import { verifyPdfAnswer } from '@/services/ai/pdfGrounding';

describe('PDF answer citation gate', () => {
  it('accepts only page citations from the retrieved evidence', () => {
    expect(verifyPdfAnswer('The measured value was 42 [p. 8].', [8])).toBe(
      'The measured value was 42 [p. 8].',
    );
  });

  it('refuses an uncited answer even when the model wrote plausible text', () => {
    expect(verifyPdfAnswer('The measured value was 42.', [8])).toMatch(
      /cannot verify|can't verify/i,
    );
  });

  it('refuses a fabricated page even when another citation is valid', () => {
    expect(verifyPdfAnswer('The value is 42 [p. 8] and 43 [p. 9].', [8])).toMatch(
      /cannot verify|can't verify/i,
    );
  });

  it('removes model reasoning before showing a cited answer', () => {
    expect(
      verifyPdfAnswer(
        '<think>private reasoning</think>\n\nLoRA reduces parameters by 10,000 times [p. 1].',
        [1],
      ),
    ).toBe('LoRA reduces parameters by 10,000 times [p. 1].');
  });

  it('fails closed on an unfinished model reasoning block', () => {
    expect(verifyPdfAnswer('<think>unfinished\nLoRA reduces parameters [p. 1].', [1])).toMatch(
      /cannot verify|can't verify/i,
    );
  });

  it('refuses empty output', () => {
    expect(verifyPdfAnswer('   ', [8])).toMatch(/cannot verify|can't verify/i);
  });
});
