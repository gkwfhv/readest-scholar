/**
 * A PDF text selection is measured against its own page's text layer. Both
 * rectangles are in the same iframe viewport coordinate system, so zoom and
 * page rotation cancel out. The PDF exporter converts these visual fractions
 * back into PDF user space using that page's crop box and rotation.
 */
import type { PdfAnnotationAnchor } from '@/types/book';

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const rounded = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

export function isPdfAnnotationAnchor(value: unknown): value is PdfAnnotationAnchor {
  if (!value || typeof value !== 'object') return false;
  const anchor = value as Partial<PdfAnnotationAnchor>;
  return (
    anchor.version === 1 &&
    typeof anchor.cfi === 'string' &&
    anchor.cfi.length > 0 &&
    Number.isInteger(anchor.pageIndex) &&
    anchor.pageIndex! >= 0 &&
    Array.isArray(anchor.rects) &&
    anchor.rects.length > 0 &&
    anchor.rects.length <= 1000 &&
    anchor.rects.every(
      (rect) =>
        Array.isArray(rect) &&
        rect.length === 4 &&
        rect.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1) &&
        rect[0]! < rect[2]! &&
        rect[1]! < rect[3]!,
    )
  );
}

export function capturePdfAnnotationAnchor(
  pageIndex: number,
  range: Range,
  cfi: string,
): PdfAnnotationAnchor | undefined {
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || !cfi || range.collapsed) return undefined;
  const layer = range.startContainer.ownerDocument?.querySelector('.textLayer');
  if (!layer || !layer.contains(range.startContainer) || !layer.contains(range.endContainer)) {
    return undefined;
  }
  const bounds = layer.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return undefined;
  const rects: PdfAnnotationAnchor['rects'] = [];
  for (const rect of Array.from(range.getClientRects())) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    const x0 = rounded(clamp((rect.left - bounds.left) / bounds.width));
    const y0 = rounded(clamp((rect.top - bounds.top) / bounds.height));
    const x1 = rounded(clamp((rect.right - bounds.left) / bounds.width));
    const y1 = rounded(clamp((rect.bottom - bounds.top) / bounds.height));
    if (x1 > x0 && y1 > y0) rects.push([x0, y0, x1, y1]);
    if (rects.length === 1000) break;
  }
  return rects.length ? { version: 1, pageIndex, cfi, rects } : undefined;
}
