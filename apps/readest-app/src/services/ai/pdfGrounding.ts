export const PDF_UNVERIFIED_REPLY =
  "I can't verify that from the indexed PDF. Try re-indexing or ask about a passage in the document.";

export interface PdfAnswerEvidence {
  pageNumber: number;
  text: string;
}

const CITATION = /\[p\.\s*(\d+)\]/gi;
const NUMERIC_VALUE = /(?<![\p{L}\p{N}_])(\d[\d,]*(?:\.\d+)?)(\s*%)?(?![\p{L}\p{N}_])/gu;

function materialNumbers(text: string): string[] {
  return [...text.matchAll(NUMERIC_VALUE)]
    .filter((match) => {
      const value = match[1]!;
      return Boolean(match[2]) || /[.,]/.test(value) || value.length >= 2;
    })
    .map((match) => match[1]!.replaceAll(',', '') + (match[2] ? '%' : ''));
}

/**
 * Fail closed for missing or invented page citations. For each cited answer
 * segment, material numeric values must occur in the text retrieved from that
 * specific physical page. This catches wrong-page scientific measurements;
 * it does not establish semantic support for nonnumeric claims.
 */
export function verifyPdfAnswer(answer: string, evidence: readonly PdfAnswerEvidence[]): string {
  const visible = answer.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, '').trim();
  if (/<\/?think\b/i.test(visible)) return PDF_UNVERIFIED_REPLY;
  if (!visible) return PDF_UNVERIFIED_REPLY;

  const numbersByPage = new Map<number, Set<string>>();
  for (const item of evidence) {
    if (!Number.isInteger(item.pageNumber) || item.pageNumber < 1) continue;
    const numbers = numbersByPage.get(item.pageNumber) ?? new Set<string>();
    for (const number of materialNumbers(item.text)) numbers.add(number);
    numbersByPage.set(item.pageNumber, numbers);
  }

  let citations = 0;
  let previousEnd = 0;
  for (const match of visible.matchAll(CITATION)) {
    const page = Number(match[1]);
    const pageNumbers = numbersByPage.get(page);
    if (!pageNumbers) return PDF_UNVERIFIED_REPLY;
    const claim = visible.slice(previousEnd, match.index);
    if (materialNumbers(claim).some((number) => !pageNumbers.has(number))) {
      return PDF_UNVERIFIED_REPLY;
    }
    previousEnd = match.index! + match[0].length;
    citations += 1;
  }
  if (citations === 0 || /[\p{L}\p{N}]/u.test(visible.slice(previousEnd))) {
    return PDF_UNVERIFIED_REPLY;
  }
  return visible;
}
