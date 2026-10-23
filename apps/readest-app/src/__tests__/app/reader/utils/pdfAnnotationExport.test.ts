import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDocument, PDFName, degrees } from 'pdf-lib';
import type { BookNote } from '@/types/book';
import { exportPdfAnnotations, visualRectToPdfQuad } from '@/app/reader/utils/pdfAnnotationExport';

describe('PDF annotation export', () => {
  it('maps crop offsets and all quarter-turn rotations into PDF coordinates', () => {
    const box = { x: 10, y: 20, width: 200, height: 300 };
    const rect: [number, number, number, number] = [0.1, 0.2, 0.5, 0.3];
    expect(visualRectToPdfQuad(rect, box, 0)).toEqual([30, 260, 110, 260, 30, 230, 110, 230]);
    expect(visualRectToPdfQuad(rect, box, 90)).toEqual([50, 50, 50, 170, 70, 50, 70, 170]);
    expect(visualRectToPdfQuad(rect, box, 180)).toEqual([190, 80, 110, 80, 190, 110, 110, 110]);
    expect(visualRectToPdfQuad(rect, box, 270)).toEqual([170, 290, 170, 170, 150, 290, 150, 170]);
  });

  it('lands on the same viewport pixels as PDF.js after crop, zoom and rotation', async () => {
    await import('@pdfjs/pdf.min.mjs');
    const pdfjs = (globalThis as Record<string, unknown>)['pdfjsLib'] as {
      GlobalWorkerOptions: { workerSrc: string };
      getDocument: (input: { data: Uint8Array }) => {
        promise: Promise<{
          getPage: (page: number) => Promise<{
            getViewport: (options: { scale: number }) => {
              width: number;
              height: number;
              convertToViewportPoint: (x: number, y: number) => [number, number];
            };
          }>;
        }>;
        destroy: () => Promise<void>;
      };
    };
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      `file://${process.cwd()}/public/vendor/pdfjs/pdf.worker.min.mjs`,
    ).href;
    for (const rotation of [0, 90, 180, 270]) {
      const document = await PDFDocument.create();
      const page = document.addPage([250, 350]);
      page.setCropBox(10, 20, 200, 300);
      page.setRotation(degrees(rotation));
      const loading = pdfjs.getDocument({ data: new Uint8Array(await document.save()) });
      try {
        const pdfPage = await (await loading.promise).getPage(1);
        const viewport = pdfPage.getViewport({ scale: 2 });
        const quad = visualRectToPdfQuad(
          [0.1, 0.2, 0.5, 0.3],
          { x: 10, y: 20, width: 200, height: 300 },
          rotation,
        );
        for (const [point, expected] of [
          [0, [0.1, 0.2]],
          [2, [0.5, 0.2]],
          [4, [0.1, 0.3]],
          [6, [0.5, 0.3]],
        ] as const) {
          const [x, y] = viewport.convertToViewportPoint(quad[point]!, quad[point + 1]!);
          expect(x / viewport.width).toBeCloseTo(expected[0], 6);
          expect(y / viewport.height).toBeCloseTo(expected[1], 6);
        }
      } finally {
        await loading.destroy();
      }
    }
  });

  it('writes standard markup dictionaries and preserves the original source', async () => {
    const source = await PDFDocument.create();
    source.addPage([200, 300]);
    source.addPage([200, 300]);
    const original = new Uint8Array(await source.save()).buffer;
    const originalCopy = original.slice(0);
    const note: BookNote = {
      id: 'paper-1',
      type: 'annotation',
      cfi: 'epubcfi(/6/4!/4/2)',
      text: 'selected text',
      note: 'research comment',
      style: 'highlight',
      color: 'yellow',
      page: 2,
      pdfAnchor: {
        version: 1,
        pageIndex: 1,
        cfi: 'epubcfi(/6/4!/4/2)',
        rects: [
          [0.1, 0.2, 0.5, 0.3],
          [0.1, 0.35, 0.4, 0.45],
        ],
      },
      createdAt: 1,
      updatedAt: 2,
    };
    const output = await exportPdfAnnotations(original, [
      { note, colorHex: '#ffaa00' },
      { note: { ...note, id: 'legacy', pdfAnchor: undefined } },
    ]);
    expect(output.exported).toBe(1);
    expect(output.skipped).toBe(1);
    expect(output.omissions).toMatchObject([{ id: 'legacy', reason: 'missing-anchor' }]);
    expect(original).toEqual(originalCopy);

    const parsed = await PDFDocument.load(output.bytes);
    expect(parsed.getPageCount()).toBe(2);
    expect(parsed.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)).toBeUndefined();
    const annots = parsed.getPage(1).node.lookup(PDFName.of('Annots'), PDFArray);
    expect(annots.size()).toBe(1);
    const annotation = parsed.context.lookup(annots.get(0));
    expect(annotation?.toString()).toContain('/Subtype /Highlight');
    expect(annotation?.toString()).toContain('/QuadPoints');
    expect(annotation?.toString()).toContain('/Contents');

    await import('@pdfjs/pdf.min.mjs');
    const pdfjs = (globalThis as Record<string, unknown>)['pdfjsLib'] as {
      GlobalWorkerOptions: { workerSrc: string };
      getDocument: (input: { data: Uint8Array }) => {
        promise: Promise<{
          getPage: (page: number) => Promise<{
            getAnnotations: () => Promise<Array<{ subtype: string; contentsObj: { str: string } }>>;
          }>;
        }>;
        destroy: () => Promise<void>;
      };
    };
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      `file://${process.cwd()}/public/vendor/pdfjs/pdf.worker.min.mjs`,
    ).href;
    const loading = pdfjs.getDocument({ data: new Uint8Array(output.bytes) });
    try {
      const document = await loading.promise;
      const exported = await (await document.getPage(2)).getAnnotations();
      expect(exported).toMatchObject([
        { subtype: 'Highlight', contentsObj: { str: 'research comment' } },
      ]);
    } finally {
      await loading.destroy();
    }
  });
});
