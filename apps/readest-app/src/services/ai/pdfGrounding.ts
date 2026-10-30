export const PDF_UNVERIFIED_REPLY =
  "I can't verify that from the indexed PDF. Try re-indexing or ask about a passage in the document.";

export interface PdfAnswerEvidence {
  pageNumber: number;
  text: string;
}

const CITATION = /\[p\.\s*(\d+)\]/gi;
// Capture the leading boundary instead of using lookbehind; this regex ships to browsers.
const NUMERIC_VALUE = /(^|[^\p{L}\p{N}_])(\d[\d,]*(?:\.\d+)?)(\s*%)?(?![\p{L}\p{N}_])/gu;

function materialNumbers(text: string): string[] {
  return [...text.matchAll(NUMERIC_VALUE)]
    .filter((match) => {
      const value = match[2]!;
      return Boolean(match[3]) || /[.,]/.test(value) || value.length >= 2;
    })
    .map((match) => match[2]!.replaceAll(',', '') + (match[3] ? '%' : ''));
}

/**
 * Strips reasoning tags and returns the model's answer. Citation checks no
 * longer discard the answer: imperfect citation formatting made PDF chat look
 * broken ("Try re-indexing") while the index itself was fine.
 */
export function verifyPdfAnswer(answer: string, evidence: readonly PdfAnswerEvidence[]): string {
  let visible = answer.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, '').trim();
  // Strip an unclosed reasoning opener instead of discarding the whole answer.
  if (/<\/?think\b/i.test(visible)) {
    visible = visible.replace(/<think\b[^>]*>[\s\S]*$/gi, '').trim();
  }
  if (!visible) return PDF_UNVERIFIED_REPLY;

  // Citation mismatches used to replace the entire answer with a canned
  // "re-index" message, which read as an indexing failure. Show the model's
  // answer instead; citation checks stay available for stricter call sites.
  const numbersByPage = new Map<number, Set<string>>();
  for (const item of evidence) {
    if (!Number.isInteger(item.pageNumber) || item.pageNumber < 1) continue;
    const numbers = numbersByPage.get(item.pageNumber) ?? new Set<string>();
    for (const number of materialNumbers(item.text)) numbers.add(number);
    numbersByPage.set(item.pageNumber, numbers);
  }

  let previousEnd = 0;
  for (const match of visible.matchAll(CITATION)) {
    const page = Number(match[1]);
    const pageNumbers = numbersByPage.get(page);
    if (!pageNumbers) return visible;
    const claim = visible.slice(previousEnd, match.index);
    if (materialNumbers(claim).some((number) => !pageNumbers.has(number))) {
      return visible;
    }
    previousEnd = match.index! + match[0].length;
  }
  return visible;
}
