/**
 * AboutWindow — the version label doubles as a copy-to-clipboard control.
 *
 * On mobile there is no way to select the version string to paste it into a
 * bug report (issue #5285), so tapping the label copies it. The label must
 * keep its plain-text look: no button chrome, same classes as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const {
  mockWriteTextToClipboard,
  mockDispatch,
  mockIsTauriAppPlatform,
  mockInvoke,
  mockHasUpdater,
  mockIsScholarTestBundle,
  mockIsScholarReleaseBundle,
  mockCheckForAppUpdates,
  mockCheckAppReleaseNotes,
} = vi.hoisted(() => ({
  mockWriteTextToClipboard: vi.fn(async () => true),
  mockDispatch: vi.fn(),
  mockIsTauriAppPlatform: vi.fn(() => false),
  mockInvoke: vi.fn(),
  mockHasUpdater: vi.fn(() => true),
  mockIsScholarTestBundle: vi.fn(() => false),
  mockIsScholarReleaseBundle: vi.fn(() => false),
  mockCheckForAppUpdates: vi.fn(),
  mockCheckAppReleaseNotes: vi.fn(),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, params?: Record<string, unknown>) =>
    params ? s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(params[k] ?? '')) : s,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasUpdater: mockHasUpdater() } }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { updateChannel: 'stable' } }),
}));

vi.mock('@/helpers/updater', () => ({
  checkForAppUpdates: mockCheckForAppUpdates,
  checkAppReleaseNotes: mockCheckAppReleaseNotes,
}));

vi.mock('@/utils/ua', () => ({
  parseWebViewInfo: () => 'Chrome 148',
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => mockIsTauriAppPlatform(),
  isScholarTestBundle: () => mockIsScholarTestBundle(),
  isScholarReleaseBundle: () => mockIsScholarReleaseBundle(),
  getAppDisplayName: () => (mockIsScholarReleaseBundle() ? 'Readest Scholar' : 'Readest'),
  getAboutAppLabel: (label: string) =>
    label.replace('Readest', mockIsScholarReleaseBundle() ? 'Readest Scholar' : 'Readest'),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock('@/utils/version', () => ({
  getAppVersion: () => '0.11.20',
}));

vi.mock('@/utils/clipboard', () => ({
  writeTextToClipboard: mockWriteTextToClipboard,
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch: mockDispatch, on: vi.fn(), off: vi.fn() },
}));

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span>{alt}</span>,
}));

vi.mock('@/components/SupportLinks', () => ({
  default: () => <a href='https://github.com/readest/readest'>Readest Support</a>,
}));
vi.mock('@/components/LegalLinks', () => ({
  default: () => (
    <>
      <a href='https://readest.com/terms-of-service'>Terms of Service</a>
      <a href='https://readest.com/privacy-policy'>Privacy Policy</a>
    </>
  ),
}));
vi.mock('@/components/Link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/components/Dialog', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { AboutWindow, setAboutDialogVisible } from '@/components/AboutWindow';

const openDialog = async () => {
  render(
    <>
      <div id='about_window' />
      <AboutWindow />
    </>,
  );
  setAboutDialogVisible(true);
  return screen.findByText(/Version 0\.11\.20/);
};

describe('AboutWindow version label', () => {
  beforeEach(() => {
    mockWriteTextToClipboard.mockClear();
    mockDispatch.mockClear();
    mockIsTauriAppPlatform.mockReturnValue(false);
    mockInvoke.mockReset();
    mockHasUpdater.mockReturnValue(true);
    mockIsScholarTestBundle.mockReturnValue(false);
    mockIsScholarReleaseBundle.mockReturnValue(false);
    mockCheckForAppUpdates.mockReset();
    mockCheckAppReleaseNotes.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('copies the version and webview info when clicked', async () => {
    const label = await openDialog();

    fireEvent.click(label);

    await waitFor(() => expect(mockWriteTextToClipboard).toHaveBeenCalledTimes(1));
    expect(mockWriteTextToClipboard).toHaveBeenCalledWith('Readest 0.11.20 (Chrome 148)');
  });

  it('upgrades the label with the native webview version when available', async () => {
    mockIsTauriAppPlatform.mockReturnValue(true);
    mockInvoke.mockResolvedValue({ engine: 'WebView2', version: '152.0.4191.66' });
    await openDialog();

    const label = await screen.findByText(/WebView2 152\.0\.4191\.66/);
    fireEvent.click(label);

    await waitFor(() => expect(mockWriteTextToClipboard).toHaveBeenCalledTimes(1));
    expect(mockWriteTextToClipboard).toHaveBeenCalledWith(
      'Readest 0.11.20 (WebView2 152.0.4191.66)',
    );
  });

  it('keeps the UA-derived label when the native query fails', async () => {
    mockIsTauriAppPlatform.mockReturnValue(true);
    mockInvoke.mockRejectedValue(new Error('not allowed'));
    await openDialog();

    const label = await screen.findByText(/Chrome 148/);
    fireEvent.click(label);

    await waitFor(() => expect(mockWriteTextToClipboard).toHaveBeenCalledTimes(1));
    expect(mockWriteTextToClipboard).toHaveBeenCalledWith('Readest 0.11.20 (Chrome 148)');
  });

  it('shows a toast confirming the copy', async () => {
    const label = await openDialog();

    fireEvent.click(label);

    await waitFor(() =>
      expect(mockDispatch).toHaveBeenCalledWith(
        'toast',
        expect.objectContaining({ message: 'Copied to clipboard' }),
      ),
    );
  });

  it('keeps the plain-text look of the label', async () => {
    const label = await openDialog();

    // Same typography classes as the non-clickable label it replaces, and no
    // daisyUI button chrome that would change how it renders.
    expect(label.className).toContain('text-neutral-content');
    expect(label.className).toContain('text-center');
    expect(label.className).toContain('text-sm');
    expect(label.className).not.toContain('btn');
  });

  it('exposes the label as an accessible control', async () => {
    const label = await openDialog();

    expect(label.tagName).toBe('BUTTON');
    expect(label.getAttribute('title')).toBe('Copy');
  });

  it('labels the release notes action accurately when the updater is disabled', async () => {
    mockHasUpdater.mockReturnValue(false);
    mockCheckAppReleaseNotes.mockResolvedValue(false);
    await openDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Changelog' }));

    await waitFor(() => expect(mockCheckAppReleaseNotes).toHaveBeenCalledWith(false));
    expect(mockCheckForAppUpdates).not.toHaveBeenCalled();
  });

  it('does not offer upstream release notes in a Scholar test bundle', async () => {
    mockHasUpdater.mockReturnValue(false);
    mockIsScholarTestBundle.mockReturnValue(true);
    await openDialog();

    expect(screen.queryByRole('button', { name: 'Changelog' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check Update' })).toBeNull();
  });

  it('names the formal Scholar bundle and hides upstream updates', async () => {
    mockHasUpdater.mockReturnValue(false);
    mockIsScholarReleaseBundle.mockReturnValue(true);
    await openDialog();

    expect(screen.getByRole('heading', { name: 'Readest Scholar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Changelog' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check Update' })).toBeNull();
    expect(screen.getByRole('link', { name: 'GitHub' }).getAttribute('href')).toBe(
      'https://github.com/gkwfhv/readest-scholar',
    );
    expect(screen.queryByRole('link', { name: 'Privacy Policy' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Terms of Service' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Readest Support' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Version 0\.11\.20/ }));
    await waitFor(() =>
      expect(mockWriteTextToClipboard).toHaveBeenCalledWith('Readest Scholar 0.11.20 (Chrome 148)'),
    );
  });
});
