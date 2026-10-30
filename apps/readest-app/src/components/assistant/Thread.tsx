'use client';

import { useEffect, useRef, useState, type FC } from 'react';
import {
  ActionBarPrimitive,
  AssistantIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAssistantState,
  useThreadViewport,
  useThread,
  useComposerRuntime,
  useMessagePartImage,
  useMessagePartReasoning,
} from '@assistant-ui/react';
import {
  ArrowUpIcon,
  BookOpenIcon,
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  FileTextIcon,
  GlobeIcon,
  NotebookPenIcon,
  PaperclipIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';

import { MarkdownText } from './MarkdownText';
import { ModelSwitcher } from './ModelSwitcher';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/utils/tailwind';
import type { SourceItem } from '@/services/ai/adapters/reedySourceStore';
import type { ComposerToggles } from '@/services/ai/adapters/TauriChatAdapter';

interface ThreadProps {
  sources?: SourceItem[];
  sourcesByMessageId?: Record<string, SourceItem[]>;
  isPdf?: boolean;
  /** Invoked when a source row is clicked. Reedy passes the CFI to the reader's goTo. */
  onSourceClick?: (source: SourceItem) => void;
  onClear?: () => void;
  onResetIndex?: () => void;
  isLoadingHistory?: boolean;
  hasActiveConversation?: boolean;
  /** Composer capability toggles (web search / notes / thinking). */
  toggles?: ComposerToggles;
  onToggle?: (key: keyof ComposerToggles) => void;
}

const LoadingOverlay: FC<{ isVisible: boolean }> = ({ isVisible }) => {
  return (
    <div
      className={cn(
        'absolute inset-0 z-20 flex items-center justify-center',
        'bg-base-100/60 backdrop-blur-xs',
        'transition-all duration-300 ease-out',
        isVisible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      <div className='bg-base-content/10 size-8 animate-pulse rounded-full' />
    </div>
  );
};

const ScrollToBottomButton: FC = () => {
  const isAtBottom = useThreadViewport((v) => v.isAtBottom);
  const lastMessageRole = useThread((t) => t.messages.at(-1)?.role);
  const isRunning = useThread((t) => t.isRunning);

  // Don't show button if last message is user with no AI response yet
  if (lastMessageRole === 'user' && !isRunning) return null;

  return (
    <ThreadPrimitive.ScrollToBottom
      className={cn(
        'absolute bottom-4 left-1/2 z-10',
        'flex items-center justify-center rounded-full p-2',
        'bg-base-300 text-base-content',
        'hover:bg-base-200',
        'border-base-content/10 border',
        'shadow-xs',
        'active:scale-[0.97]',
        'transition-[opacity,filter,transform] duration-150 ease-out',
        isAtBottom
          ? 'pointer-events-none -translate-x-1/2 scale-90 opacity-0 blur-xs'
          : '-translate-x-1/2 scale-100 opacity-100 blur-0',
      )}
      style={{
        animation: isAtBottom ? 'none' : 'subtleBounce 2.5s ease-in-out infinite',
      }}
      aria-hidden={isAtBottom}
      aria-label='Scroll to bottom'
    >
      <ChevronDownIcon className='size-4' />
      <style>{`
        @keyframes subtleBounce {
          0%, 100% { transform: translateX(-50%) translateY(0); }
          50% { transform: translateX(-50%) translateY(1px); }
        }
      `}</style>
    </ThreadPrimitive.ScrollToBottom>
  );
};

export const Thread: FC<ThreadProps> = ({
  sources = [],
  sourcesByMessageId = {},
  isPdf = false,
  onSourceClick,
  onClear,
  onResetIndex,
  isLoadingHistory = false,
  hasActiveConversation = false,
  toggles,
  onToggle,
}) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const isInitialMount = useRef(true);
  const messageCount = useThread((t) => t.messages.length);
  const lastMessageRole = useThread((t) => t.messages.at(-1)?.role);
  const isRunning = useThread((t) => t.isRunning);

  const showLoading = isLoadingHistory && hasActiveConversation;

  useEffect(() => {
    if (isInitialMount.current && messageCount > 0 && viewportRef.current) {
      isInitialMount.current = false;
      requestAnimationFrame(() => {
        const viewport = viewportRef.current;
        if (viewport) {
          viewport.scrollTop = viewport.scrollHeight;
        }
      });
    }
  }, [messageCount]);

  useEffect(() => {
    if (lastMessageRole === 'user' && viewportRef.current && !isInitialMount.current) {
      requestAnimationFrame(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;

        const messages = viewport.querySelectorAll('[data-message-role="user"]');
        const lastUserMessage = messages[messages.length - 1];
        if (lastUserMessage) {
          lastUserMessage.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
          });
        }
      });
    }
  }, [messageCount, lastMessageRole]);

  const getSpacerHeight = () => {
    if (lastMessageRole === 'user' && !isRunning) {
      return 'min-h-8';
    }
    if (isRunning) {
      return 'min-h-[50vh]';
    }
    if (lastMessageRole === 'assistant') {
      return 'min-h-4';
    }
    return 'min-h-4';
  };

  return (
    <ThreadPrimitive.Root className='bg-base-100 relative flex h-full w-full flex-col items-stretch px-3'>
      <LoadingOverlay isVisible={showLoading} />

      {!showLoading && (
        <ThreadPrimitive.Empty>
          <div className='animate-in fade-in flex h-full flex-col items-center justify-center duration-300'>
            <div className='bg-base-content/10 mb-4 rounded-full p-3'>
              <BookOpenIcon className='text-base-content size-6' />
            </div>
            <h3 className='text-base-content mb-1 text-sm font-medium'>Ask about this book</h3>
            <p className='text-base-content/60 mb-4 text-xs'>
              Get answers based on the book content
            </p>
            <Composer
              onClear={onClear}
              onResetIndex={onResetIndex}
              toggles={toggles}
              onToggle={onToggle}
            />
          </div>
        </ThreadPrimitive.Empty>
      )}

      <AssistantIf condition={(s) => s.thread.isEmpty === false}>
        <div
          className={cn(
            'relative min-h-0 flex-1 transition-opacity duration-300',
            showLoading ? 'opacity-0' : 'opacity-100',
          )}
        >
          <ThreadPrimitive.Viewport
            ref={viewportRef}
            autoScroll={false}
            className='absolute inset-0 flex flex-col overflow-y-auto scroll-smooth pt-2'
          >
            <ThreadPrimitive.Messages
              components={{
                UserMessage,
                EditComposer,
                AssistantMessage: () => (
                  <AssistantMessage
                    liveSources={sources}
                    sourcesByMessageId={sourcesByMessageId}
                    isPdf={isPdf}
                    onSourceClick={onSourceClick}
                  />
                ),
              }}
            />
            <p className='text-base-content/40 mx-auto w-full p-1 text-center text-[10px]'>
              AI can make mistakes. Verify with the book.
            </p>
            <div
              className={cn('shrink transition-all duration-300', getSpacerHeight())}
              aria-hidden='true'
            />
          </ThreadPrimitive.Viewport>

          <ScrollToBottomButton />
        </div>

        <Composer
          onClear={onClear}
          onResetIndex={onResetIndex}
          toggles={toggles}
          onToggle={onToggle}
        />
      </AssistantIf>
    </ThreadPrimitive.Root>
  );
};

