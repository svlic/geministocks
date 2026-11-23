import { afterEach, expect, it, vi } from 'vitest';
const page = vi.hoisted(() => vi.fn());
vi.mock('../ingestion/website', async importOriginal => ({ ...await importOriginal<typeof import('../ingestion/website')>(), fetchPublicPage: page }));
import { discoverPublicEvidence } from './public-search';
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
const signal = () => new AbortController().signal;

it('uses only the submitted hostname and accepts retrieved pages, never search snippets', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({web:{results:[
    {url:'https://news.example.org/company',description:'invented financing $100M'},
    {url:'https://example.org/about',description:'invented customer'},
  ]}}));
  vi.stubGlobal('fetch', fetcher);
  page.mockImplementation(async (url: string) => ({url,title:'Source',text:'Actually retrieved text'}));
  const result = await discoverPublicEvidence('https://example.org/private?token=SECRET', 'private-key', signal());
  const [url, options] = fetcher.mock.calls[0];
  expect(url.origin).toBe('https://api.search.brave.com');expect(url.searchParams.get('q')).toBe('"example.org"');
  expect(options.headers['X-Subscription-Token']).toBe('private-key');
  expect(result.searchUsed).toBe(true);expect(result.evidence.map(e=>e.type)).toEqual(['third_party','official_website']);
  expect(result.evidence.every(e=>e.quoteOrSummary==='Actually retrieved text')).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/SECRET|invented|private-key/);
});

it('skips unsafe/inaccessible results, deduplicates URLs and bounds retrieval to four candidates', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({web:{results:[
    {url:'https://127.0.0.1/private'}, {url:'https://example.org/a'}, {url:'https://example.org/a'},
    {url:'https://news.example.org/b'}, {url:'https://news.example.org/c'}, {url:'https://news.example.org/d'},
  ]}})));
  page.mockImplementation(async (url: string) => { if(url.endsWith('/a'))throw new Error('blocked'); return {url,title:'Public',text:'Retrieved evidence'}; });
  const result = await discoverPublicEvidence('https://example.org', 'key', signal());
  expect(result.evidence.map(e=>e.url)).toEqual(['https://news.example.org/b','https://news.example.org/c','https://news.example.org/d']);
  expect(result.limitations.join(' ')).toContain('search_source_unreadable');
});

it('discloses an empty search without inventing evidence', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({web:{results:[]}})));
  const result = await discoverPublicEvidence('https://example.org', 'key', signal());
  expect(result.evidence).toEqual([]);expect(result.limitations.join(' ')).toContain('public_search_no_evidence');
});

it('rejects failed and oversized search responses without echoing upstream content', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('SECRET-UPSTREAM', {status:503})).mockResolvedValueOnce(new Response('x'.repeat(512_001)));
  vi.stubGlobal('fetch', fetcher);
  await expect(discoverPublicEvidence('https://example.org', 'key', signal())).rejects.toThrow('public_search_unavailable');
  await expect(discoverPublicEvidence('https://example.org', 'key', signal())).rejects.toThrow('public_search_response_limit');
});

it('propagates cancellation during source retrieval', async () => {
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({web:{results:[{url:'https://example.org'}]}})));
  page.mockImplementation(async () => { controller.abort(new Error('cancelled'));throw new Error('aborted'); });
  await expect(discoverPublicEvidence('https://example.org', 'key', controller.signal)).rejects.toThrow('cancelled');
});
