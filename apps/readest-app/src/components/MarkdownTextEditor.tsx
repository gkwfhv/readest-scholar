import clsx from 'clsx';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { useTranslation as useI18next } from 'react-i18next';
import {
  TbCode,
  TbH1,
  TbH2,
  TbH3,
  TbH4,
  TbH5,
  TbH6,
  TbLetterT,
  TbList,
  TbListCheck,
  TbListNumbers,
  TbMathFunction,
  TbPhoto,
  TbQuote,
  TbSeparatorHorizontal,
  TbTable,
} from 'react-icons/tb';
import type { IconType } from 'react-icons';
import { Crepe, CrepeFeature } from '@milkdown/crepe';
import type { Ctx } from '@milkdown/kit/ctx';
import { commandsCtx, editorViewCtx, editorViewOptionsCtx } from '@milkdown/kit/core';
import {
  addBlockTypeCommand,
  blockquoteSchema,
  bulletListSchema,
  codeBlockSchema,
  headingSchema,
  hrSchema,
  listItemSchema,
  orderedListSchema,
  paragraphSchema,
  selectTextNearPosCommand,
  setBlockTypeCommand,
  wrapInBlockTypeCommand,
} from '@milkdown/kit/preset/commonmark';
import { createTable } from '@milkdown/kit/preset/gfm';
import { imageBlockSchema } from '@milkdown/kit/component/image-block';
import { replaceAll } from '@milkdown/kit/utils';
import { useTranslation } from '@/hooks/useTranslation';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
import 'katex/dist/katex.min.css';
import './MarkdownTextEditor.css';

// Each toolbar button dispatches the same Milkdown command Crepe's own slash
// menu used, minus the slash-specific "clear the typed /filter text" step — a
// toolbar click has no trigger text to clear, so it must preserve the block's
// content and only change its type / insert a node.
interface ToolbarItem {
  labelKey: string;
  Icon: IconType;
  run: (ctx: Ctx) => void;
}

const call = (ctx: Ctx, command: { key: unknown }, payload?: unknown) =>
  ctx.get(commandsCtx).call(command.key as never, payload as never);

const HEADING_ICONS: IconType[] = [TbH1, TbH2, TbH3, TbH4, TbH5, TbH6];

