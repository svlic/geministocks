import { randomUUID } from 'node:crypto';
import { fetchPublicPage, validateWebsiteUrl } from '../ingestion/website';
import { callModel, type GatewayConfig } from '../gateway/index';
import type { Evidence } from '../../shared/screening-schema';
import { PUBLIC_RESEARCH_PROMPT } from './prompts';

/** Public-only native research. Neither Deck-derived summaries nor notes enter this call. */
export async function discoverPublicEvidence(website: string, config: GatewayConfig, signal: AbortSignal) {
  signal.throwIfAborted();
  const official = validateWebsiteUrl(website);
  const budget = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
  const search = await callModel({ ...config, timeoutMs: Math.min(config.timeoutMs, 90_000), maxOutputTokens: Math.min(config.maxOutputTokens, 4000) }, {
    system: PUBLIC_RESEARCH_PROMPT,
    input: JSON.stringify({ publicWebsite: official.origin }),
    webSearch: true, signal: budget,
  });
  const evidence: Evidence[] = [], limitations: string[] = [];
  if (!search.searchUsed) limitations.push('public_search_not_executed: 模型未返回已完成的搜索工具记录，未将其回答作为搜索证据 / No completed search tool call; model prose is not search evidence');
  if (!search.xSearchUsed) limitations.push('public_x_search_unconfirmed: 未确认执行 Twitter/X 定向检索，不代表项目没有相关信息 / Twitter/X-targeted search was not confirmed; not proof of absent information');
  const seen = new Set<string>();
  // Only structured citations accompanied by a completed tool call can nominate pages.
  // The model's summary and bare prose URLs never enter the evidence ledger.
  for (const hit of search.searchUsed ? search.citations : []) {
    signal.throwIfAborted();
    if (seen.size >= 6 || budget.aborted) break;
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
      if (/^https:\/\/(?:www\.)?(?:x|twitter)\.com\//i.test(hit.url)) {
        limitations.push('twitter_source_unreadable: 搜索引用了 Twitter/X 页面，但无法读取原文；摘要未用于事实或评分 / A Twitter/X page was cited but its original text was inaccessible; summaries were not used as facts or scores');
      }
    }
  }
  if (budget.aborted) limitations.push('public_search_time_limit: 搜索补充达到时间上限，保留已读取来源 / Discovery time limit reached; retrieved sources retained');
  if (search.xSearchUsed && !evidence.some(e => e.url && /^https:\/\/(?:www\.)?(?:x|twitter)\.com\//i.test(e.url))) {
    limitations.push('twitter_search_no_evidence: 已定向检索 Twitter/X，但未取得可读取的原文，不代表项目没有相关信息 / Twitter/X-targeted search executed, but no readable original was retrieved; not proof of absent information');
  }
  if (!evidence.length) limitations.push('public_search_no_evidence: 未取得可读取的补充来源，不代表公司没有公开信息 / No readable additional sources; not proof of absent public information');
  return { evidence, limitations: [...new Set(limitations)], searchUsed: search.searchUsed, xSearchUsed: search.xSearchUsed, usage: search.usage, elapsedMs: search.elapsedMs };
}
