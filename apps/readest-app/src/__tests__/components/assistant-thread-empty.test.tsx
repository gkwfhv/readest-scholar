import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';

import { Thread } from '@/components/assistant/Thread';

vi.mock('@/components/assistant/ModelSwitcher', () => ({
  ModelSwitcher: () => null,
}));

vi.mock('@assistant-ui/react', () => {
  const Container = ({ children }: PropsWithChildren) => <div>{children}</div>;
  return {
    ThreadPrimitive: { Root: Container, Empty: Container },
    ComposerPrimitive: {
      Root: Container,
      Input: ({ placeholder }: { placeholder: string }) => <textarea placeholder={placeholder} />,
      Send: Container,
      Cancel: Container,
      Attachments: () => null,
    },
    AssistantIf: () => null,
    useComposerRuntime: () => ({
      addAttachment: vi.fn(),
      getState: () => ({ attachments: [] }),
      getAttachmentByIndex: () => ({ remove: vi.fn(async () => {}) }),
    }),
    useThread: (select: (state: { messages: never[]; isRunning: boolean }) => unknown) =>
      select({ messages: [], isRunning: false }),
    useAssistantState: (
      select: (state: {
        composer: { isEmpty: boolean };
        thread: { isRunning: boolean };
        attachment: undefined;
      }) => unknown,
    ) =>
      select({ composer: { isEmpty: true }, thread: { isRunning: false }, attachment: undefined }),
  };
});

afterEach(cleanup);

describe('empty AI conversation', () => {
  it('shows the composer for an active conversation with no messages', () => {
    render(<Thread hasActiveConversation />);

    expect(screen.getByText('Ask about this book')).toBeTruthy();
    expect(screen.getByPlaceholderText('Ask about this book...')).toBeTruthy();
  });

  it('waits for active conversation history before showing the composer', () => {
    render(<Thread hasActiveConversation isLoadingHistory />);

    expect(screen.queryByText('Ask about this book')).toBeNull();
    expect(screen.queryByPlaceholderText('Ask about this book...')).toBeNull();
  });
});