interface ComposerProps {
  onClear?: () => void;
  onResetIndex?: () => void;
  toggles?: ComposerToggles;
  onToggle?: (key: keyof ComposerToggles) => void;
}

const MAX_IMAGE_DIMENSION = 1280;
const MAX_TEXT_ATTACHMENT_BYTES = 200_000;

function downscaleImage(file: File, maxDim = MAX_IMAGE_DIMENSION, quality = 0.85): Promise<File> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const finish = (result: File) => {
        URL.revokeObjectURL(url);
        resolve(result);
      };
      try {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        if (scale >= 1) return finish(file);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return finish(file);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            if (blob) {
              finish(new File([blob], file.name || 'pasted-image.png', { type: 'image/jpeg' }));
            } else {
              finish(file);
            }
          },
          'image/jpeg',
          quality,
        );
      } catch {
        finish(file);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };
    img.src = url;
  });
}

const AttachmentPreview: FC = () => {
  const attachment = useAssistantState((s) => s.attachment);
  const composer = useComposerRuntime();
  const _ = useTranslation();
  if (!attachment) return null;
  const previewUrl =
    attachment.type === 'image' && attachment.file
      ? URL.createObjectURL(attachment.file)
      : undefined;
  const removeAttachment = async () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const index = composer.getState().attachments.findIndex((a) => a.id === attachment.id);
    if (index >= 0) await composer.getAttachmentByIndex(index).remove();
  };
  return (
    <div className='border-base-content/10 bg-base-200 relative mr-1 inline-flex items-center gap-2 rounded-lg border px-2 py-1'>
      {previewUrl ? (
        <img src={previewUrl} alt={attachment.name} className='size-6 rounded object-cover' />
      ) : (
        <FileTextIcon className='size-3.5' />
      )}
      <span className='max-w-40 truncate text-xs'>{attachment.name}</span>
      <button
        type='button'
        aria-label={_('Remove attachment')}
        className='text-base-content/50 hover:text-base-content'
        onClick={() => void removeAttachment()}
      >
        <XIcon className='size-3' />
      </button>
    </div>
  );
};

