const assert = require('node:assert/strict');
const test = require('node:test');

const settingsSchema = require('../../settings-schema/schema.json');
const {
  PROVIDERS,
  MAX_QUERY_LENGTH,
  MAX_SUGGESTIONS,
  isSuggestionEligible,
  requestUrlFor,
  parseOpenSearchSuggestions,
  createSearchSuggestionService,
} = require('../../src/main/search-suggestions');

function response(body, { ok = true, contentLength } = {}) {
  return {
    ok,
    headers: {
      get(name) {
        return name.toLowerCase() === 'content-length' && contentLength != null
          ? String(contentLength)
          : null;
      },
    },
    text: async () => body,
  };
}

test('every configured search engine has a fixed HTTPS suggestion provider', () => {
  assert.deepEqual(Object.keys(PROVIDERS), settingsSchema.searchEngines.map(({ id }) => id));

  const query = 'blanc browser & tabs';
  const cases = {
    duckduckgo: ['duckduckgo.com', '/ac/', 'q'],
    google: ['www.google.com', '/complete/search', 'q'],
    bing: ['api.bing.com', '/osjson.aspx', 'query'],
    brave: ['search.brave.com', '/api/suggest', 'q'],
  };
  for (const [engine, [host, path, queryParam]] of Object.entries(cases)) {
    const url = new URL(requestUrlFor(engine, query, 'en-US'));
    assert.equal(url.protocol, 'https:');
    assert.equal(url.host, host);
    assert.equal(url.pathname, path);
    assert.equal(url.searchParams.get(queryParam), query);
  }
  assert.equal(new URL(requestUrlFor('bing', query, 'en-US')).searchParams.get('language'), 'en-US');
  const google = new URL(requestUrlFor('google', 'café'));
  assert.equal(google.searchParams.get('ie'), 'utf-8');
  assert.equal(google.searchParams.get('oe'), 'utf-8');
  assert.equal(settingsSchema.defaults.searchSuggestions, true);
});

test('unknown engines and invalid query values cannot choose a request URL', () => {
  assert.equal(requestUrlFor('made-up', 'hello'), null);
  assert.equal(requestUrlFor('google', ''), null);
  assert.equal(requestUrlFor('google', 'x'.repeat(MAX_QUERY_LENGTH + 1)), null);
  assert.equal(requestUrlFor('google', 42), null);
});

test('suggestion eligibility keeps navigational and narrowly sensitive text local', () => {
  assert.equal(isSuggestionEligible('blanc browser'), true);
  assert.equal(isSuggestionEligible('a'), false);
  assert.equal(isSuggestionEligible('/history'), false);
  assert.equal(isSuggestionEligible('https://example.com/private'), false);
  assert.equal(isSuggestionEligible('mailto:a@example.com'), false);
  assert.equal(isSuggestionEligible('localhost:3000'), false);
  assert.equal(isSuggestionEligible('localhost:3000#access-token'), false);
  assert.equal(isSuggestionEligible('192.168.1.1/admin'), false);
  assert.equal(isSuggestionEligible('10.0.0.1:8080?auth=private'), false);
  assert.equal(isSuggestionEligible('example.com/path'), false);
  assert.equal(isSuggestionEligible('example.com?access_token=private'), false);
  assert.equal(isSuggestionEligible('xn--e1afmkfd.xn--p1ai/private'), false);
  assert.equal(isSuggestionEligible('例え.テスト/private'), false);
  assert.equal(isSuggestionEligible('[2001:db8::1]/admin'), false);
  assert.equal(isSuggestionEligible('[fe80::1%en0]/admin'), false);
  assert.equal(isSuggestionEligible('[fe80::1%25en0]/admin'), false);
  assert.equal(isSuggestionEligible('2001:db8::1/admin'), false);
  assert.equal(isSuggestionEligible('./drafts/private notes'), false);
  assert.equal(isSuggestionEligible(String.raw`\Windows\System32\drivers\etc\hosts`), false);
  assert.equal(isSuggestionEligible(String.raw`\\corp\HR\Payroll 2026.xlsx`), false);
  assert.equal(isSuggestionEligible(String.raw`\\?\C:\Users\me\private.txt`), false);
  assert.equal(isSuggestionEligible(String.raw`\\.\pipe\private-service`), false);
  assert.equal(isSuggestionEligible('My Tax Return.html'), false);
  assert.equal(isSuggestionEligible('4111 1111 1111 1111'), false);
  assert.equal(isSuggestionEligible('api_key='), false);
  assert.equal(isSuggestionEligible('api_key=very-secret-value'), false);
  assert.equal(isSuggestionEligible('token:'), false);
  assert.equal(isSuggestionEligible('sk-'), false);
  assert.equal(isSuggestionEligible('sk-proj-'), false);
  assert.equal(isSuggestionEligible('sk-proj-a'), false);
  assert.equal(isSuggestionEligible('sk-proj-abcdefghijklmnop1234'), false);
  assert.equal(isSuggestionEligible('ghp_'), false);
  assert.equal(isSuggestionEligible('ghp_a'), false);
  assert.equal(isSuggestionEligible('ghp_abcdefghijklmnopqrstuvwxyz123456'), false);
  assert.equal(isSuggestionEligible('AKIA'), false);
  assert.equal(isSuggestionEligible('AKIAI'), false);
  assert.equal(isSuggestionEligible('AKIAIOSFODNN7EXAMPLE'), false);
  assert.equal(isSuggestionEligible(String.raw`how to escape \ in a regex`), true);
  assert.equal(isSuggestionEligible('sketch app recommendations'), true);
  assert.equal(isSuggestionEligible('github token best practices'), true);
  assert.equal(isSuggestionEligible('akia resort reviews'), true);
  assert.equal(isSuggestionEligible('password manager recommendations'), true);
});

