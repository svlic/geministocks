import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fetchPublicPage, validateWebsiteUrl } from '../ingestion/website';
import type { Evidence } from '../../shared/screening-schema';

const searchResponse = z.object({ web: z.object({ results: z.array(z.object({ url: z.string() })) }).optional() });

/** One domain-only discovery request. Search snippets and model-generated URLs are never evidence. */
export async function discoverPublicEvidence(website: string, apiKey: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const official = validateWebsiteUrl(website);
  const budget = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  const requestSignal = AbortSignal.any([budget, AbortSignal.timeout(12_000)]);
  const endpoint = new URL('https://api.search.brave.com/res/v1/web/search');
  // Even a submitted public URL may contain a private path or query token.
  endpoint.searchParams.set('q', `"${official.hostname}"`);
  endpoint.searchParams.set('count', '6');
  const response = await fetch(endpoint, {
    headers: { accept: 'application/json', 'X-Subscription-Token': apiKey },
    signal: requestSignal, redirect: 'error',
  });
  if (!response.ok || !response.body) {
    void response.body?.cancel().catch(() => {});
    throw new Error('public_search_unavailable');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      requestSignal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 512_000) throw new Error('public_search_response_limit');
      chunks.push(value);
    }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  const data = searchResponse.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  const evidence: Evidence[] = [], limitations: string[] = [];
  const seen = new Set<string>();
  for (const hit of (data.web?.results ?? []).slice(0, 6)) {
    signal.throwIfAborted();
    if (seen.size >= 4 || budget.aborted) break;
    try {
      const url = validateWebsiteUrl(hit.url);
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      const page = await fetchPublicPage(url.href, budget);
      if (!page.text.trim() || evidence.some(e => e.url === page.url)) continue;
      evidence.push({ id: `search-${randomUUID()}`, type: new URL(page.url).hostname === official.hostname ? 'official_website' : 'third_party',
        url: page.url, title: page.title, documentId: null, page: null, publishedAt: null,
        retrievedAt: new Date().toISOString(), quoteOrSummary: page.text });
    } catch {
      signal.throwIfAborted();
      limitations.push('search_source_unreadable: 部分搜索来源未能安全读取，未作为证据 / Some search sources could not be safely retrieved and were not used as evidence');
    }
  }
  if (budget.aborted) limitations.push('public_search_time_limit: 搜索补充达到时间上限，保留已读取来源 / Discovery time limit reached; retrieved sources retained');
  if (!evidence.length) limitations.push('public_search_no_evidence: 未取得可读取的补充来源，不代表公司没有公开信息 / No readable additional sources; not proof of absent public information');
  return { evidence, limitations: [...new Set(limitations)], searchUsed: true };
}
