import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { page } from 'vitest/browser';
import AnnotationPopup from '@/app/reader/components/annotator/AnnotationPopup';
import { annotationToolButtons } from '@/app/reader/components/annotator/AnnotationTools';
import '@/styles/globals.css';

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isAndroidApp: false } }),
}));
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    acquireBackKeyInterception: vi.fn(),
    releaseBackKeyInterception: vi.fn(),
  }),
}));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.removeAttribute('data-theme');
});

it.each([
  [390, 'ltr', false],
  [390, 'rtl', true],
  [1024, 'ltr', false],
])('keeps AI selection icons in the toolbar at %ipx %s eink=%s', async (width, dir, eink) => {
  await page.viewport(width, 700);
  document.documentElement.dataset['eink'] = String(eink);
  document.documentElement.dataset['theme'] = eink ? 'dark' : 'light';
  const actionTypes = ['ai-explain', 'ai-summarize', 'ai-translate'];
  const buttons = actionTypes.map((type) => {
    const def = annotationToolButtons.find((button) => button.type === type)!;
    return { tooltipText: def.label, Icon: def.Icon, onClick: vi.fn() };
  });
  render(
    <div style={{ position: 'relative', width: '100%', height: 250 }}>
      <AnnotationPopup
        bookKey='paper-1'
        dir={dir as 'ltr' | 'rtl'}
        isVertical={false}
        buttons={buttons}
        notes={[]}
        position={{ point: { x: 24, y: 95 }, dir: 'down' }}
        trianglePosition={{ point: { x: 150, y: 85 }, dir: 'down' }}
        highlightOptionsVisible={false}
        selectedStyle='highlight'
        selectedColor='yellow'
        popupWidth={Math.min(320, width - 48)}
        popupHeight={48}
        onHighlight={vi.fn()}
        onDismiss={vi.fn()}
      />
    </div>,
  );
  const toolbar = document.querySelector('.selection-buttons') as HTMLElement;
  const toolbarRect = toolbar.getBoundingClientRect();
  const controls = buttons.map((button) =>
    screen.getByRole('button', { name: button.tooltipText }),
  );
  expect(controls).toHaveLength(3);
  for (const control of controls) {
    const rect = control.getBoundingClientRect();
    expect(rect.top).toBeGreaterThanOrEqual(toolbarRect.top - 1);
    expect(rect.bottom).toBeLessThanOrEqual(toolbarRect.bottom + 1);
    expect(rect.left).toBeGreaterThanOrEqual(toolbarRect.left - 1);
    expect(rect.right).toBeLessThanOrEqual(toolbarRect.right + 1);
    const icon = control.querySelector('svg')!;
    expect(icon).not.toBeNull();
    const iconRect = icon.getBoundingClientRect();
    expect(
      Math.abs(iconRect.left + iconRect.width / 2 - (rect.left + rect.width / 2)),
    ).toBeLessThan(1);
  }
  await page.screenshot({
    path: '../../../.next/phase5-selected-text-toolbar-' + width + '-' + dir + '-' + eink + '.png',
  });
});
