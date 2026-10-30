import clsx from 'clsx';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Crepe, CrepeFeature } from '@milkdown/crepe';
import { editorViewCtx, editorViewOptionsCtx } from '@milkdown/kit/core';
import { replaceAll } from '@milkdown/kit/utils';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
import 'katex/dist/katex.min.css';
import './MarkdownTextEditor.css';

interface MarkdownTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onSave?: () => void;
  onEscape?: () => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  spellCheck?: boolean;
  disabled?: boolean;
  autoResize?: boolean;
  ariaLabel?: string;
  onSelect?: (start: number, end: number) => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: (value: string) => void;
}

export interface MarkdownTextEditorRef {
  focus: () => void;
  blur: () => void;
  getValue: () => string;
  setValue: (value: string) => void;
  getElement: () => HTMLElement | null;
}

const MarkdownTextEditor = forwardRef<MarkdownTextEditorRef, MarkdownTextEditorProps>(
  (
    {
      value,
      onChange,
      onBlur,
      onSave,
      onEscape,
      placeholder,
      className,
      autoFocus = false,
      spellCheck = false,
      disabled = false,
      ariaLabel,
      onSelect,
      onCompositionStart,
      onCompositionEnd,
    },
    ref,
  ) => {
    const rootRef = useRef<HTMLDivElement>(null);
    const crepeRef = useRef<Crepe | null>(null);
    const readyRef = useRef(false);
    const lastEmittedRef = useRef(value);

    // Mount-once listeners read these so they always see the latest props.
    const cbRef = useRef({
      onChange,
      onBlur,
      onSave,
      onEscape,
      onSelect,
      onCompositionStart,
      onCompositionEnd,
    });
    const valueRef = useRef(value);
    useEffect(() => {
      cbRef.current = {
        onChange,
        onBlur,
        onSave,
        onEscape,
        onSelect,
        onCompositionStart,
        onCompositionEnd,
      };
      valueRef.current = value;
    });

    useImperativeHandle(ref, () => ({
      focus: () => {
        const crepe = crepeRef.current;
        if (!crepe || !readyRef.current) return;
        crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus());
      },
      blur: () => {
        const crepe = crepeRef.current;
        if (!crepe || !readyRef.current) return;
        crepe.editor.action((ctx) => ctx.get(editorViewCtx).dom.blur());
      },
      getValue: () => crepeRef.current?.getMarkdown() ?? '',
      setValue: (newValue: string) => {
        const crepe = crepeRef.current;
        if (!crepe || !readyRef.current) return;
        lastEmittedRef.current = newValue;
        crepe.editor.action(replaceAll(newValue));
      },
      getElement: () => rootRef.current,
    }));

    useEffect(() => {
      const root = rootRef.current;
      if (!root) return;

      const crepe = new Crepe({
        root,
        defaultValue: valueRef.current,
        features: { [CrepeFeature.TopBar]: false, [CrepeFeature.AI]: false },
        featureConfigs: {
          [CrepeFeature.Placeholder]: { text: placeholder ?? '', mode: 'doc' },
        },
      });
      crepeRef.current = crepe;

      // Read Aloud pauses while a note editor has focus: it checks
      // activeElement for data-note-editor, and activeElement is the
      // ProseMirror contenteditable, not the root we mount into.
      crepe.editor.config((ctx) => {
        ctx.update(editorViewOptionsCtx, (prev) => ({
          ...prev,
          attributes: {
            ...prev.attributes,
            'data-note-editor': '',
            role: 'textbox',
            dir: 'auto',
            spellcheck: spellCheck ? 'true' : 'false',
            ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
          },
        }));
      });

      crepe.on((listener) => {
        // markdownUpdated is debounced (~200ms) inside Milkdown; onBlur and
        // onSave flush pending content before notifying the parent.
        listener.markdownUpdated((_ctx, markdown) => {
          lastEmittedRef.current = markdown;
          cbRef.current.onChange(markdown);
        });
        listener.selectionUpdated((_ctx, selection) => {
          const report = cbRef.current.onSelect;
          if (!report || !readyRef.current) return;
          // Raw doc positions overapproximate the markdown offsets the store
          // expects; the store clamps them against the content length anyway.
          // No doc traversal here: during view initialization the state doc
          // is not guaranteed to be resolvable yet.
          report(selection.from, selection.to);
        });
      });

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          cbRef.current.onEscape?.();
          return;
        }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          // Capture phase runs before ProseMirror's own handlers, so the
          // save shortcut never inserts a line break.
          event.preventDefault();
          event.stopPropagation();
          cbRef.current.onSave?.();
        }
      };
      const onCompositionStartEvent = () => cbRef.current.onCompositionStart?.();
      const onCompositionEndEvent = () => {
        cbRef.current.onCompositionEnd?.(crepeRef.current?.getMarkdown() ?? '');
      };
      const flushPending = () => {
        const crepeInstance = crepeRef.current;
        if (!crepeInstance) return;
        const markdown = crepeInstance.getMarkdown();
        if (markdown !== lastEmittedRef.current) {
          lastEmittedRef.current = markdown;
          cbRef.current.onChange(markdown);
        }
      };
      const onFocusOut = (event: FocusEvent) => {
        if (event.relatedTarget && root.contains(event.relatedTarget as Node)) return;
        flushPending();
        cbRef.current.onBlur?.();
      };

      root.addEventListener('keydown', onKeyDown, true);
      root.addEventListener('compositionstart', onCompositionStartEvent);
      root.addEventListener('compositionend', onCompositionEndEvent);
      root.addEventListener('focusout', onFocusOut);

      void crepe.create().then(() => {
        readyRef.current = true;
        if (disabled) crepe.setReadonly(true);
        // Keep the caller's text-selection affordances on the ProseMirror DOM.
        crepe.editor.action((ctx) => ctx.get(editorViewCtx).dom.classList.add('select-text'));
        // The parent may have replaced the content while create() was in
        // flight (e.g. the notebook recovery choice).
        if (valueRef.current !== crepe.getMarkdown()) {
          crepe.editor.action(replaceAll(valueRef.current));
        }
        if (autoFocus) {
          crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus());
        }
      });

      return () => {
        readyRef.current = false;
        root.removeEventListener('keydown', onKeyDown, true);
        root.removeEventListener('compositionstart', onCompositionStartEvent);
        root.removeEventListener('compositionend', onCompositionEndEvent);
        root.removeEventListener('focusout', onFocusOut);
        void crepe.destroy();
        crepeRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Re-sync only genuine external replacements (rollback, recovery choice);
    // typing feedback loops are absorbed because the parent value already
    // equals lastEmittedRef.
    useEffect(() => {
      const crepe = crepeRef.current;
      if (!crepe || !readyRef.current) return;
      if (value !== lastEmittedRef.current && value !== crepe.getMarkdown()) {
        lastEmittedRef.current = value;
        crepe.editor.action(replaceAll(value));
      }
    }, [value]);

    return (
      <div
        ref={rootRef}
        className={clsx('markdown-text-editor', 'content font-size-sm', className)}
        data-note-editor=''
        dir='auto'
      />
    );
  },
);

MarkdownTextEditor.displayName = 'MarkdownTextEditor';

export default MarkdownTextEditor;
