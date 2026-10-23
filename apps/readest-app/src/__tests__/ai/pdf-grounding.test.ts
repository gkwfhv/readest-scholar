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

  it('refuses empty output', () => {
    expect(verifyPdfAnswer('   ', [8])).toMatch(/cannot verify|can't verify/i);
  });
});