const Composer: FC<ComposerProps> = ({ onClear, onResetIndex, toggles, onToggle }) => {
  const _ = useTranslation();
  const isEmpty = useAssistantState((s) => s.composer.isEmpty);
  const isRunning = useAssistantState((s) => s.thread.isRunning);
  const composer = useComposerRuntime();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  const addFile = async (file: File) => {
    setAttachmentError(null);
    try {
      if (file.type.startsWith('image/')) {
        await composer.addAttachment(await downscaleImage(file));
      } else if (
        file.type.startsWith('text/') ||
        /\.(md|markdown|txt|csv|json)$/i.test(file.name)
      ) {
        if (file.size > MAX_TEXT_ATTACHMENT_BYTES) {
          setAttachmentError(_('Text attachments are limited to 200 KB.'));
          return;
        }
        await composer.addAttachment(file);
      } else {
        setAttachmentError(_('Only images and text files can be attached.'));
      }
    } catch {
      setAttachmentError(_('Could not read the attachment.'));
    }
  };

  const onPaste = (event: React.ClipboardEvent) => {
    const files = Array.from(event.clipboardData.files);
    if (!files.length) return;
    event.preventDefault();
    void Promise.all(files.map((file) => addFile(file)));
  };

  const toggleButton = (key: keyof ComposerToggles, icon: React.ReactNode, label: string) => {
    const active = toggles?.[key] ?? false;
    return (
      <button
        type='button'
        onClick={() => onToggle?.(key)}
        title={label}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-full transition-colors',
          active
            ? 'bg-primary/15 text-primary'
            : 'text-base-content/60 hover:bg-base-300 hover:text-base-content',
        )}
      >
        {icon}
      </button>
    );
  };

  return (
    <ComposerPrimitive.Root
      className='group/composer animate-in fade-in slide-in-from-bottom-2 mx-auto mb-2 w-full duration-300'
      data-empty={isEmpty}
      data-running={isRunning}
    >
      <div
        className='bg-base-200 ring-base-content/10 focus-within:ring-base-content/20 overflow-hidden rounded-2xl shadow-xs ring-1 ring-inset transition-all duration-200'
        onPaste={onPaste}
      >
        <ComposerPrimitive.Attachments components={{ Attachment: AttachmentPreview }} />
        {/* Trilium-style: the message box owns the top row, the toolbar
            (model + context toggles left, attachments and send right) sits
            below it instead of crowding the input onto one line. */}
        <div className='px-3 pt-2'>
          <ComposerPrimitive.Input
            placeholder='Ask about this book...'
            rows={1}
            className='text-base-content placeholder:text-base-content/40 max-h-[200px] w-full resize-none bg-transparent py-1 text-sm leading-5 outline-hidden'
          />
        </div>
        <div className='flex items-center gap-0.5 p-1.5'>
          <ModelSwitcher />

          {toggleButton('webSearch', <GlobeIcon className='size-3.5' />, _('Web search'))}
          {toggleButton(
            'includeNotes',
            <NotebookPenIcon className='size-3.5' />,
            _('Read my notes'),
          )}
          {toggleButton('thinking', <BrainIcon className='size-3.5' />, _('Deep thinking'))}

          <div className='ms-auto flex items-center gap-0.5'>
            <input
              ref={fileInputRef}
              type='file'
              multiple
              accept='image/*,text/plain,text/markdown,text/csv,.md,.txt,.csv,.json'
              className='hidden'
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = '';
                void Promise.all(files.map((file) => addFile(file)));
              }}
            />
            <button
              type='button'
              onClick={() => fileInputRef.current?.click()}
              className='text-base-content/60 hover:bg-base-300 hover:text-base-content flex size-7 shrink-0 items-center justify-center rounded-full transition-colors'
              aria-label={_('Attach file')}
              title={_('Attach file')}
            >
              <PaperclipIcon className='size-3.5' />
            </button>

            {onClear && (
              <button
                type='button'
                onClick={onClear}
                className='text-base-content hover:bg-base-300 flex size-7 shrink-0 items-center justify-center rounded-full transition-colors'
                aria-label='Clear chat'
              >
                <Trash2Icon className='size-3.5' />
              </button>
            )}

            {onResetIndex && (
              <button
                type='button'
                onClick={onResetIndex}
                className='text-base-content hover:bg-base-300 flex size-7 shrink-0 items-center justify-center rounded-full transition-colors'
                title='Re-index book'
                aria-label='Re-index book'
              >
                <RefreshCwIcon className='size-3.5' />
              </button>
            )}

            <div className='bg-base-content text-base-100 relative size-7 shrink-0 rounded-full'>
              <ComposerPrimitive.Send className='absolute inset-0 flex items-center justify-center transition-all duration-300 ease-out group-data-[empty=true]/composer:scale-0 group-data-[running=true]/composer:scale-0 group-data-[empty=true]/composer:opacity-0 group-data-[running=true]/composer:opacity-0'>
                <ArrowUpIcon className='size-3.5' />
              </ComposerPrimitive.Send>

              <ComposerPrimitive.Cancel className='absolute inset-0 flex items-center justify-center transition-all duration-300 ease-out group-data-[running=false]/composer:scale-0 group-data-[running=false]/composer:opacity-0'>
                <SquareIcon className='size-3' fill='currentColor' />
              </ComposerPrimitive.Cancel>

              {/* Placeholder when empty and not running */}
              <div className='absolute inset-0 flex items-center justify-center transition-all duration-300 ease-out group-data-[empty=false]/composer:scale-0 group-data-[running=true]/composer:scale-0 group-data-[empty=false]/composer:opacity-0 group-data-[running=true]/composer:opacity-0'>
                <ArrowUpIcon className='size-3.5 opacity-40' />
              </div>
            </div>
          </div>
        </div>
        {attachmentError && (
          <p role='alert' className='text-error px-3 pb-1.5 text-xs'>
            {attachmentError}
          </p>
        )}
      </div>
    </ComposerPrimitive.Root>
  );
};

