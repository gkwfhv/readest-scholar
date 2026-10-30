import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Tool } from 'ai';
import type { RetrievalBackend } from '@/services/ai/adapters/retrievalBackend';
import { ReedySourceStore } from '@/services/ai/adapters/reedySourceStore';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import type { AISettings, ScoredChunk } from '@/services/ai/types';

// streamText is mocked so the test runs without an LLM provider — we assert
// what arguments the adapter PASSES, not what the model produces.
const streamTextMock = vi.fn();
const stepCountIsMock = vi.fn((n: number) => ({ __stepCountIs: n }));

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    streamText: streamTextMock,
    stepCountIs: stepCountIsMock,
  };
});

// Provider must return a model object that streamText accepts. Since
// streamText itself is mocked we can hand back any opaque sentinel.
vi.mock('@/services/ai/providers', () => ({
  getAIProvider: () => ({
    getModel: () => ({ __mock: 'language-model' }),
    getEmbeddingModel: () => ({ __mock: 'embedding-model' }),
  }),
}));

// Web search is exercised only when the composer toggle asks for it.
const searchWebMock = vi.fn(
  async (): Promise<Array<{ title: string; url: string; snippet: string }>> => [],
);
vi.mock('@/services/ai/webSearch', () => ({
  searchWeb: searchWebMock,
}));

// Import after mocks so the adapter picks up the mocked streamText.
const { createTauriAdapter } = await import('@/services/ai/adapters/TauriChatAdapter');

interface FakeBackendOverrides {
  searchResult?: ScoredChunk[];
  buildLookupTool?: RetrievalBackend['buildLookupTool'];
}

function fakeLegacy(overrides: FakeBackendOverrides = {}): RetrievalBackend {
  return {
    kind: 'legacy-idb',
    isIndexed: vi.fn(async () => true),
    indexBook: vi.fn(async () => {}),
    clearBook: vi.fn(async () => {}),
    searchForSystemPrompt: vi.fn(async () => overrides.searchResult ?? []),
  };
}

function fakeReedy(overrides: FakeBackendOverrides = {}): RetrievalBackend {
  const tool = { __mock: 'tool' } as unknown as Tool<unknown, unknown>;
  return {
    kind: 'reedy',
    isIndexed: vi.fn(async () => true),
    indexBook: vi.fn(async () => {}),
    clearBook: vi.fn(async () => {}),
    buildLookupTool: overrides.buildLookupTool ?? vi.fn(() => tool),
  };
}

const baseSettings: AISettings = {
  ...DEFAULT_AI_SETTINGS,
  enabled: true,
  provider: 'ollama',
  reedy: { enabled: true },
};

async function* asyncIter<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

interface RunCall {
  model: unknown;
  system: string;
  messages: Array<{ role: string; content: string }>;
  tools?: Record<string, unknown>;
  stopWhen?: unknown;
  abortSignal?: AbortSignal;
  temperature?: number;
}

async function drainRun(adapterRun: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of adapterRun) {
    /* swallow */
  }
}

beforeEach(() => {
  streamTextMock.mockReset();
  stepCountIsMock.mockClear();
  searchWebMock.mockReset();
  searchWebMock.mockImplementation(async () => []);
  // Default: streamText returns an empty text stream so the for-await loop
  // in the adapter completes immediately.
  streamTextMock.mockImplementation(
    (args: RunCall) =>
      ({
        ...args,
        textStream: asyncIter<string>([]),
      }) as unknown,
  );
});

