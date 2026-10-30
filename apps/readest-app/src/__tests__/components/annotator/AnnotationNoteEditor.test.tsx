import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

// The note editor is WYSIWYG Markdown (Milkdown/Crepe), which cannot mount in
// jsdom. Stand in with a plain textarea that wires the same props so the
// textbox-based assertions below keep exercising the real AnnotationNoteEditor.
vi.mock('@/components/MarkdownTextEditor', () => ({
  default: ({
    value,
    onChange,
    onSave,
    onEscape,
    placeholder,
    className,
    autoFocus,
  }: {
    value: string;
    onChange: (value: string) => void;
    onSave?: () => void;
    onEscape?: () => void;
    placeholder?: string;
    className?: string;
    autoFocus?: boolean;
  }) => (
    <textarea
      className={className}
      placeholder={placeholder}
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onEscape?.();
        else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSave?.();
      }}
    />
  ),
}));

const { default: AnnotationNoteEditor } = await import(
  '@/app/reader/components/annotator/AnnotationNoteEditor'
);

afterEach(cleanup);

describe('AnnotationNoteEditor', () => {
  it('opens focused and ready to type', () => {
    render(<AnnotationNoteEditor value='' onSave={vi.fn()} onCancel={vi.fn()} />);

    const editor = screen.getByRole('textbox');
    expect(document.activeElement).toBe(editor);
  });

  it('seeds the draft with the existing note text', () => {
    render(<AnnotationNoteEditor value='earlier thought' onSave={vi.fn()} onCancel={vi.fn()} />);

    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('earlier thought');
  });

  it('saves what was typed', () => {
    const onSave = vi.fn();
    render(<AnnotationNoteEditor value='' onSave={onSave} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'fresh thought' } });
    fireEvent.click(screen.getByText('Save'));

    expect(onSave).toHaveBeenCalledWith('fresh thought');
  });

  it('cancels from the button and from Escape', () => {
    const onCancel = vi.fn();
    render(<AnnotationNoteEditor value='' onSave={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('carries the shared note-editor test id so both surfaces are drivable', () => {
    render(<AnnotationNoteEditor value='' onSave={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByTestId('booknote-note-editor')).toBeTruthy();
  });
});