const MessageImage: FC = () => {
  const part = useMessagePartImage();
  return (
    <img
      src={part.image}
      alt={part.filename || 'Attached image'}
      className='border-base-content/10 my-1 max-h-72 max-w-full rounded-lg border object-contain'
    />
  );
};

// The local runtime keeps sent attachments on message.attachments instead of
// merging them into message.content, so the Parts Image renderer never sees
// them; render the attachment image parts here instead.
const UserAttachments: FC = () => {
  const attachments = useAssistantState((s) => s.message.attachments);
  const images = (attachments ?? [])
    .flatMap((attachment) => attachment.content ?? [])
    .filter(
      (part): part is { type: 'image'; image: string } =>
        part.type === 'image' && typeof (part as { image?: unknown }).image === 'string',
    );
  if (images.length === 0) return null;
  return (
    <>
      {images.map((part, index) => (
        <img
          key={index}
          src={part.image}
          alt=''
          className='border-base-content/10 mb-1 max-h-72 max-w-full rounded-lg border object-contain'
        />
      ))}
    </>
  );
};

const ReasoningText: FC = () => {
  const part = useMessagePartReasoning();
  const [open, setOpen] = useState(false);
  const _ = useTranslation();
  return (
    <div className='mb-1 w-full'>
      <button
        type='button'
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
        className='text-base-content/50 hover:text-base-content flex items-center gap-1 text-xs'
      >
        <ChevronRightIcon className={cn('size-3 transition-transform', open && 'rotate-90')} />
        {_('Thinking')}
      </button>
      {open && (
        <div className='text-base-content/60 mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap text-xs'>
          {part.text}
        </div>
      )}
    </div>
  );
};

