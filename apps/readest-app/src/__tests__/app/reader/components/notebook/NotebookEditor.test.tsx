import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NotebookEditor from '@/app/reader/components/notebook/NotebookEditor';
import { useNotebookDocumentStore } from '@/store/notebookDocumentStore';
import { BookNote } from '@/types/book';

const flushNotebookDocument = vi.fn(async (_bookKey: string) => 'saved');
const handleOpenAnnotations = vi.fn();
const onDeleteExcerpt = vi.fn();
const defaultProps = {
  bookKey: 'book-view',
  handleOpenAnnotations,
  excerpts: [] as BookNote[],
  onDeleteExcerpt,
};
vi.mock('@/app/reader/hooks/useNotebookDocumentCoordinator', () => ({
  flushNotebookDocument: (bookKey: string) => flushNotebookDocument(bookKey),
}));

// The real editor is a Milkdown Crepe instance, which cannot be driven by
// fireEvent.change in jsdom. This stand-in replicates the old TextEditor
// contract so these tests keep exercising NotebookEditor's wiring.
vi.mock('@/components/MarkdownTextEditor', async () => {
  const React = await import('react');
  const { forwardRef, useEffect, useImperativeHandle, useRef } = React;
  interface MockEditorProps {
    value?: string;
    ariaLabel?: string;
    placeholder?: string;
    spellCheck?: boolean;
    className?: string;
    onChange?: (v: string) => void;
    onBlur?: () => void;
    onEscape?: () => void;
    onSave?: () => void;
    onSelect?: (s: number, e: number) => void;
    onCompositionStart?: () => void;
    onCompositionEnd?: (v: string) => void;
  }
  const MockEditor = forwardRef<unknown, MockEditorProps>((props, ref) => {
    const elRef = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
      if (elRef.current) elRef.current.value = props.value ?? '';
    }, [props.value]);
    useImperativeHandle(ref, () => ({
      focus: () => elRef.current?.focus(),
      blur: () => elRef.current?.blur(),
      getValue: () => elRef.current?.value ?? '',
      setValue: (v: string) => {
        if (elRef.current) elRef.current.value = v;
      },
      getElement: () => elRef.current,
    }));
    return (
      <textarea
        ref={elRef}
        aria-label={props.ariaLabel}
        placeholder={props.placeholder}
        dir='auto'
        spellCheck={Boolean(props.spellCheck)}
        className={`select-text ${props.className ?? ''}`}
        data-note-editor=''
        defaultValue={props.value}
        onChange={(e) => props.onChange?.(e.currentTarget.value)}
        onBlur={props.onBlur}
        onKeyDown={(e) => {
          if (e.key === 'Escape') props.onEscape?.();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            props.onSave?.();
          }
        }}
        onSelect={(e) =>
          props.onSelect?.(e.currentTarget.selectionStart, e.currentTarget.selectionEnd)
        }
        onCompositionStart={props.onCompositionStart}
        onCompositionEnd={(e) => props.onCompositionEnd?.(e.currentTarget.value)}
      />
    );
  });
  return { default: MockEditor };
});

describe('NotebookEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNotebookDocumentStore.getState().reset();
    useNotebookDocumentStore.getState().hydrate('book', '', null);
  });

  afterEach(cleanup);

  it('renders a selectable, spellchecked raw Markdown editor as the blank state', () => {
    render(<NotebookEditor {...defaultProps} />);

    const editor = screen.getByRole('textbox', { name: 'Notebook' });
    expect(editor.getAttribute('placeholder')).toBe('Start writing about this book…');
    expect(editor.getAttribute('dir')).toBe('auto');
    expect(editor.getAttribute('spellcheck')).toBe('true');
    expect(editor.classList.contains('select-text')).toBe(true);
    expect(screen.queryByText('No Notes')).toBeNull();
  });

  it('updates the isolated document session while typing', () => {
    render(<NotebookEditor {...defaultProps} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Notebook' }), {
      target: { value: '# Reading notes' },
    });

    expect(useNotebookDocumentStore.getState().sessions['book']).toMatchObject({
      content: '# Reading notes',
      status: 'dirty',
      revision: 1,
    });
  });

  it('waits until compositionend before validating IME input', () => {
    render(<NotebookEditor {...defaultProps} />);
    const editor = screen.getByRole('textbox', { name: 'Notebook' });

    fireEvent.compositionStart(editor);
    fireEvent.change(editor, { target: { value: '你' } });
    expect(useNotebookDocumentStore.getState().sessions['book']?.content).toBe('');

    fireEvent.compositionEnd(editor, { currentTarget: { value: '你' } });
    expect(useNotebookDocumentStore.getState().sessions['book']?.content).toBe('你');
  });

  it('flushes on the save shortcut and blur', () => {
    render(<NotebookEditor {...defaultProps} />);
    const editor = screen.getByRole('textbox', { name: 'Notebook' });

    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true });
    fireEvent.blur(editor);

    expect(flushNotebookDocument).toHaveBeenCalledTimes(2);
    expect(flushNotebookDocument).toHaveBeenCalledWith('book-view');
  });

  it('shows local durability status in a polite live region', () => {
    render(<NotebookEditor {...defaultProps} />);

    act(() => {
      useNotebookDocumentStore.getState().mutate('book', 'draft');
      useNotebookDocumentStore.getState().markSaving('book', 1);
    });
    expect(screen.getByRole('status').textContent).toBe('Saving…');

    act(() => {
      useNotebookDocumentStore.getState().markSaved('book', 1, 'draft', 100);
    });
    expect(screen.getByRole('status').textContent).toBe('Saved');
  });

  it('offers both recovery choices without overwriting either copy', () => {
    useNotebookDocumentStore.getState().reset();
    useNotebookDocumentStore.getState().hydrate('book', 'latest saved', 200, 'local draft');
    render(<NotebookEditor {...defaultProps} />);

    expect((screen.getByRole('textbox', { name: 'Notebook' }) as HTMLTextAreaElement).value).toBe(
      'latest saved',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Recover draft' }));

    expect(useNotebookDocumentStore.getState().sessions['book']).toMatchObject({
      content: 'local draft',
      status: 'dirty',
    });
  });

  it('shows excerpts above the editor and can delete them', () => {
    const excerpt: BookNote = {
      id: 'excerpt-1',
      type: 'excerpt',
      cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:5)',
      text: 'To be, or not to be',
      note: '',
      createdAt: 1000,
      updatedAt: 1000,
    };
    const onDeleteExcerpt = vi.fn();

    render(
      <NotebookEditor
        bookKey='book-view'
        handleOpenAnnotations={handleOpenAnnotations}
        excerpts={[excerpt]}
        onDeleteExcerpt={onDeleteExcerpt}
      />,
    );

    expect(screen.getByText('Excerpts')).toBeTruthy();
    expect(screen.getAllByText('To be, or not to be')).toHaveLength(2);
    expect(
      screen
        .getByRole('textbox', { name: 'Notebook' })
        .compareDocumentPosition(screen.getByText('Excerpts')) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();

    fireEvent.click(screen.getByText('To be, or not to be', { selector: 'summary span' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDeleteExcerpt).toHaveBeenCalledWith(excerpt);
  });
});
