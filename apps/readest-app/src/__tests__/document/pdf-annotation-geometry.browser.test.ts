import { afterEach, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { makePDF } from 'foliate-js/pdf.js';
import { capturePdfAnnotationAnchor } from '@/app/reader/utils/pdfAnnotationAnchor';

type PdfBook = {
  sections: Array<{
    load: () => Promise<{
      src: string;
      onZoom: (options: { doc: Document; scale: number }) => Promise<void>;
    }>;
  }>;
  destroy: () => void;
};

let book: PdfBook | undefined;
const frames: HTMLIFrameElement[] = [];

afterEach(() => {
  for (const frame of frames) frame.remove();
  frames.length = 0;
  book?.destroy();
  book = undefined;
});

async function makeTwoColumnPaper(): Promise<PdfBook> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const rotation of [0, 90, 180, 270]) {
    const sheet = pdf.addPage([612, 792]);
    sheet.setRotation(degrees(rotation));
    sheet.drawText('LEFT COLUMN ALPHA', { x: 55, y: 690, size: 16, font });
    sheet.drawText('RIGHT COLUMN BETA', { x: 340, y: 690, size: 16, font });
  }
  const bytes = await pdf.save();
  return (await makePDF(
    new File([new Uint8Array(bytes)], 'two-columns.pdf', {
      type: 'application/pdf',
    }),
  )) as unknown as PdfBook;
}

async function openPage(index: number, scale: number) {
  const loaded = await book!.sections[index]!.load();
  const frame = document.createElement('iframe');
  frame.style.cssText = 'display:block;border:0;width:1300px;height:1700px';
  frames.push(frame);
  document.body.append(frame);
  await new Promise<void>((resolve, reject) => {
    frame.onload = () => resolve();
    frame.onerror = () => reject(new Error('PDF page iframe did not load'));
    frame.src = loaded.src;
  });
  const doc = frame.contentDocument!;
  await loaded.onZoom({ doc, scale });
  const layer = doc.querySelector('.textLayer')!;
  expect(layer.getBoundingClientRect().width).toBeGreaterThan(0);
  return { frame, doc, layer, loaded };
}

function anchorFor(doc: Document, phrase: string, index: number) {
  const span = [...doc.querySelectorAll('.textLayer span')].find((node) =>
    node.textContent?.includes(phrase),
  );
  expect(span).toBeTruthy();
  const range = doc.createRange();
  range.selectNodeContents(span!);
  const anchor = capturePdfAnnotationAnchor(index, range, `pdf-cfi-${index}-${phrase}`);
  expect(anchor).toBeTruthy();
  return anchor!;
}

function darkInkInAnchor(
  doc: Document,
  anchor: NonNullable<ReturnType<typeof capturePdfAnnotationAnchor>>,
) {
  const canvas = doc.querySelector('#canvas canvas') as HTMLCanvasElement;
  const context = canvas.getContext('2d')!;
  let dark = 0;
  for (const [x0, y0, x1, y1] of anchor.rects) {
    const left = Math.floor(x0 * canvas.width);
    const top = Math.floor(y0 * canvas.height);
    const width = Math.max(1, Math.ceil((x1 - x0) * canvas.width));
    const height = Math.max(1, Math.ceil((y1 - y0) * canvas.height));
    const pixels = context.getImageData(left, top, width, height);
    for (let y = 0; y < height; y += 3) {
      for (let x = 0; x < width; x += 3) {
        const i = (y * width + x) * 4;
        if (pixels.data[i]! < 180 && pixels.data[i + 1]! < 180 && pixels.data[i + 3]! > 128) dark++;
      }
    }
  }
  return dark;
}

describe('PDF visual annotation baseline', () => {
  it('keeps two-column text anchors stable at 2x zoom and inside a rotated page', async () => {
    book = await makeTwoColumnPaper();
    const normal = await openPage(0, 1);
    const left = anchorFor(normal.doc, 'LEFT COLUMN ALPHA', 0);
    const right = anchorFor(normal.doc, 'RIGHT COLUMN BETA', 0);
    expect(left.rects[0]![0]).toBeLessThan(0.5);
    expect(right.rects[0]![0]).toBeGreaterThan(0.5);
    expect(left.rects[0]![2]).toBeLessThan(right.rects[0]![0]);

    await normal.loaded.onZoom({ doc: normal.doc, scale: 2 });
    const zoomedLeft = anchorFor(normal.doc, 'LEFT COLUMN ALPHA', 0);
    const zoomedRight = anchorFor(normal.doc, 'RIGHT COLUMN BETA', 0);
    for (const [before, after] of [
      [left, zoomedLeft],
      [right, zoomedRight],
    ] as const) {
      for (let i = 0; i < 4; i++) {
        expect(after.rects[0]![i]).toBeCloseTo(before.rects[0]![i]!, 2);
      }
    }

    expect(darkInkInAnchor(normal.doc, zoomedLeft)).toBeGreaterThan(10);
    expect(darkInkInAnchor(normal.doc, zoomedRight)).toBeGreaterThan(10);

    for (const index of [1, 2, 3]) {
      const rotated = await openPage(index, 1);
      const rotatedLeft = anchorFor(rotated.doc, 'LEFT COLUMN ALPHA', index);
      expect(rotatedLeft.pageIndex).toBe(index);
      expect(rotatedLeft.rects[0]!.every((value) => value >= 0 && value <= 1)).toBe(true);
      expect(darkInkInAnchor(rotated.doc, rotatedLeft)).toBeGreaterThan(10);
    }
  }, 30000);
});
