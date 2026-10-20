import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';

import { Thread } from '@/components/assistant/Thread';

const messageContext = vi.hoisted(() => ({ id: 'answer-1' }));

vi.mock('@assistant-ui/react', () => {
  const Container = ({ children }: PropsWithChildren) => <div>{children}</div>;
  const MessageRoot = ({ children }: PropsWithChildren) => (
    <div data-testid={`message-${messageContext.id}`}>{children}</div>
  );
  const MockMessage = ({ id, Component }: { id: string; Component: React.ComponentType }) => {
    messageContext.id = id;
    return <Component />;
  };
  return {
    ThreadPrimitive: {
      Root: Container,
      Empty: () => null,
      Viewport: Container,
      ScrollToBottom: Container,
      Messages: ({ components }: { components: { AssistantMessage: React.ComponentType } }) => (
        <>
          <MockMessage id='answer-1' Component={components.AssistantMessage} />
          <MockMessage id='answer-2' Component={components.AssistantMessage} />
        </>
      ),
    },
    MessagePrimitive: { Root: MessageRoot, Parts: Container },
    ActionBarPrimitive: new Proxy({}, { get: () => Container }),
    BranchPickerPrimitive: new Proxy({}, { get: () => Container }),
    ComposerPrimitive: {
      Root: Container,
      Input: ({ placeholder }: { placeholder: string }) => <textarea placeholder={placeholder} />,
      Send: Container,
      Cancel: Container,
    },
    AssistantIf: Container,
    useThread: (select: (state: unknown) => unknown) =>
      select({
        messages: [
          { id: 'answer-1', role: 'assistant' },
          { id: 'answer-2', role: 'assistant' },
        ],
        isRunning: false,
        isEmpty: false,
      }),
    useThreadViewport: (select: (state: unknown) => unknown) => select({ isAtBottom: true }),
    useAssistantState: (select: (state: unknown) => unknown) =>
      select({
        composer: { isEmpty: true },
        thread: { isRunning: false },
        message: { id: messageContext.id, status: { type: 'complete' } },
      }),
  };
});

vi.mock('@/components/ui/dropdown-menu', () => {
  const Container = ({ children }: PropsWithChildren) => <div>{children}</div>;
  return {
    DropdownMenu: Container,
    DropdownMenuTrigger: Container,
    DropdownMenuContent: Container,
  };
});

afterEach(cleanup);

const pageTwo = {
  id: 'page-2',
  sectionIndex: 1,
  chapterTitle: null,
  text: 'Evidence on PDF page two',
  cfi: '',
};

describe('AI sources in a PDF thread', () => {
  it('makes a legacy PDF page source clickable', () => {
    const onSourceClick = vi.fn();
    render(
      <Thread sources={[pageTwo]} isPdf onSourceClick={onSourceClick} hasActiveConversation />,
    );

    expect(within(screen.getByTestId('message-answer-1')).queryByText(pageTwo.text)).toBeNull();
    expect(within(screen.getByTestId('message-answer-2')).getByText(pageTwo.text)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Page 2.*Evidence on PDF page two/ }));
    expect(onSourceClick).toHaveBeenCalledWith(pageTwo);
  });

  it('shows each saved source only under its own answer', () => {
    render(
      <Thread
        sourcesByMessageId={{
          'answer-1': [{ ...pageTwo, id: 'first', text: 'First answer evidence' }],
          'answer-2': [{ ...pageTwo, id: 'second', text: 'Second answer evidence' }],
        }}
        isPdf
        hasActiveConversation
      />,
    );

    const first = within(screen.getByTestId('message-answer-1'));
    const second = within(screen.getByTestId('message-answer-2'));
    expect(first.getByText('First answer evidence')).toBeTruthy();
    expect(first.queryByText('Second answer evidence')).toBeNull();
    expect(second.getByText('Second answer evidence')).toBeTruthy();
    expect(second.queryByText('First answer evidence')).toBeNull();
  });
});
