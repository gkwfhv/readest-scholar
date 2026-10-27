/** @vitest-environment jsdom */
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { embed, generateText } from 'ai';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import {
  fetchOpenRouterModels,
  OpenRouterProvider,
} from '@/services/ai/providers/OpenRouterProvider';

interface RequestRecord {
  path: string;
  authorization: string | undefined;
  model: string | undefined;
}
const records: RequestRecord[] = [];
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length
      ? (JSON.parse(Buffer.concat(chunks).toString()) as { model?: string })
      : {};
    records.push({
      path: request.url ?? '',
      authorization: request.headers.authorization,
      model: body.model,
    });
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/v1/models') {
      response.end(JSON.stringify({ data: [{ id: 'custom-chat' }, { id: 'custom-embed' }] }));
    } else if (request.url === '/v1/embeddings') {
      response.end(
        JSON.stringify({
          object: 'list',
          data: [{ object: 'embedding', index: 0, embedding: [0.5, 0.5] }],
          model: 'custom-embed',
          usage: { prompt_tokens: 2, total_tokens: 2 },
        }),
      );
    } else if (request.url === '/v1/chat/completions') {
      response.end(
        JSON.stringify({
          id: 'chatcmpl-local-probe',
          object: 'chat.completion',
          created: 1,
          model: 'custom-chat',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'local compatible response' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        }),
      );
    } else {
      response.statusCode = 404;
      response.end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe('OpenAI-compatible HTTP integration', () => {
  it('uses configured model IDs and bearer key for models, embeddings and chat', async () => {
    const provider = new OpenRouterProvider({
      ...DEFAULT_AI_SETTINGS,
      provider: 'openrouter',
      openrouterBaseUrl: baseUrl,
      openrouterApiKey: 'synthetic-test-key',
      openrouterModel: 'custom-chat',
      openrouterEmbeddingModel: 'custom-embed',
    });
    expect(
      (await fetchOpenRouterModels(baseUrl, 'synthetic-test-key')).map((model) => model.id),
    ).toEqual(['custom-chat', 'custom-embed']);
    expect(await provider.healthCheck()).toBe(true);
    expect(
      (await embed({ model: provider.getEmbeddingModel(), value: 'sample text' })).embedding,
    ).toEqual([0.5, 0.5]);
    expect((await generateText({ model: provider.getModel(), prompt: 'hello' })).text).toBe(
      'local compatible response',
    );
    expect(records.map((record) => record.path)).toEqual([
      '/v1/models',
      '/v1/models',
      '/v1/embeddings',
      '/v1/chat/completions',
    ]);
    expect(records.every((record) => record.authorization === 'Bearer synthetic-test-key')).toBe(
      true,
    );
    expect(records.filter((record) => record.model).map((record) => record.model)).toEqual([
      'custom-embed',
      'custom-chat',
    ]);
  });
});