const TOOLBAR: ToolbarItem[] = [
  {
    labelKey: 'Text',
    Icon: TbLetterT,
    run: (ctx) => call(ctx, setBlockTypeCommand, { nodeType: paragraphSchema.type(ctx) }),
  },
  ...HEADING_ICONS.map((Icon, index): ToolbarItem => {
    const level = index + 1;
    return {
      labelKey: `Heading ${level}`,
      Icon,
      run: (ctx) =>
        call(ctx, setBlockTypeCommand, {
          nodeType: headingSchema.type(ctx),
          attrs: { level },
        }),
    };
  }),
  {
    labelKey: 'Quote',
    Icon: TbQuote,
    run: (ctx) => call(ctx, wrapInBlockTypeCommand, { nodeType: blockquoteSchema.type(ctx) }),
  },
  {
    labelKey: 'Divider',
    Icon: TbSeparatorHorizontal,
    run: (ctx) => call(ctx, addBlockTypeCommand, { nodeType: hrSchema.type(ctx) }),
  },
  {
    labelKey: 'Bullet List',
    Icon: TbList,
    run: (ctx) => call(ctx, wrapInBlockTypeCommand, { nodeType: bulletListSchema.type(ctx) }),
  },
  {
    labelKey: 'Ordered List',
    Icon: TbListNumbers,
    run: (ctx) => call(ctx, wrapInBlockTypeCommand, { nodeType: orderedListSchema.type(ctx) }),
  },
  {
    labelKey: 'Task List',
    Icon: TbListCheck,
    run: (ctx) =>
      call(ctx, wrapInBlockTypeCommand, {
        nodeType: listItemSchema.type(ctx),
        attrs: { checked: false },
      }),
  },
  {
    labelKey: 'Image',
    Icon: TbPhoto,
    run: (ctx) => call(ctx, addBlockTypeCommand, { nodeType: imageBlockSchema.type(ctx) }),
  },
  {
    labelKey: 'Code',
    Icon: TbCode,
    run: (ctx) => call(ctx, setBlockTypeCommand, { nodeType: codeBlockSchema.type(ctx) }),
  },
  {
    labelKey: 'Table',
    Icon: TbTable,
    run: (ctx) => {
      const { from } = ctx.get(editorViewCtx).state.selection;
      call(ctx, addBlockTypeCommand, { nodeType: createTable(ctx, 3, 3) });
      call(ctx, selectTextNearPosCommand, { pos: from });
    },
  },
  {
    labelKey: 'Math',
    Icon: TbMathFunction,
    run: (ctx) =>
      call(ctx, addBlockTypeCommand, {
        nodeType: codeBlockSchema.type(ctx),
        attrs: { language: 'LaTeX' },
      }),
  },
];

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
  toolbar?: boolean;
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
      toolbar = false,
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
    // Freshest markdown known to this component; survives editor recreation
    // (language switch) where the parent's value prop may lag one emit.
    const contentRef = useRef(value);
    const _ = useTranslation();
    const { i18n } = useI18next();
    const language = i18n.language;

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
        contentRef.current = newValue;
        crepe.editor.action(replaceAll(newValue));
      },
      getElement: () => rootRef.current,
    }));

    useEffect(() => {
      const root = rootRef.current;
      if (!root) return;

      const crepe = new Crepe({
        root,
        defaultValue: contentRef.current,
        // BlockEdit powers both the "/" slash menu and the drag "+" handle;
        // the annotation editor exposes a fixed top toolbar instead, so "/"
        // must not activate anything.
        features: {
          [CrepeFeature.TopBar]: false,
          [CrepeFeature.AI]: false,
          [CrepeFeature.BlockEdit]: false,
        },
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
          contentRef.current = markdown;
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
        contentRef.current = markdown;
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
        if (contentRef.current !== crepe.getMarkdown()) {
          crepe.editor.action(replaceAll(contentRef.current));
        }
        if (autoFocus) {
          crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus());
        }
      });

      return () => {
        // Recreation (language switch) and unmount both land here; carry the
        // in-editor markdown over so nothing typed since the last emit is lost.
        const instance = crepeRef.current;
        if (instance) {
          const markdown = instance.getMarkdown();
          contentRef.current = markdown;
          if (markdown !== lastEmittedRef.current) {
            lastEmittedRef.current = markdown;
            cbRef.current.onChange(markdown);
          }
        }
        readyRef.current = false;
        root.removeEventListener('keydown', onKeyDown, true);
        root.removeEventListener('compositionstart', onCompositionStartEvent);
        root.removeEventListener('compositionend', onCompositionEndEvent);
        root.removeEventListener('focusout', onFocusOut);
        void crepe.destroy();
        crepeRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [language]);

    // Re-sync only genuine external replacements (rollback, recovery choice);
    // typing feedback loops are absorbed because the parent value already
    // equals lastEmittedRef.
    useEffect(() => {
      const crepe = crepeRef.current;
      if (!crepe || !readyRef.current) return;
      if (value !== lastEmittedRef.current && value !== crepe.getMarkdown()) {
        lastEmittedRef.current = value;
        contentRef.current = value;
        crepe.editor.action(replaceAll(value));
      }
    }, [value]);

    const runToolbarItem = (item: ToolbarItem) => {
      const crepe = crepeRef.current;
      if (!crepe || !readyRef.current) return;
      crepe.editor.action((ctx) => item.run(ctx));
    };

    return (
      <div className={clsx('markdown-text-editor', 'flex min-h-0 flex-col', className)} dir='auto'>
        {toolbar && (
          <div className='md-editor-toolbar' role='toolbar' aria-label={_('Text')}>
            {TOOLBAR.map((item) => (
              <button
                key={item.labelKey}
                type='button'
                title={_(item.labelKey)}
                aria-label={_(item.labelKey)}
                // Default mousedown would blur the editor and drop the caret;
                // preventDefault keeps the selection so the command converts
                // the block the user is actually in.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runToolbarItem(item)}
              >
                <item.Icon />
              </button>
            ))}
          </div>
        )}
        <div
          ref={rootRef}
          className='md-editor-body content font-size-sm min-h-0 flex-1 overflow-y-auto'
          data-note-editor=''
        />
      </div>
    );
  },
);

MarkdownTextEditor.displayName = 'MarkdownTextEditor';

export default MarkdownTextEditor;
