import assert from 'node:assert/strict';
import test from 'node:test';
import { generateOpenAIText } from '../server/openai.js';
import { searchWebWithOpenAI } from '../server/web-search.js';

const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENAI_API_KEY;
const originalEnabled = process.env.OPENAI_WEB_SEARCH_ENABLED;

test('OpenAI Responses text provider uses server key and returns usage without exposing secrets', async () => {
  process.env.OPENAI_API_KEY = 'test-secret-key';
  let requestBody: any;
  globalThis.fetch = (async (_url: any, init: any) => {
    assert.equal(init.headers.Authorization, 'Bearer test-secret-key');
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const result = await generateOpenAIText({ input: 'hello', model: 'gpt-4.1-mini' });
  assert.equal(result.text, 'ok');
  assert.equal(result.totalTokens, 15);
  assert.equal(requestBody.model, 'gpt-4.1-mini');
  assert.equal(JSON.stringify(result).includes('test-secret-key'), false);
});

test('BYOK OpenAI key overrides the platform key for that request', async () => {
  process.env.OPENAI_API_KEY = 'platform-key';
  globalThis.fetch = (async (_url: any, init: any) => {
    assert.equal(init.headers.Authorization, 'Bearer user-key');
    return new Response(JSON.stringify({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'byok-ok' }] }],
      usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const result = await generateOpenAIText({ input: 'hello', model: 'gpt-4.1-mini', apiKey: 'user-key' });
  assert.equal(result.text, 'byok-ok');
  assert.equal(JSON.stringify(result).includes('user-key'), false);
  assert.equal(JSON.stringify(result).includes('platform-key'), false);
});

test('OpenAI Web Search normalizes cited sources into web Discovery candidates and deduplicates URLs', async () => {
  process.env.OPENAI_API_KEY = 'test-secret-key';
  process.env.OPENAI_WEB_SEARCH_ENABLED = 'true';
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    assert.deepEqual(body.tools, [{ type: 'web_search' }]);
    assert.equal(body.tool_choice, 'required');
    return new Response(JSON.stringify({
      status: 'completed',
      output: [
        { type: 'web_search_call', action: { sources: [
          { url: 'https://example.com/article#section', title: 'Example article' },
          { url: 'https://example.com/article', title: 'Duplicate' },
          { url: 'https://research.example.org/paper', title: 'Research paper' },
        ] } },
        { type: 'message', content: [{ type: 'output_text', text: 'Concise research summary.', annotations: [] }] },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const result = await searchWebWithOpenAI({ ownerId: 'owner-test', query: 'research', limit: 5 });
  assert.equal(result.configured, true);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].sourceType, 'web');
  assert.equal(result.candidates[0].sourceContentId?.startsWith('web-'), true);
});

test.after(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
  if (originalEnabled === undefined) delete process.env.OPENAI_WEB_SEARCH_ENABLED; else process.env.OPENAI_WEB_SEARCH_ENABLED = originalEnabled;
});
