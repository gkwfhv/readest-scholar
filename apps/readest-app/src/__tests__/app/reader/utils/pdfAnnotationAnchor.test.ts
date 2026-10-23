import { describe, expect, test, vi } from 'vitest';
import {
  capturePdfAnnotationAnchor,
  isPdfAnnotationAnchor,
} from '@/app/reader/utils/pdfAnnotationAnchor';

function rect(left: number, top: number, right: number, bottom: number): DOMRect {
  return { left, top, right, bottom, width: right - left, height: bottom - top } as DOMRect;
}

function selection(
  pageBounds: DOMRect,
  selectionRects: DOMRect[],
): { range: Range; layer: HTMLElement } {
  document.querySelectorAll('.textLayer').forEach((element) => element.remove());
  const layer = document.createElement('div');
  layer.className = 'textLayer';
  const span = document.createElement('span');
  span.textContent = 'selected text';
  layer.append(span);
  document.body.append(layer);
  const range = document.createRange();
  range.selectNodeContents(span);
  vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue(pageBounds);
  Object.defineProperty(range, 'getClientRects', { value: () => selectionRects });
  return { range, layer };
}

describe('PDF annotation anchors', () => {
  test('the same visual selection survives a twofold zoom', () => {
    const first = selection(rect(20, 30, 220, 330), [rect(40, 60, 120, 75)]);
    const anchor = capturePdfAnnotationAnchor(4, first.range, 'pdf-cfi');
    first.layer.remove();
    const zoomed = selection(rect(20, 30, 420, 630), [rect(60, 90, 220, 120)]);
    expect(capturePdfAnnotationAnchor(4, zoomed.range, 'pdf-cfi')).toEqual(anchor);
    expect(anchor).toEqual({
      version: 1,
      pageIndex: 4,
      cfi: 'pdf-cfi',
      rects: [[0.1, 0.1, 0.5, 0.15]],
    });
    expect(isPdfAnnotationAnchor(anchor)).toBe(true);
  });

  test('keeps each text line and the page index for a rotated landscape viewport', () => {
    const { range } = selection(rect(100, 50, 500, 250), [
      rect(140, 70, 260, 90),
      rect(140, 100, 420, 120),
    ]);
    expect(capturePdfAnnotationAnchor(8, range, 'pdf-cfi')).toEqual({
      version: 1,
      pageIndex: 8,
      cfi: 'pdf-cfi',
      rects: [
        [0.1, 0.1, 0.4, 0.2],
        [0.1, 0.25, 0.8, 0.35],
      ],
    });
  });

  test('rejects a range outside the PDF text layer or an invalid stored anchor', () => {
    const outside = document.createElement('p');
    outside.textContent = 'text';
    document.body.append(outside);
    const range = document.createRange();
    range.selectNodeContents(outside);
    expect(capturePdfAnnotationAnchor(0, range, 'pdf-cfi')).toBeUndefined();
    expect(isPdfAnnotationAnchor({ version: 1, pageIndex: 0, rects: [[0, 0, 1.2, 1]] })).toBe(
      false,
    );
  });
});
