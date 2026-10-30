import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  sideBarBookKey: 'book-1',
  isNotebookVisible: false,
  toggleNotebook: vi.fn(),
  setSideBarBookKey: vi.fn(),
  setHoveredBookKey: vi.fn(),
}));

// Give the two sidebar glyphs distinguishable test ids so the test can assert
// which one the toggler picks for the open vs closed state.
vi.mock('react-icons/tb', () => ({
  TbLayoutSidebar: () => <span data-testid='icon-sidebar-outline' />,
  TbLayoutSidebarFilled: () => <span data-testid='icon-sidebar-filled' />,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobile: false } }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ setHoveredBookKey: h.setHoveredBookKey }),
}));
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({
    get sideBarBookKey() {
      return h.sideBarBookKey;
    },
    setSideBarBookKey: h.setSideBarBookKey,
  }),
}));
vi.mock('@/store/notebookStore', () => ({
  useNotebookStore: () => ({
    get isNotebookVisible() {
      return h.isNotebookVisible;
    },
    toggleNotebook: h.toggleNotebook,
  }),
}));

import NotebookToggler from '@/app/reader/components/NotebookToggler';

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  h.sideBarBookKey = 'book-1';
  h.isNotebookVisible = false;
});

describe('NotebookToggler', () => {
  it('is labelled Chat and shows the outline sidebar glyph when closed', () => {
    render(<NotebookToggler bookKey='book-1' />);

    expect(screen.getByRole('button', { name: 'Chat' })).toBeTruthy();
    expect(screen.getByTestId('icon-sidebar-outline')).toBeTruthy();
    expect(screen.queryByTestId('icon-sidebar-filled')).toBeNull();
  });

  it('shows the filled sidebar glyph when this book’s chat panel is open', () => {
    h.isNotebookVisible = true;
    render(<NotebookToggler bookKey='book-1' />);

    expect(screen.getByTestId('icon-sidebar-filled')).toBeTruthy();
    expect(screen.queryByTestId('icon-sidebar-outline')).toBeNull();
  });

  it('toggles the chat panel for the active book', () => {
    render(<NotebookToggler bookKey='book-1' />);

    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
    expect(h.toggleNotebook).toHaveBeenCalledOnce();
  });
});