describe('TauriChatAdapter wiring (M1.11)', () => {
  it('Reedy backend: streamText receives tools.lookupPassage and stopWhen=stepCountIs(3)', async () => {
    const sourceStore = new ReedySourceStore();
    const backend = fakeReedy();
    const adapter = createTauriAdapter(() => ({
      settings: baseSettings,
      bookHash: 'bk1',
      bookTitle: 'Title',
      authorName: 'Author',
      currentPage: 0,
      currentSectionIndex: 1,
      backend,
      sourceStore,
    }));

    await drainRun(
      adapter.run({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'What is Alice doing?' }] }],
        abortSignal: undefined,
      } as unknown as Parameters<typeof adapter.run>[0]) as AsyncIterable<unknown>,
    );

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const call = streamTextMock.mock.calls[0]![0] as RunCall;
    expect(call.tools).toBeDefined();
    expect(call.tools!['lookupPassage']).toBeDefined();
    expect(call.stopWhen).toEqual({ __stepCountIs: 3 });
    expect(call.system).toMatch(/lookupPassage/);
    expect(call.system).toMatch(/<retrieved/);
    expect(backend.buildLookupTool).toHaveBeenCalledWith(
      expect.objectContaining({
        bookHash: 'bk1',
        sourceStore,
        spoilerBoundSectionIndex: 1,
      }),
    );
  });

  it('legacy backend: streamText receives NO tools and the system prompt holds chunks', async () => {
    const sourceStore = new ReedySourceStore();
    const chunks: ScoredChunk[] = [
      {
        id: 'c1',
        bookHash: 'bk1',
        sectionIndex: 0,
        chapterTitle: 'Ch1',
        pageNumber: 0,
        text: 'Alice met the rabbit',
        searchMethod: 'hybrid',
        score: 0.9,
      },
    ];
    const backend = fakeLegacy({ searchResult: chunks });
    const adapter = createTauriAdapter(() => ({
      settings: { ...baseSettings, reedy: { enabled: false }, provider: 'ollama' },
      bookHash: 'bk1',
      bookTitle: 'Title',
      authorName: 'Author',
      currentPage: 0,
      currentSectionIndex: 0,
      backend,
      sourceStore,
    }));

    await drainRun(
      adapter.run({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'rabbit' }] }],
        abortSignal: undefined,
      } as unknown as Parameters<typeof adapter.run>[0]) as AsyncIterable<unknown>,
    );

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const call = streamTextMock.mock.calls[0]![0] as RunCall;
    expect(call.tools).toBeUndefined();
    expect(backend.searchForSystemPrompt).toHaveBeenCalled();
    // Source store should be populated with the legacy chunks under the turn id.
    const turnIds = (sourceStore as unknown as { sources: Map<string, unknown[]> }).sources;
    const populatedTurns = [...turnIds.entries()].filter(([, v]) => v.length > 0);
    expect(populatedTurns.length).toBe(1);
  });

  it('onTurnStart fires synchronously before the stream begins so the UI can subscribe', async () => {
    const sourceStore = new ReedySourceStore();
    const backend = fakeReedy();
    const turnStartedWith: string[] = [];

    const adapter = createTauriAdapter(() => ({
      settings: baseSettings,
      bookHash: 'bk1',
      bookTitle: 'Title',
      authorName: 'Author',
      currentPage: 0,
      currentSectionIndex: 0,
      backend,
      sourceStore,
      onTurnStart: (id) => turnStartedWith.push(id),
    }));

    await drainRun(
      adapter.run({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        abortSignal: undefined,
      } as unknown as Parameters<typeof adapter.run>[0]) as AsyncIterable<unknown>,
    );

    expect(turnStartedWith).toHaveLength(1);
    expect(turnStartedWith[0]).toMatch(/.+/);
    // The store should hold the same key (replaced with [] at turn start).
    expect(sourceStore.get(turnStartedWith[0]!)).toEqual([]);
  });

  it('Reedy backend: every system prompt includes the status-handling instructions', async () => {
    const sourceStore = new ReedySourceStore();
    const adapter = createTauriAdapter(() => ({
      settings: baseSettings,
      bookHash: 'bk1',
      bookTitle: 'My Book',
      authorName: '',
      currentPage: 5,
      currentSectionIndex: 5,
      backend: fakeReedy(),
      sourceStore,
    }));

    await drainRun(
      adapter.run({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
        abortSignal: undefined,
      } as unknown as Parameters<typeof adapter.run>[0]) as AsyncIterable<unknown>,
    );

    const call = streamTextMock.mock.calls[0]![0] as RunCall;
    for (const status of [
      'not_indexed',
      'empty_index',
      'stale_index',
      'degraded',
      'budget_exceeded',
    ]) {
      expect(call.system, `system prompt should mention ${status}`).toContain(status);
    }
    expect(call.system).toContain('My Book');
  });
  it('PDF spoiler protection includes the current physical page in legacy lookup', async () => {
    const backend = fakeLegacy({
      searchResult: [
        {
          id: 'pdf-1-0-0',
          bookHash: 'pdf-1',
          sectionIndex: 0,
          chapterTitle: 'Page 1',
          pageNumber: 1,
          text: 'The paper reports 28.4 BLEU.',
          searchMethod: 'bm25',
          score: 1,
        },
      ],
    });
    const adapter = createTauriAdapter(() => ({
      settings: { ...baseSettings, reedy: { enabled: false }, spoilerProtection: true },
      bookHash: 'pdf-1',
      bookTitle: 'Synthetic Paper',
      authorName: '',
      currentPage: 0,
      currentSectionIndex: 0,
      isPdf: true,
      backend,
      sourceStore: new ReedySourceStore(),
    }));
    await drainRun(
      adapter.run({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'What BLEU score?' }] }],
        abortSignal: undefined,
      } as unknown as Parameters<typeof adapter.run>[0]) as AsyncIterable<unknown>,
    );
    expect(backend.searchForSystemPrompt).toHaveBeenCalledWith('What BLEU score?', 'pdf-1', {
      topK: 10,
      spoilerBoundPosition: 1,
    });
    expect((streamTextMock.mock.calls[0]![0] as RunCall).system).toContain(
      'Current visible page: 1.',
    );
  });

  it('PDF without retrieved evidence still calls the model with a general-question prompt', async () => {
    streamTextMock.mockImplementationOnce(() => ({
      textStream: asyncIter(['That is not in the document; it is 42.']),
    }));
    const adapter = createTauriAdapter(() => ({
      settings: { ...baseSettings, reedy: { enabled: false }, spoilerProtection: false },
      bookHash: 'pdf-1',
      bookTitle: 'Synthetic Paper',
      authorName: '',
      currentPage: 8,
      currentSectionIndex: 7,
      isPdf: true,
      backend: fakeLegacy(),
      sourceStore: new ReedySourceStore(),
    }));
    const output: string[] = [];
    for await (const event of adapter.run({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'What was measured?' }] }],
      abortSignal: undefined,
    } as unknown as Parameters<typeof adapter.run>[0]) as AsyncIterable<{
      content: Array<{ text: string }>;
    }>) {
      output.push(event.content[0]!.text);
    }
    expect(streamTextMock).toHaveBeenCalledTimes(1);
    expect(output).toHaveLength(1);
    expect(output[0]).toBe('That is not in the document; it is 42.');
    const call = streamTextMock.mock.calls[0]![0] as RunCall;
    expect(call.system).toMatch(/NOT about the document/);
    expect(call.system).not.toContain('I cannot verify that from this PDF.');
  });

  it('PDF with evidence gives the model a physical page citation and untrusted-source rules', async () => {
    const adapter = createTauriAdapter(() => ({
      settings: { ...baseSettings, reedy: { enabled: false }, spoilerProtection: false },
      bookHash: 'pdf-1',
      bookTitle: 'Synthetic Paper',
      authorName: 'Researcher',
      currentPage: 8,
      currentSectionIndex: 7,
      isPdf: true,
      backend: fakeLegacy({
        searchResult: [
          {
            id: 'pdf-1-7-0',
            bookHash: 'pdf-1',
            sectionIndex: 7,
            chapterTitle: 'Page 8',
            pageNumber: 8,
            text: 'The measured value was 42.',
            searchMethod: 'hybrid',
            score: 0.9,
          },
        ],
      }),
      sourceStore: new ReedySourceStore(),
    }));
    await drainRun(
      adapter.run({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'What was measured?' }] }],
        abortSignal: undefined,
      } as unknown as Parameters<typeof adapter.run>[0]) as AsyncIterable<unknown>,
    );
    const call = streamTextMock.mock.calls[0]![0] as RunCall;
    expect(call.system).toContain('[p. 8]');
    expect(call.system).toMatch(/untrusted|data only/i);
    expect(call.system).toMatch(/numeric value.*cited page/i);
    expect(call.system).toContain('The measured value was 42.');
    expect(call.temperature).toBe(0);
  });
  it('Reedy PDF without evidence still calls the model', async () => {
    streamTextMock.mockImplementationOnce(() => ({
      textStream: asyncIter(['Not in the document; answering from general knowledge.']),
    }));
    const searchPdfEvidence = vi.fn(async () => ({ passages: [], status: 'ok' }));
    const backend = Object.assign(fakeReedy(), { searchPdfEvidence });
    const adapter = createTauriAdapter(() => ({
      settings: baseSettings,
      bookHash: 'pdf-1',
      bookTitle: 'Synthetic Paper',
      authorName: '',
      currentPage: 8,
      currentSectionIndex: 7,
      isPdf: true,
      backend,
      sourceStore: new ReedySourceStore(),
    }));
    const output: string[] = [];
    for await (const event of adapter.run({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'What was measured?' }] }],
      abortSignal: undefined,
    } as unknown as Parameters<typeof adapter.run>[0]) as AsyncIterable<{
      content: Array<{ text: string }>;
    }>) {
      output.push(event.content[0]!.text);
    }
    expect(searchPdfEvidence).toHaveBeenCalled();
    expect(streamTextMock).toHaveBeenCalledTimes(1);
    expect(output).toHaveLength(1);
    expect(output[0]).toBe('Not in the document; answering from general knowledge.');
  });

  it('Reedy PDF retrieves page evidence before generation and exposes its source', async () => {
    const sourceStore = new ReedySourceStore();
    const searchPdfEvidence = vi.fn(async () => ({
      status: 'ok',
      passages: [
        {
          id: 'pdf-1-7-0',
          bookHash: 'pdf-1',
          cfi: 'epubcfi(/6/16!/4/2)',
          endCfi: 'epubcfi(/6/16!/4/4)',
          sectionIndex: 7,
          chapterTitle: 'Page 8',
          text: 'The measured value was 42.',
          positionIndex: 7,
          score: 0.9,
        },
      ],
    }));
    const backend = Object.assign(fakeReedy(), { searchPdfEvidence });
    const adapter = createTauriAdapter(() => ({
      settings: baseSettings,
      bookHash: 'pdf-1',
      bookTitle: 'Synthetic Paper',
      authorName: '',
      currentPage: 8,
      currentSectionIndex: 7,
      isPdf: true,
      backend,
      sourceStore,
    }));
    await drainRun(
      adapter.run({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'What was measured?' }] }],
        abortSignal: undefined,
      } as unknown as Parameters<typeof adapter.run>[0]) as AsyncIterable<unknown>,
    );
    expect(searchPdfEvidence).toHaveBeenCalledWith('What was measured?', 'pdf-1', {
      topK: 10,
      spoilerBoundSectionIndex: 7,
    });
    const call = streamTextMock.mock.calls[0]![0] as RunCall;
    expect(call.tools).toBeUndefined();
    expect(call.system).toContain('[p. 8]');
    expect(call.temperature).toBe(0);
    const turnIds = (sourceStore as unknown as { sources: Map<string, unknown[]> }).sources;
    expect([...turnIds.values()][0]).toHaveLength(1);
  });
  it('streams the model answer even when a numeric claim cites a different page', async () => {
    streamTextMock.mockImplementationOnce(() => ({
      textStream: asyncIter(['The replacement rate is 80% [p. 1].']),
    }));
    const backend = fakeLegacy({
      searchResult: [
        {
          id: 'pdf-1-0-0',
          bookHash: 'pdf-1',
          sectionIndex: 0,
          chapterTitle: 'Page 1',
          pageNumber: 1,
          text: 'BERT is a bidirectional model.',
          searchMethod: 'bm25',
          score: 0.4,
        },
        {
          id: 'pdf-1-3-0',
          bookHash: 'pdf-1',
          sectionIndex: 3,
          chapterTitle: 'Page 4',
          pageNumber: 4,
          text: 'The [MASK] token is used 80% of the time.',
          searchMethod: 'bm25',
          score: 1,
        },
      ],
    });
    const adapter = createTauriAdapter(() => ({
      settings: { ...baseSettings, reedy: { enabled: false }, spoilerProtection: false },
      bookHash: 'pdf-1',
      bookTitle: 'Synthetic BERT',
      authorName: '',
      currentPage: 4,
      currentSectionIndex: 3,
      isPdf: true,
      backend,
      sourceStore: new ReedySourceStore(),
    }));
    const output: string[] = [];
    for await (const event of adapter.run({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'How often is MASK used?' }] }],
      abortSignal: undefined,
    } as unknown as Parameters<typeof adapter.run>[0]) as AsyncIterable<{
      content: Array<{ text: string }>;
    }>) {
      output.push(event.content[0]!.text);
    }
    expect(output).toHaveLength(1);
    expect(output[0]).toBe('The replacement rate is 80% [p. 1].');
  });

  it('streams an uncited PDF answer from the model', async () => {
    streamTextMock.mockImplementationOnce(() => ({
      textStream: asyncIter(['The value', ' was 42.']),
    }));
    const backend = fakeLegacy({
      searchResult: [
        {
          id: 'pdf-1-7-0',
          bookHash: 'pdf-1',
          sectionIndex: 7,
          chapterTitle: 'Page 8',
          pageNumber: 8,
          text: 'The value was 42.',
          searchMethod: 'hybrid',
          score: 1,
        },
      ],
    });
    const adapter = createTauriAdapter(() => ({
      settings: { ...baseSettings, reedy: { enabled: false }, spoilerProtection: false },
      bookHash: 'pdf-1',
      bookTitle: 'Synthetic Paper',
      authorName: '',
      currentPage: 8,
      currentSectionIndex: 7,
      isPdf: true,
      backend,
      sourceStore: new ReedySourceStore(),
    }));
    const output: string[] = [];
    for await (const event of adapter.run({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'What was measured?' }] }],
      abortSignal: undefined,
    } as unknown as Parameters<typeof adapter.run>[0]) as AsyncIterable<{
      content: Array<{ text: string }>;
    }>) {
      output.push(event.content[0]!.text);
    }
    expect(output).toHaveLength(1);
    expect(output[0]).toBe('The value was 42.');
  });

  it('PDF index lookup errors fail closed before generation', async () => {
    const backend = fakeLegacy();
    backend.isIndexed = vi.fn(async () => {
      throw new Error('storage unavailable');
    });
    const adapter = createTauriAdapter(() => ({
      settings: { ...baseSettings, reedy: { enabled: false } },
      bookHash: 'pdf-1',
      bookTitle: 'Synthetic Paper',
      authorName: '',
      currentPage: 8,
      currentSectionIndex: 7,
      isPdf: true,
      backend,
      sourceStore: new ReedySourceStore(),
    }));
    const output: string[] = [];
    for await (const event of adapter.run({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'What was measured?' }] }],
      abortSignal: undefined,
    } as unknown as Parameters<typeof adapter.run>[0]) as AsyncIterable<{
      content: Array<{ text: string }>;
    }>) {
      output.push(event.content[0]!.text);
    }
    expect(streamTextMock).not.toHaveBeenCalled();
    expect(output.join(' ')).toMatch(/cannot verify|can't verify/i);
  });
});

