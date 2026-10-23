import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ViewMenu from '@/app/library/components/ViewMenu';

const viewport = vi.hoisted(() => ({ wide: false }));

vi.mock('react-responsive', () => ({ useMediaQuery: () => viewport.wide }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  isScholarReleaseBundle: () => true,
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/utils/access', () => ({ getUserID: async () => null }));
vi.mock('@/services/sync/replicaSync', () => ({ getReplicaSync: () => null }));
vi.mock('@/utils/nav', () => ({ navigateToLibrary: vi.fn() }));

afterEach(() => {
  cleanup();
  viewport.wide = false;
});

describe('Scholar view menu', () => {
  it('offers the three-pane layout only when the available screen is wide', () => {
    const view = render(<ViewMenu />);
    expect(screen.queryByText('Research Library')).toBeNull();

    viewport.wide = true;
    view.rerender(<ViewMenu />);
    expect(screen.getByText('Research Library')).toBeTruthy();
  });
});