interface AssistantMessageProps {
  liveSources: SourceItem[];
  sourcesByMessageId: Record<string, SourceItem[]>;
  isPdf: boolean;
  onSourceClick?: (source: SourceItem) => void;
}

const AssistantMessage: FC<AssistantMessageProps> = ({
  liveSources,
  sourcesByMessageId,
  isPdf,
  onSourceClick,
}) => {
  const messageId = useAssistantState((s) => s.message.id);
  const lastMessageId = useThread((t) => t.messages.at(-1)?.id);
  const sources = sourcesByMessageId[messageId] ?? (messageId === lastMessageId ? liveSources : []);
  return (
    <MessagePrimitive.Root className='group/message animate-in fade-in slide-in-from-bottom-1 relative mx-auto mb-1 flex w-full flex-col pb-0.5 duration-200'>
      <div className='flex flex-col items-start'>
        <div className='w-full max-w-none'>
          <div className='prose prose-xs text-base-content [&_*]:text-base-content! [&_a]:text-primary! [&_code]:text-base-content! select-text text-sm'>
            <MessagePrimitive.Parts
              components={{ Text: MarkdownText, Image: MessageImage, Reasoning: ReasoningText }}
            />
          </div>
        </div>

        <AssistantIf condition={(s) => s.message.status?.type !== 'running'}>
          <div className='animate-in fade-in mt-0.5 flex h-6 w-full items-center justify-start gap-0.5 duration-300'>
            <ActionBarPrimitive.Root className='-ml-1 flex items-center gap-0.5'>
              <BranchPicker />
              {sources.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type='button'
                      className='text-base-content/40 hover:bg-base-200 hover:text-base-content flex size-6 items-center justify-center rounded-full transition-colors'
                      aria-label='View sources'
                    >
                      <BookOpenIcon className='size-3' />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align='start'
                    className='bg-base-100 border-base-content/10 w-80 p-2'
                  >
                    <div className='text-base-content/60 mb-2 px-1 text-[11px] font-semibold'>
                      Sources from book
                    </div>
                    <div className='flex flex-col gap-1.5'>
                      {sources.map((source, i) => {
                        const clickable = !!onSourceClick && (!!source.cfi || isPdf);
                        const baseClass =
                          'border-base-content/10 bg-base-200/50 rounded-lg border px-2 py-1.5 text-[11px]';
                        const content = (
                          <>
                            <div className='text-base-content font-medium'>
                              {isPdf
                                ? `Page ${source.sectionIndex + 1}`
                                : source.chapterTitle || `Section ${source.sectionIndex + 1}`}
                            </div>
                            <div className='text-base-content/60 mt-0.5 line-clamp-3'>
                              {source.text}
                            </div>
                          </>
                        );
                        if (clickable) {
                          return (
                            <button
                              type='button'
                              key={source.id || i}
                              className={cn(
                                baseClass,
                                'hover:bg-base-200 text-start transition-colors',
                              )}
                              onClick={() => onSourceClick?.(source)}
                            >
                              {content}
                            </button>
                          );
                        }
                        return (
                          <div key={source.id || i} className={baseClass}>
                            {content}
                          </div>
                        );
                      })}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <ActionBarPrimitive.Reload className='text-base-content/40 hover:bg-base-200 hover:text-base-content flex size-6 items-center justify-center rounded-full transition-colors'>
                <RefreshCwIcon className='size-3' />
              </ActionBarPrimitive.Reload>
              <ActionBarPrimitive.Copy className='text-base-content/40 hover:bg-base-200 hover:text-base-content flex size-6 items-center justify-center rounded-full transition-colors'>
                <AssistantIf condition={({ message }) => message.isCopied}>
                  <CheckIcon className='size-3' />
                </AssistantIf>
                <AssistantIf condition={({ message }) => !message.isCopied}>
                  <CopyIcon className='size-3' />
                </AssistantIf>
              </ActionBarPrimitive.Copy>
            </ActionBarPrimitive.Root>
          </div>
        </AssistantIf>
      </div>
    </MessagePrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      className='group/message animate-in fade-in slide-in-from-bottom-1 relative mx-auto mb-1 flex w-full flex-col pb-0.5 duration-200'
      data-message-role='user'
    >
      <div className='flex flex-col items-end'>
        <div className='border-base-content/10 bg-base-200 text-base-content relative max-w-[90%] rounded-2xl rounded-br-md border px-3 py-2'>
          <UserAttachments />
          <div className='prose prose-xs text-base-content [&_*]:text-base-content! select-text text-sm'>
            <MessagePrimitive.Parts components={{ Text: MarkdownText, Image: MessageImage }} />
          </div>
        </div>
        <div className='mt-0.5 flex h-6 items-center justify-end gap-0.5'>
          <ActionBarPrimitive.Root className='flex items-center gap-0.5'>
            <ActionBarPrimitive.Edit className='text-base-content/40 hover:bg-base-200 hover:text-base-content flex size-6 items-center justify-center rounded-full transition-colors'>
              <PencilIcon className='size-3' />
            </ActionBarPrimitive.Edit>
            <ActionBarPrimitive.Copy className='text-base-content/40 hover:bg-base-200 hover:text-base-content flex size-6 items-center justify-center rounded-full transition-colors'>
              <AssistantIf condition={({ message }) => message.isCopied}>
                <CheckIcon className='size-3' />
              </AssistantIf>
              <AssistantIf condition={({ message }) => !message.isCopied}>
                <CopyIcon className='size-3' />
              </AssistantIf>
            </ActionBarPrimitive.Copy>
          </ActionBarPrimitive.Root>
        </div>
      </div>
    </MessagePrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root className='mx-auto flex w-full flex-col py-2'>
      <ComposerPrimitive.Root className='border-base-content/10 bg-base-200 ml-auto flex w-full max-w-[90%] flex-col overflow-hidden rounded-2xl border'>
        <ComposerPrimitive.Input className='text-base-content min-h-10 w-full resize-none bg-transparent p-3 text-sm outline-hidden' />
        <div className='mx-2 mb-2 flex items-center gap-1.5 self-end'>
          <ComposerPrimitive.Cancel asChild>
            <Button variant='ghost' size='sm' className='h-7 px-2 text-xs'>
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size='sm' className='h-7 px-2 text-xs'>
              Update
            </Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<{ className?: string }> = ({ className }) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn('text-base-content/40 mr-0.5 inline-flex items-center text-[10px]', className)}
    >
      <BranchPickerPrimitive.Previous asChild>
        <button
          type='button'
          className='hover:bg-base-200 hover:text-base-content flex size-6 items-center justify-center rounded-full transition-colors'
        >
          <ChevronLeftIcon className='size-3' />
        </button>
      </BranchPickerPrimitive.Previous>
      <span className='font-medium'>
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <button
          type='button'
          className='hover:bg-base-200 hover:text-base-content flex size-6 items-center justify-center rounded-full transition-colors'
        >
          <ChevronRightIcon className='size-3' />
        </button>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
