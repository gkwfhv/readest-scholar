import http from 'node:http';

const json = (res, status, body) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization,content-type,x-title,http-referer',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(JSON.stringify(body));
};

function embedding(input) {
  const vector = Array(1536).fill(0);
  for (const word of String(input).toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let hash = 2166136261;
    for (const char of word) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    vector[hash % vector.length] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0)) || 1;
  return vector.map((x) => x / norm);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.url === '/v1/models' && req.method === 'GET') {
    return json(res, 200, { object: 'list', data: ['scholar-test-chat', 'scholar-test-embed'].map((id) => ({ id, object: 'model', owned_by: 'scholar-test' })) });
  }
  let body = {};
  for await (const chunk of req) body = { ...body, raw: (body.raw ?? '') + chunk.toString() };
  try { body = JSON.parse(body.raw ?? '{}'); } catch { return json(res, 400, { error: { message: 'Invalid JSON' } }); }
  if (req.url === '/v1/embeddings' && req.method === 'POST') {
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    return json(res, 200, { object: 'list', model: body.model, data: inputs.map((input, index) => ({ object: 'embedding', index, embedding: embedding(input) })), usage: { prompt_tokens: 1, total_tokens: 1 } });
  }
  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    const content = 'The title shown on page 1 is TITLE OF THE PAPER. This is a deterministic test response.';
    if (body.stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization,content-type,x-title,http-referer',
      });
      const base = { id: 'chatcmpl-scholar-test', object: 'chat.completion.chunk', created: 0, model: body.model ?? 'scholar-test-chat' };
      res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      return res.end('data: [DONE]\n\n');
    }
    return json(res, 200, { id: 'chatcmpl-scholar-test', object: 'chat.completion', created: 0, model: body.model ?? 'scholar-test-chat', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  }
  return json(res, 404, { error: { message: 'Not found' } });
});

server.listen(3132, '127.0.0.1', () => process.stdout.write('scholar mock listening on 127.0.0.1:3132\n'));
