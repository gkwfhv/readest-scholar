import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { page } from 'vitest/browser';
import type { BooknoteGroup } from '@/types/book';
import '@/styles/globals.css';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, values?: Record<string, string | number>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? '')),
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: {} }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    systemUIVisible: false,
    statusBarHeight: 0,
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  }),
}));
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    acquireBackKeyInterception: vi.fn(),
    releaseBackKeyInterception: vi.fn(),
  }),
}));
vi.mock('@tauri-apps/plugin-haptics', () => ({ impactFeedback: vi.fn() }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: {} }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => ({ bookDoc: {} }) }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getViewSettings: () => undefined }),
}));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn() }));

const { default: ExportMarkdownDialog } = await import(
  '@/app/reader/components/annotator/ExportMarkdownDialog'
);

const groups: Record<string, BooknoteGroup> = {
  'page-2': {
    id: 1,
    href: 'page-2',
    label: 'Page 2',
    booknotes: [
      {
        id: 'synthetic-note',
        type: 'annotation',
        cfi: 'epubcfi(/6/4!/4/2)',
        page: 2,
        text: 'A selected two-column passage',
        note: 'Research note',
        style: 'highlight',
        color: 'yellow',
        createdAt: 1,
        updatedAt: 2,
      },
    ],
  },
};

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.removeAttribute('data-theme');
  localStorage.removeItem('i18nextLng');
});

describe('annotated PDF export layout', () => {
  it.each([
    [390, 'en-US', false],
    [390, 'ar', true],
    [1200, 'en-US', true],
  ])('keeps action and omission report inside the dialog at %ipx %s eink=%s', async (width, language, eink) => {
    await page.viewport(width, 844);
    localStorage.setItem('i18nextLng', language);
    document.documentElement.dataset['eink'] = String(eink);
    document.documentElement.dataset['theme'] = eink ? 'dark' : 'light';
    render(
      <ExportMarkdownDialog
        bookKey='book-1'
        isOpen
        bookHash='hash'
        bookTitle='Synthetic PDF'
        bookAuthor='Researcher'
        bookFormat='PDF'
        booknoteGroups={groups}
        onCancel={vi.fn()}
        onExport={vi.fn()}
        onExportPdf={vi.fn(async () => ({
          exported: 0,
          skipped: 1,
          omissions: [
            {
              id: 'legacy',
              page: 2,
              text: 'AnOlderAnnotationWithoutGeometry'.repeat(4),
              reason: 'missing-anchor' as const,
            },
          ],
        }))}
      />,
    );
    const button = screen.getByRole('button', { name: 'Export annotated PDF' });
    fireEvent.click(button);
    await expect.poll(() => document.querySelector('[role="status"]')).not.toBeNull();
    const box = document.querySelector('.modal-box') as HTMLElement;
    const report = document.querySelector('[role="status"]') as HTMLElement;
    const outer = box.getBoundingClientRect();
    for (const element of [button, report]) {
      const rect = element.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(outer.left - 1);
      expect(rect.right).toBeLessThanOrEqual(outer.right + 1);
    }
    expect(report.scrollWidth).toBeLessThanOrEqual(report.clientWidth + 1);
    expect(getComputedStyle(report).borderTopWidth).toBe(eink ? '1px' : '0px');
    button.scrollIntoView({ block: 'end' });
    await page.screenshot({
      path: `../../../.next/scholar-pdf-export-${width}-${language}-${eink}.png`,
    });
  });
});
