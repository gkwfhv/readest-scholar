export const PDF_UNVERIFIED_REPLY =
  "I can't verify that from the indexed PDF. Try re-indexing or ask about a passage in the document.";

/**
 * Fail closed when a generated PDF answer has no traceable page citation or
 * cites a page absent from the passages retrieved for this turn. This does
 * not prove every claim; the saved Sources panel carries the actual excerpts.
 */
export function verifyPdfAnswer(answer: string, evidencePages: readonly number[]): string {
  const allowed = new Set(evidencePages.filter((page) => Number.isInteger(page) && page > 0));
  const citations = [...answer.matchAll(/\[p\.\s*(\d+)\]/gi)].map((match) => Number(match[1]));
  if (!answer.trim() || citations.length === 0 || citations.some((page) => !allowed.has(page))) {
    return PDF_UNVERIFIED_REPLY;
  }
  return answer.trim();
}
