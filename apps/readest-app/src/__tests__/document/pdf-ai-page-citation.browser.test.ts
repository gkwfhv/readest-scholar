import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { makePDF } from 'foliate-js/pdf.js';
import { chunkSection } from '@/services/ai/utils/chunker';
import { buildPdfResearchPrompt } from '@/services/ai/prompts';

interface PdfBook {
  sections: Array<{ createDocument: () => Promise<Document> }>;
  destroy: () => void;
}

describe('PDF research citation extraction', () => {
  it('indexes two-column PDF text under the actual physical page', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const first = pdf.addPage([612, 792]);
    first.drawText('FIRST PAGE CONTROL', { x: 55, y: 690, size: 16, font });
    const second = pdf.addPage([612, 792]);
    second.drawText('LEFT COLUMN RESULT 42', { x: 55, y: 690, size: 16, font });
    second.drawText('RIGHT COLUMN METHOD BETA', { x: 340, y: 690, size: 16, font });

    const bytes = await pdf.save();
    const book = (await makePDF(
      new File([new Uint8Array(bytes)], 'research.pdf', {
        type: 'application/pdf',
      }),
    )) as unknown as PdfBook;
    try {
      const doc = await book.sections[1]!.createDocument();
      const chunks = chunkSection(doc, 1, 'Page 2', 'synthetic-pdf', 50_000, {
        pageNumber: 2,
        minChunkSize: 1,
      });
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.every((chunk) => chunk.pageNumber === 2)).toBe(true);
      const text = chunks.map((chunk) => chunk.text).join(' ');
      expect(text).toContain('LEFT COLUMN RESULT 42');
      expect(text).toContain('RIGHT COLUMN METHOD BETA');
      expect(text).not.toContain('FIRST PAGE CONTROL');

      const prompt = buildPdfResearchPrompt(
        'Research PDF',
        'Researcher',
        chunks.map((chunk) => ({
          ...chunk,
          score: 1,
          searchMethod: 'hybrid' as const,
        })),
        2,
      );
      expect(prompt).toContain('[p. 2]');
      expect(prompt).not.toContain('[p. 1]');
    } finally {
      book.destroy();
    }
  }, 30000);
});
