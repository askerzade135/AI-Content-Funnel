import assert from 'node:assert/strict';
import test from 'node:test';
import { getWebSearchProviderOrderForTests, resetWebSearchRouterForTests, searchWebCostAware } from '../server/search-router.js';

const originalFetch = globalThis.fetch;
const originalEnv = {
  TAVILY_API_KEY: process.env.TAVILY_API_KEY,
  BRAVE_SEARCH_API_KEY: process.env.BRAVE_SEARCH_API_KEY,
  GOOGLE_WEB_SEARCH_ENABLED: process.env.GOOGLE_WEB_SEARCH_ENABLED,
  OPENAI_WEB_SEARCH_ENABLED: process.env.OPENAI_WEB_SEARCH_ENABLED,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  WEB_SEARCH_PROVIDER_ORDER: process.env.WEB_SEARCH_PROVIDER_ORDER,
  WEB_SEARCH_USAGE_LOGGING: process.env.WEB_SEARCH_USAGE_LOGGING,
};

test('SearchRouter defaults to Google first, then other free pools, with OpenAI last', () => {
  delete process.env.WEB_SEARCH_PROVIDER_ORDER;
  assert.deepEqual(getWebSearchProviderOrderForTests(), ['google', 'tavily', 'brave', 'openai']);
});

function articleHtml(title: string) {
  return '<html><head>'
    + '<title>' + title + '</title>'
    + '<meta property="og:description" content="Useful research summary">'
    + '<meta property="og:image" content="https://images.example.org/' + encodeURIComponent(title) + '.jpg">'
    + '</head><body><article><p>This is substantive article text with enough content for Radar analysis and ranking.</p></article></body></html>';
}

test('SearchRouter stops after sufficient free Tavily results and does not spend Brave/OpenAI fallback', async () => {
  resetWebSearchRouterForTests();
  process.env.TAVILY_API_KEY = 'tavily-test';
  process.env.BRAVE_SEARCH_API_KEY = 'brave-test';
  process.env.GOOGLE_WEB_SEARCH_ENABLED = 'false';
  process.env.OPENAI_WEB_SEARCH_ENABLED = 'true';
  process.env.OPENAI_API_KEY = 'openai-test';
  process.env.WEB_SEARCH_PROVIDER_ORDER = 'tavily,brave,google,openai';
  process.env.WEB_SEARCH_USAGE_LOGGING = 'false';

  const calls: string[] = [];
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    calls.push(url);

    if (url === 'https://api.tavily.com/search') {
      return new Response(JSON.stringify({
        results: [
          { url: 'https://a.example.org/story', title: 'A', content: 'A summary' },
          { url: 'https://b.example.org/story', title: 'B', content: 'B summary' },
          { url: 'https://c.example.org/story', title: 'C', content: 'C summary' },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (/^https:\/\/[abc]\.example\.org\/story/.test(url)) {
      return new Response(articleHtml(url), {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }

    throw new Error('Unexpected request: ' + url);
  }) as typeof fetch;

  const result = await searchWebCostAware({ ownerId: 'owner-a', query: 'topic', limit: 5 });
  assert.equal(result.primaryProvider, 'tavily');
  assert.equal(result.fallbackProvider, undefined);
  assert.equal(result.candidates.length, 3);
  assert.equal(calls.some(url => url.includes('api.search.brave.com')), false);
  assert.equal(calls.some(url => url.includes('api.openai.com')), false);
  assert.ok(result.candidates.every(candidate => Boolean(candidate.imageUrl)));
});

test('SearchRouter falls back sequentially after Tavily quota failure and stops on Brave success', async () => {
  resetWebSearchRouterForTests();
  process.env.TAVILY_API_KEY = 'tavily-test';
  process.env.BRAVE_SEARCH_API_KEY = 'brave-test';
  process.env.GOOGLE_WEB_SEARCH_ENABLED = 'false';
  process.env.OPENAI_WEB_SEARCH_ENABLED = 'true';
  process.env.OPENAI_API_KEY = 'openai-test';
  process.env.WEB_SEARCH_PROVIDER_ORDER = 'tavily,brave,google,openai';
  process.env.WEB_SEARCH_USAGE_LOGGING = 'false';

  const calls: string[] = [];
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    calls.push(url);

    if (url === 'https://api.tavily.com/search') {
      return new Response('{}', { status: 429 });
    }

    if (url.startsWith('https://api.search.brave.com/res/v1/web/search')) {
      return new Response(JSON.stringify({
        web: { results: [
          { url: 'https://d.example.org/story', title: 'D', description: 'D summary' },
          { url: 'https://e.example.org/story', title: 'E', description: 'E summary' },
          { url: 'https://f.example.org/story', title: 'F', description: 'F summary' },
        ] },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (/^https:\/\/[def]\.example\.org\/story/.test(url)) {
      return new Response(articleHtml(url), {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }

    throw new Error('Unexpected request: ' + url);
  }) as typeof fetch;

  const result = await searchWebCostAware({ ownerId: 'owner-b', query: 'topic', limit: 5 });
  assert.equal(result.primaryProvider, 'tavily');
  assert.equal(result.fallbackProvider, 'brave');
  assert.equal(result.recovered, true);
  assert.equal(result.candidates.length, 3);
  assert.equal(calls.some(url => url.includes('api.openai.com')), false);
});

test.after(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetWebSearchRouterForTests();
});
