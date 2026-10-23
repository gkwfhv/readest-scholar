import type { BookNote } from '@/types/book';
import { isPdfAnnotationAnchor } from '@/app/reader/utils/pdfAnnotationAnchor';

export interface PdfPageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * PDF.js displays CropBox coordinates with the page's /Rotate applied. Map
 * fractions of that visual page back to unrotated PDF user space.
 */
export function visualPointToPdf(
  u: number,
  v: number,
  box: PdfPageBox,
  rotation: number,
): [number, number] {
  switch (((rotation % 360) + 360) % 360) {
    case 0:
      return [box.x + u * box.width, box.y + (1 - v) * box.height];
    case 90:
      return [box.x + v * box.width, box.y + u * box.height];
    case 180:
      return [box.x + (1 - u) * box.width, box.y + v * box.height];
    case 270:
      return [box.x + (1 - v) * box.width, box.y + (1 - u) * box.height];
    default:
      throw new Error('Unsupported PDF page rotation');
  }
}

export function visualRectToPdfQuad(
  rect: [number, number, number, number],
  box: PdfPageBox,
  rotation: number,
): number[] {
  const [x0, y0, x1, y1] = rect;
  // /QuadPoints is upper-left, upper-right, lower-left, lower-right in
  // reading orientation, even if these are different PDF-space axes.
  return [
    ...visualPointToPdf(x0, y0, box, rotation),
    ...visualPointToPdf(x1, y0, box, rotation),
    ...visualPointToPdf(x0, y1, box, rotation),
    ...visualPointToPdf(x1, y1, box, rotation),
  ];
}

export interface PdfAnnotationExportItem {
  note: BookNote;
  colorHex?: string;
}

export type PdfAnnotationOmissionReason =
  | 'unsupported-type'
  | 'unsupported-style'
  | 'missing-anchor'
  | 'stale-anchor'
  | 'invalid-page'
  | 'invalid-crop';

export interface PdfAnnotationOmission {
  id: string;
  page?: number;
  text?: string;
  reason: PdfAnnotationOmissionReason;
}

export interface PdfAnnotationExportResult {
  bytes: ArrayBuffer;
  exported: number;
  skipped: number;
  omissions: PdfAnnotationOmission[];
}

function pdfColor(hex?: string): [number, number, number] {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(hex ?? '');
  if (!match) return [1, 0.85, 0.2];
  const full = match[1]!.length === 3 ? [...match[1]!].map((c) => c + c).join('') : match[1]!;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** Append interoperable text-markup annotations to a copy of the PDF. */
export async function exportPdfAnnotations(
  source: ArrayBuffer,
  items: PdfAnnotationExportItem[],
): Promise<PdfAnnotationExportResult> {
  const { PDFArray, PDFDocument, PDFHexString, PDFName } = await import('pdf-lib');
  const pdf = await PDFDocument.load(source);
  const pages = pdf.getPages();
  let exported = 0;
  const omissions: PdfAnnotationOmission[] = [];
  for (const { note, colorHex } of items) {
    const anchor = note.pdfAnchor;
    const subtype =
      note.style === 'underline'
        ? 'Underline'
        : note.style === 'squiggly'
          ? 'Squiggly'
          : note.style === 'highlight'
            ? 'Highlight'
            : null;
    const skip = (reason: PdfAnnotationOmissionReason) => {
      omissions.push({ id: note.id, page: note.page, text: note.text || note.note, reason });
    };
    if (note.type !== 'annotation') {
      skip('unsupported-type');
      continue;
    }
    if (!subtype) {
      skip('unsupported-style');
      continue;
    }
    if (!isPdfAnnotationAnchor(anchor)) {
      skip('missing-anchor');
      continue;
    }
    if (anchor.cfi !== note.cfi) {
      skip('stale-anchor');
      continue;
    }
    if (anchor.pageIndex >= pages.length) {
      skip('invalid-page');
      continue;
    }
    const page = pages[anchor.pageIndex]!;
    const box = page.getCropBox();
    const rotation = page.getRotation().angle;
    if (box.width <= 0 || box.height <= 0 || rotation % 90 !== 0) {
      skip('invalid-crop');
      continue;
    }
    const quads = anchor.rects.flatMap((rect) => visualRectToPdfQuad(rect, box, rotation));
    const xs = quads.filter((_, i) => i % 2 === 0);
    const ys = quads.filter((_, i) => i % 2 === 1);
    const annotation = pdf.context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of(subtype),
      Rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      QuadPoints: quads,
      Contents: PDFHexString.fromText(note.note || note.text || ''),
      NM: PDFHexString.fromText(`readest-scholar:${note.id}`),
      C: pdfColor(colorHex),
      CA: 0.35,
      F: 4,
    });
    const key = PDFName.of('Annots');
    let annotations = page.node.lookupMaybe(key, PDFArray);
    if (!annotations) {
      const created = pdf.context.obj([]) as NonNullable<typeof annotations>;
      page.node.set(key, created);
      annotations = created;
    }
    annotations.push(pdf.context.register(annotation));
    exported++;
  }
  const saved = await pdf.save();
  return {
    bytes: new Uint8Array(saved).buffer,
    exported,
    skipped: omissions.length,
    omissions,
  };
}
