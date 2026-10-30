import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MarkdownTextEditor, { MarkdownTextEditorRef } from '@/components/MarkdownTextEditor';

// ---- Milkdown mocks: we assert wiring, not Crepe internals. ----

const editorViewFake = {
  focus: vi.fn(),
  dom: { blur: vi.fn(), classList: { add: vi.fn() } },
};

let constructedConfig: Record<string, unknown> | null = null;
let markdownValue = '';
let editorOptions: { attributes?: Record<string, string> } = {};
let markdownUpdatedCb: ((ctx: unknown, md: string) => void) | null = null;
let selectionUpdatedCb: ((ctx: unknown, selection: { from: number; to: number }) => void) | null =
  null;

const replaceAllMock = vi.fn((md: string) => () => ({ __replaceAll: md }));

vi.mock('@milkdown/crepe', () => {
  const CrepeFeature = { TopBar: 'top-bar', AI: 'ai', Placeholder: 'placeholder' };
  return {
    CrepeFeature,
    Crepe: class {
      static Feature = CrepeFeature;
      editor = {
        config: (fn: (ctx: unknown) => void) => {
          fn({
            update: (_slice: unknown, updater: (prev: unknown) => unknown) => {
              editorOptions = updater(editorOptions) as { attributes?: Record<string, string> };
            },
          });
        },
        action: (fn: (ctx: unknown) => unknown) => fn({ get: () => editorViewFake }),
      };
      setReadonly = vi.fn();
      constructor(config: Record<string, unknown>) {
        constructedConfig = config;
      }
      getMarkdown = () => markdownValue;
      on = (fn: (api: unknown) => void) => {
        fn({
          markdownUpdated: (cb: (ctx: unknown, md: string) => void) => {
            markdownUpdatedCb = cb;
          },
          selectionUpdated: (cb: (ctx: unknown, s: { from: number; to: number }) => void) => {
            selectionUpdatedCb = cb;
          },
        });
        return this;
      };
      create = () => Promise.resolve();
      destroy = () => Promise.resolve();
    },
  };
});

vi.mock('@milkdown/kit/core', () => ({
  editorViewCtx: { __ctx: 'editorView' },
  editorViewOptionsCtx: { __ctx: 'editorViewOptions' },
}));

vi.mock('@milkdown/kit/utils', () => ({
  replaceAll: (md: string) => replaceAllMock(md),
}));

describe('MarkdownTextEditor', () => {
  beforeEach(() => {
    constructedConfig = null;
    markdownValue = 'hello';
    editorOptions = {};
    markdownUpdatedCb = null;
    selectionUpdatedCb = null;
    replaceAllMock.mockClear();
    editorViewFake.focus.mockClear();
    editorViewFake.dom.blur.mockClear();
    editorViewFake.dom.classList.add.mockClear();
  });

  const renderEditor = async (
    props: Partial<React.ComponentProps<typeof MarkdownTextEditor>> = {},
  ) => {
    const ref = createRef<MarkdownTextEditorRef>();
    const onChange = vi.fn();
    const onBlur = vi.fn();
    const onSave = vi.fn();
    const onEscape = vi.fn();
    const onSelect = vi.fn();
    const utils = render(
      <MarkdownTextEditor
        ref={ref}
        value='hello'
        onChange={onChange}
        onBlur={onBlur}
        onSave={onSave}
        onEscape={onEscape}
        onSelect={onSelect}
        ariaLabel='Notebook'
        spellCheck
        {...props}
      />,
    );
    await waitFor(() => expect(constructedConfig).not.toBeNull());
    const root = utils.container.querySelector('.markdown-text-editor') as HTMLDivElement;
    return { ...utils, root, ref, onChange, onBlur, onSave, onEscape, onSelect };
  };

  it('constructs Crepe with the initial value, placeholder config and a11y attributes', async () => {
    const { onChange } = await renderEditor({ placeholder: 'Start writing…' });

    expect(constructedConfig).toMatchObject({
      defaultValue: 'hello',
      features: { 'top-bar': false, ai: false },
      featureConfigs: { placeholder: { text: 'Start writing…', mode: 'doc' } },
    });
    expect(editorOptions.attributes).toMatchObject({
      'data-note-editor': '',
      role: 'textbox',
      dir: 'auto',
      spellcheck: 'true',
      'aria-label': 'Notebook',
    });
    expect(editorViewFake.dom.classList.add).toHaveBeenCalledWith('select-text');
    expect(replaceAllMock).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('forwards markdownUpdated events to onChange', async () => {
    const { onChange } = await renderEditor();
    expect(markdownUpdatedCb).toBeTruthy();
    act(() => markdownUpdatedCb!({}, 'updated md'));
    expect(onChange).toHaveBeenCalledWith('updated md');
  });

  it('setValue replaces the document via the replaceAll action', async () => {
    const { ref } = await renderEditor();
    act(() => ref.current?.setValue('replaced'));
    expect(replaceAllMock).toHaveBeenCalledWith('replaced');
  });

  it('flushes pending markdown before onBlur so save handlers see the latest content', async () => {
    const { root, onChange, onBlur } = await renderEditor();
    markdownValue = 'typed since last emit';
    fireEvent.focusOut(root);
    expect(onChange).toHaveBeenCalledWith('typed since last emit');
    expect(onBlur).toHaveBeenCalledTimes(1);

    // No duplicate flush when nothing changed since the last emit.
    onChange.mockClear();
    onBlur.mockClear();
    markdownValue = 'typed since last emit';
    fireEvent.focusOut(root);
    expect(onChange).not.toHaveBeenCalled();
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('maps Escape to onEscape and Ctrl/Cmd+Enter to onSave', async () => {
    const { root, onEscape, onSave } = await renderEditor();
    fireEvent.keyDown(root, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);

    const saveEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    root.dispatchEvent(saveEvent);
    expect(saveEvent.defaultPrevented).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('reports the ProseMirror selection offsets after the editor is ready', async () => {
    const { onSelect } = await renderEditor();
    expect(selectionUpdatedCb).toBeTruthy();
    act(() => selectionUpdatedCb!({}, { from: 2, to: 5 }));
    expect(onSelect).toHaveBeenCalledWith(2, 5);
  });

  it('re-syncs only genuine external value replacements', async () => {
    const { rerender, ref } = await renderEditor();
    replaceAllMock.mockClear();

    rerender(
      <MarkdownTextEditor ref={ref as never} value='world' onChange={vi.fn()} onBlur={vi.fn()} />,
    );
    expect(replaceAllMock).toHaveBeenCalledWith('world');
  });
});
