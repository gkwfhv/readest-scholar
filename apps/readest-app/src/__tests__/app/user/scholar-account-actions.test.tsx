import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasIAP: true } }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));

import AccountActions from '@/app/user/components/AccountActions';

const actions = {
  userPlan: 'plus' as const,
  iapAvailable: true,
  onLogout: vi.fn(),
  onResetPassword: vi.fn(),
  onUpdateEmail: vi.fn(),
  onConfirmDelete: vi.fn(),
  onConfirmDeleteAllBooks: vi.fn(),
  onRestorePurchase: vi.fn(),
  onManageSubscription: vi.fn(),
  onManageSync: vi.fn(),
};

afterEach(() => {
  cleanup();
  delete window.__READEST_SCHOLAR_RELEASE_BUNDLE;
});

describe('Scholar account actions', () => {
  it('keeps account and sync controls without upstream billing controls', () => {
    window.__READEST_SCHOLAR_RELEASE_BUNDLE = true;
    render(<AccountActions {...actions} />);

    expect(screen.getByRole('button', { name: 'Manage Sync' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign Out' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Restore Purchase' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Manage Subscription' })).toBeNull();
  });

  it('keeps billing controls in ordinary Readest', () => {
    render(<AccountActions {...actions} />);
    expect(screen.getByRole('button', { name: 'Restore Purchase' })).toBeTruthy();
  });
});
