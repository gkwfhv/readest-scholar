import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ openUrl: vi.fn(() => Promise.resolve()) }));

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: mocks.openUrl }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));

const { openExternalLink } = await import('@/utils/open');

const makeEvent = () => ({ preventDefault: vi.fn(), stopPropagation: vi.fn() });

beforeEach(() => vi.clearAllMocks());

describe('openExternalLink', () => {
  it('opens http(s) and mailto links in the system browser and stops navigation', () => {
    const event = makeEvent();
    openExternalLink(event, 'https://example.com/paper');
    expect(mocks.openUrl).toHaveBeenCalledWith('https://example.com/paper');
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);

    const mail = makeEvent();
    openExternalLink(mail, 'mailto:someone@example.com');
    expect(mocks.openUrl).toHaveBeenCalledWith('mailto:someone@example.com');
  });

  it('leaves relative and anchor links to the default handler', () => {
    for (const href of ['/reader/abc', '#section', '', null, undefined]) {
      const event = makeEvent();
      openExternalLink(event, href);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });
});
