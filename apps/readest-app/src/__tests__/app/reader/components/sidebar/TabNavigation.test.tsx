import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TabNavigation from '@/app/reader/components/sidebar/TabNavigation';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobile: false, hasRoundedWindow: false } }),
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: (selector: (s: { isIPhoneDuo: boolean }) => unknown) =>
    selector({ isIPhoneDuo: false }),
}));

afterEach(cleanup);

describe('sidebar TabNavigation', () => {
  it('renders only toc, annotations and bookmarks', () => {
    render(<TabNavigation activeTab='toc' onTabChange={vi.fn()} />);

    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'TOC' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Annotate' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bookmark' })).toBeTruthy();
  });

  it('no longer offers the chat/history tab', () => {
    render(<TabNavigation activeTab='toc' onTabChange={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Chat' })).toBeNull();
  });
});
