import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PropsWithChildren, ReactNode } from 'react';

import SettingsDialog from '@/components/settings/SettingsDialog';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: () => 16 }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/components/command-palette', () => ({ useCommandPalette: () => ({ open: vi.fn() }) }));
vi.mock('@/components/Dialog', () => ({
  default: ({ header, children }: PropsWithChildren<{ header?: ReactNode }>) => (
    <div>
      {header}
      {children}
    </div>
  ),
}));
vi.mock('@/components/DialogMenu', () => ({
  default: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('@/components/Dropdown', () => ({
  default: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('@/components/settings/FontPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/LayoutPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/ThemePanel', () => ({ default: () => null }));
vi.mock('@/components/settings/ControlPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/LangPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/IntegrationsPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/MiscPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/AIPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/TTSPanel', () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('production AI settings', () => {
  it('keeps the AI assistant configuration reachable in a production Web build', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubEnv('NODE_ENV', 'production');
    render(<SettingsDialog bookKey='synthetic-pdf' />);

    expect(screen.getByTitle('AI Assistant')).toBeTruthy();
  });
});