interface TriliumCall {
  system: string;
  messages: Array<{ role: string; content: unknown }>;
  providerOptions?: { ollama?: { think?: boolean } };
}

describe('Trilium-style composer capabilities', () => {
  const runWithToggles = async (
    toggles: { webSearch: boolean; includeNotes: boolean; thinking: boolean },
    extra: { getNotebookContext?: () => string; getAnnotationsContext?: () => string } = {},
  ) => {
    const adapter = createTauriAdapter(() => ({
      settings: { ...baseSettings, reedy: { enabled: false } },
      bookHash: 'bk1',
      bookTitle: 'Title',
      authorName: 'Author',
      currentPage: 1,
      currentSectionIndex: 0,
      backend: fakeLegacy(),
      sourceStore: new ReedySourceStore(),
      composerToggles: toggles,
      ...extra,
    }));
    await drainRun(
      adapter.run({
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Is the web result reliable?' }] },
        ],
        abortSignal: undefined,
      } as unknown as Parameters<typeof adapter.run>[0]) as AsyncIterable<unknown>,
    );
    return streamTextMock.mock.calls[0]![0] as TriliumCall;
  };

  it('web search toggle: query goes to DuckDuckGo and results land in the system prompt', async () => {
    searchWebMock.mockImplementationOnce(async () => [
      { title: 'Reliable Source', url: 'https://example.com/a', snippet: 'a snippet' },
    ]);
    const call = await runWithToggles({ webSearch: true, includeNotes: false, thinking: false });

    expect(searchWebMock).toHaveBeenCalledWith('Is the web result reliable?');
    expect(call.system).toContain('WEB SEARCH RESULTS');
    expect(call.system).toContain('Reliable Source');
    expect(call.system).toContain('https://example.com/a');
  });

  it('web search failure is logged and does not abort the turn', async () => {
    searchWebMock.mockRejectedValueOnce(new Error('ddg down'));
    const call = await runWithToggles({ webSearch: true, includeNotes: false, thinking: false });

    expect(streamTextMock).toHaveBeenCalledTimes(1);
    expect(call.system).not.toContain('WEB SEARCH RESULTS');
  });

  it('includeNotes toggle: notebook and annotations contexts land in the prompt', async () => {
    const call = await runWithToggles(
      { webSearch: false, includeNotes: true, thinking: false },
      {
        getNotebookContext: () => '# My notes\nChapter one was slow.',
        getAnnotationsContext: () => '「quoted line」 → I loved this',
      },
    );

    expect(call.system).toContain('USER NOTEBOOK');
    expect(call.system).toContain('# My notes');
    expect(call.system).toContain('USER HIGHLIGHTS/ANNOTATIONS');
    expect(call.system).toContain('I loved this');
  });

  it('includeNotes toggle off keeps user notes out of the prompt', async () => {
    const call = await runWithToggles(
      { webSearch: false, includeNotes: false, thinking: false },
      {
        getNotebookContext: () => '# My notes',
        getAnnotationsContext: () => 'annotation',
      },
    );

    expect(call.system).not.toContain('USER NOTEBOOK');
    expect(call.system).not.toContain('USER HIGHLIGHTS/ANNOTATIONS');
  });

  it('thinking toggle: adds the THINKING MODE directive and ollama think option', async () => {
    const call = await runWithToggles({ webSearch: false, includeNotes: false, thinking: true });

    expect(call.system).toContain('THINKING MODE');
    expect(call.providerOptions?.ollama?.think).toBe(true);
  });

  it('thinking toggle off leaves the prompt and provider options untouched', async () => {
    const call = await runWithToggles({ webSearch: false, includeNotes: false, thinking: false });

    expect(call.system).not.toContain('THINKING MODE');
    expect(call.providerOptions).toBeUndefined();
  });

  it('pasted image attachments reach the model as image content parts', async () => {
    const adapter = createTauriAdapter(() => ({
      settings: { ...baseSettings, reedy: { enabled: false } },
      bookHash: 'bk1',
      bookTitle: 'Title',
      authorName: 'Author',
      currentPage: 1,
      currentSectionIndex: 0,
      backend: fakeLegacy(),
      sourceStore: new ReedySourceStore(),
      composerToggles: { webSearch: false, includeNotes: false, thinking: false },
    }));
    await drainRun(
      adapter.run({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What does this chart show?' },
              { type: 'image', image: 'data:image/jpeg;base64,AAAA' },
            ],
          },
        ],
        abortSignal: undefined,
      } as unknown as Parameters<typeof adapter.run>[0]) as AsyncIterable<unknown>,
    );

    const call = streamTextMock.mock.calls[0]![0] as TriliumCall;
    const userContent = call.messages[0]!.content as Array<{
      type: string;
      text?: string;
      image?: string;
    }>;
    expect(userContent.find((part) => part.type === 'text')?.text).toBe(
      'What does this chart show?',
    );
    expect(userContent.find((part) => part.type === 'image')?.image).toBe(
      'data:image/jpeg;base64,AAAA',
    );
  });
});