test('OpenSearch parsing trims, deduplicates, bounds, and rejects malformed values', () => {
  const long = 'x'.repeat(201);
  const parsed = parseOpenSearchSuggestions([
    'blanc',
    ['  Blanc browser  ', 'blanc browser', 'tab\n groups', '', 42, long, 'third', 'fourth'],
  ], 3);
  assert.deepEqual(parsed, ['Blanc browser', 'tab groups', 'third']);
  assert.deepEqual(parseOpenSearchSuggestions({ suggestions: [] }), []);
  assert.deepEqual(parseOpenSearchSuggestions(['query', 'not-an-array']), []);
});

test('service fetches with privacy-preserving options and caches a bounded result', async () => {
  let calls = 0;
  let captured;
  let clock = 1_000;
  const service = createSearchSuggestionService({ now: () => clock, cacheTtlMs: 100 });
  const fetchImpl = async (url, options) => {
    calls += 1;
    captured = { url, options };
    return response(JSON.stringify(['blanc', ['blanc browser', 'blanc tabs']]));
  };

  const first = await service.get({
    engine: 'duckduckgo',
    query: 'blanc',
    locale: 'en-US',
    fetchImpl,
  });
  const cached = await service.get({
    engine: 'duckduckgo',
    query: 'blanc',
    locale: 'en-US',
    fetchImpl,
  });

  assert.deepEqual(first, ['blanc browser', 'blanc tabs']);
  assert.deepEqual(cached, first);
  assert.equal(calls, 1);
  assert.equal(new URL(captured.url).host, 'duckduckgo.com');
  assert.equal(captured.options.method, 'GET');
  assert.equal(captured.options.credentials, 'omit');
  assert.equal(captured.options.cache, 'no-store');
  assert.equal(captured.options.redirect, 'error');
  assert.equal(captured.options.headers['Accept-Language'], 'en-US');
  assert.ok(captured.options.signal instanceof AbortSignal);

  clock += 101;
  await service.get({ engine: 'duckduckgo', query: 'blanc', locale: 'en-US', fetchImpl });
  assert.equal(calls, 2);
});

test('service fails closed for bad status, malformed JSON, oversized data, and network errors', async () => {
  const cases = [
    async () => response('[]', { ok: false }),
    async () => response('{not json'),
    async () => response('[]', { contentLength: 65 * 1024 }),
    async () => response('x'.repeat(65 * 1024)),
    async () => { throw new Error('offline'); },
  ];
  for (const [index, fetchImpl] of cases.entries()) {
    const service = createSearchSuggestionService();
    assert.deepEqual(
      await service.get({ engine: 'google', query: `failure case ${index}`, fetchImpl }),
      [],
    );
  }
});

test('service aborts a provider that exceeds its timeout', async () => {
  const service = createSearchSuggestionService({ timeoutMs: 5 });
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  assert.deepEqual(
    await service.get({ engine: 'brave', query: 'slow suggestion', fetchImpl }),
    [],
  );
});

test('service cancels a streamed response as soon as it exceeds the body cap', async () => {
  let readCount = 0;
  let canceled = false;
  const service = createSearchSuggestionService();
  const fetchImpl = async () => ({
    ok: true,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        async read() {
          readCount += 1;
          return { done: false, value: new Uint8Array(readCount === 1 ? 64 * 1024 : 1) };
        },
        async cancel() { canceled = true; },
        releaseLock() {},
      }),
    },
  });

  assert.deepEqual(
    await service.get({ engine: 'google', query: 'oversized stream', fetchImpl }),
    [],
  );
  assert.equal(readCount, 2);
  assert.equal(canceled, true);
});

test('parser never returns more than the provider result cap', () => {
  const values = Array.from({ length: MAX_SUGGESTIONS + 5 }, (_, i) => `result ${i}`);
  assert.equal(parseOpenSearchSuggestions(['q', values]).length, MAX_SUGGESTIONS);
});
