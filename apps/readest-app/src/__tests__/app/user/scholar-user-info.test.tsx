import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UserInfo from '@/app/user/components/UserInfo';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));

const props = {
  userFullName: 'Scholar Tester',
  userEmail: 'tester@example.invalid',
  planDetails: { name: 'Free plan', color: 'bg-base-200' } as never,
};

afterEach(() => {
  cleanup();
  delete window.__READEST_SCHOLAR_RELEASE_BUNDLE;
});

describe('Scholar profile identity', () => {
  it('shows the account without an upstream billing tier', () => {
    window.__READEST_SCHOLAR_RELEASE_BUNDLE = true;
    render(<UserInfo {...props} />);
    expect(screen.getByText('Scholar Tester')).toBeTruthy();
    expect(screen.queryByText('Free plan')).toBeNull();
  });

  it('keeps the billing tier in ordinary Readest', () => {
    render(<UserInfo {...props} />);
    expect(screen.getByText('Free plan')).toBeTruthy();
  });
});
