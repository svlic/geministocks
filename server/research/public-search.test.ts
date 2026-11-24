import { afterEach, expect, it, vi } from 'vitest';
import type { ModelConfig } from '../gateway/index';
import { IngestionError } from '../ingestion/types';
const page = vi.hoisted(() => vi.fn());
vi.mock('../ingestion/website', async importOriginal => ({ ...await importOriginal<typeof import('../ingestion/website')>(), fetchPublicPage: page }));
import { discoverPublicEvidence } from './public-search';
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
const signal = () => new AbortController().signal;
const config: ModelConfig = { provider: 'openai', baseUrl: 'https://relay.example/v1', modelId: 'research-model', apiKey: 'private-key', timeoutMs: 1000, maxOutputTokens: 3000, allowConfidential: false };
function response(urls: string[], searches: unknown[] = [{ type: 'web_search_call', status: 'completed', action: { query: 'site:x.com example.org founders' } }]) {
  return Response.json({ status: 'completed', output: [...searches, {
    type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'UNVERIFIED-MODEL-SUMMARY: invented financing $100M https://invented.example',
      annotations: urls.map(url => ({ type: 'url_citation', url, title: 'Search citation' })) }],
  }], usage: { input_tokens: 100, output_tokens: 20 } });
}

it('uses the research model key and only the public origin; retrieves cited pages instead of trusting summaries', async () => {
  const fetcher = vi.fn().mockResolvedValue(response(['https://news.example.org/company', 'https://example.org/about', 'https://x.com/example/status/123']));
  vi.stubGlobal('fetch', fetcher);
  page.mockImplementation(async (url: string) => ({ url, title: 'Source', text: 'Actually retrieved text' }));
  const result = await discoverPublicEvidence('https://example.org/private?token=SECRET', config, signal());
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe('https://relay.example/v1/responses');
  expect(options.headers.authorization).toBe('Bearer private-key');
  const body = JSON.parse(options.body);
  expect(body.input[1].content).toBe('{"publicWebsite":"https://example.org"}');
  expect(body.tools).toEqual([{ type: 'web_search' }]);
  expect(body.tool_choice).toBe('required');
  expect(body.input[0].content).toMatch(/founders/);expect(body.input[0].content).toMatch(/site:x.com/);
  expect(result).toMatchObject({ searchUsed: true, xSearchUsed: true, usage: { input_tokens: 100, output_tokens: 20 } });
  expect(result.evidence.map(e => e.type)).toEqual(['third_party', 'official_website', 'third_party']);
  expect(result.evidence.every(e => e.quoteOrSummary === 'Actually retrieved text')).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/SECRET|invented|private-key|UNVERIFIED-MODEL-SUMMARY/);
});

it('skips unsafe/inaccessible results, deduplicates URLs and retains at most six readable pages', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([
    'https://127.0.0.1/private', 'https://example.org/a', 'https://example.org/a',
    ...['b', 'c', 'd', 'e', 'f', 'g'].map(path => `https://news.example.org/${path}`),
  ])));
  page.mockImplementation(async (url: string) => { if (url.endsWith('/a')) throw new Error('blocked');return { url, title: 'Public', text: 'Retrieved evidence' }; });
  const result = await discoverPublicEvidence('https://example.org', config, signal());
  expect(result.evidence.map(e => e.url)).toEqual(['b', 'c', 'd', 'e', 'f', 'g'].map(path => `https://news.example.org/${path}`));
  expect(result.limitations.join(' ')).toContain('search_source_unreadable');
});

it('discloses inaccessible Twitter originals without turning the model summary into evidence', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(['https://x.com/example/status/123'])));
  page.mockRejectedValue(new IngestionError('robots_disallowed', 'Blocked by site rules.'));
  const result = await discoverPublicEvidence('https://example.org', config, signal());
  expect(result).toMatchObject({ searchUsed: true, xSearchUsed: true, evidence: [] });
  expect(result.limitations.join(' ')).toContain('twitter_source_unreadable');
  expect(result.limitations.join(' ')).toContain('public_search_no_evidence');
  expect(JSON.stringify(result)).not.toContain('UNVERIFIED-MODEL-SUMMARY');
});

