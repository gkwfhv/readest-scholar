import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '@/services/reedy/ui/Composer';

afterEach(cleanup);

describe('Reedy selected-text draft', () => {
  it('prefills the composer without sending, and accepts a later action', () => {
    const onSend = vi.fn();
    const props = { isRunning: false, onSend, onAbort: vi.fn() };
    const { rerender } = render(
      <Composer {...props} draft={{ id: 'first', text: 'Explain the selected passage' }} />,
    );
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      'Explain the selected passage',
    );
    expect(onSend).not.toHaveBeenCalled();

    rerender(<Composer {...props} draft={{ id: 'second', text: 'Summarize the passage' }} />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      'Summarize the passage',
    );
    expect(onSend).not.toHaveBeenCalled();
  });
});