it('uses backup sources after six failures and reports safe reasons without leaking error details', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([
    ...Array.from({ length: 6 }, (_, i) => `https://blocked.example/${i}`),
    'https://news.example/company', 'https://x.com/example/status/123',
  ])));
  page.mockImplementation(async (url: string) => {
    if (url.includes('blocked.example') || url.includes('x.com')) {
      throw new IngestionError('robots_disallowed', 'SENSITIVE-UPSTREAM-BODY');
    }
    return { url, title: 'Public', text: 'Actually retrieved backup evidence' };
  });
  const result = await discoverPublicEvidence('https://example.org', config, signal());
  expect(result.evidence.map(e => e.url)).toEqual(['https://news.example/company']);
  expect(result.limitations.join(' ')).toContain('robots_disallowed');
  expect(result.limitations.join(' ')).toContain('twitter_source_unreadable');
  expect(result.limitations.join(' ')).not.toContain('twitter_search_no_sources');
  expect(JSON.stringify(result)).not.toContain('SENSITIVE-UPSTREAM-BODY');
});

it('reads another host before a slow first source exhausts the discovery deadline', async () => {
  const deadline = new AbortController();
  const nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
  const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === 120_000 ? deadline.signal : nativeTimeout(ms));
  try {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(['https://x.com/example/status/123', 'https://news.example/company'])));
    page.mockImplementation(async (url: string, signal: AbortSignal) => {
      signal.throwIfAborted();
      if (url.includes('news.example')) return { url, title: 'Public', text: 'Retrieved before the deadline' };
      await new Promise(resolve => setTimeout(resolve, 20));
      deadline.abort();signal.throwIfAborted();
    });
    const result = await discoverPublicEvidence('https://example.org', config, signal());
    expect(result.evidence.map(e => e.url)).toEqual(['https://news.example/company']);
    expect(result.limitations.join(' ')).toContain('public_search_time_limit');
    expect(result.limitations.join(' ')).not.toContain('public_search_no_evidence');
  } finally { spy.mockRestore(); }
});

it('stops after twelve candidates even when later candidates could be readable', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(Array.from({ length: 13 }, (_, i) => `https://news.example/${i + 1}`))));
  page.mockImplementation(async (url: string) => {
    if (!url.endsWith('/13')) throw new IngestionError('site_http_error', 'Inaccessible.');
    return { url, title: 'Beyond budget', text: 'Must not be retrieved' };
  });
  const result = await discoverPublicEvidence('https://example.org', config, signal());
  expect(result.evidence).toEqual([]);
  expect(result.limitations.join(' ')).toContain('news.example: site_http_error ×12');
});

it('distinguishes Twitter-targeted search from retrieved Twitter content when only website sources are cited', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(['https://example.org/about'])));
  page.mockResolvedValue({ url: 'https://example.org/about', title: 'About', text: 'Public company and team information' });
  const result = await discoverPublicEvidence('https://example.org', config, signal());
  expect(result).toMatchObject({ searchUsed: true, xSearchUsed: true });
  expect(result.evidence.map(e => e.url)).toEqual(['https://example.org/about']);
  expect(result.limitations.join(' ')).toContain('twitter_search_no_evidence');
  expect(result.limitations.join(' ')).toContain('twitter_search_no_sources');
  expect(result.limitations.join(' ')).not.toContain('public_search_no_evidence');
});

it('does not accept citations without a completed search, and discloses unconfirmed Twitter coverage', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(['https://example.org/about'], [])));
  const result = await discoverPublicEvidence('https://example.org', config, signal());
  expect(result).toMatchObject({ searchUsed: false, xSearchUsed: false, evidence: [] });
  expect(result.limitations.join(' ')).toContain('public_search_not_executed');
  expect(result.limitations.join(' ')).toContain('public_x_search_unconfirmed');
  expect(page).not.toHaveBeenCalled();
});

it('discloses a completed search without readable sources rather than inventing evidence', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
  const result = await discoverPublicEvidence('https://example.org', config, signal());
  expect(result.evidence).toEqual([]);expect(result.searchUsed).toBe(true);
  expect(result.limitations.join(' ')).toContain('public_search_no_evidence');
});

it('propagates unsupported search safely without falling back to another service', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('SECRET-UPSTREAM', { status: 400 }));vi.stubGlobal('fetch', fetcher);
  await expect(discoverPublicEvidence('https://example.org', config, signal())).rejects.toMatchObject({ code: 'unsupported_request' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('propagates cancellation during source retrieval', async () => {
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(['https://example.org'])));
  page.mockImplementation(async () => { controller.abort(new Error('cancelled'));throw new Error('aborted'); });
  await expect(discoverPublicEvidence('https://example.org', config, controller.signal)).rejects.toThrow('cancelled');
});
