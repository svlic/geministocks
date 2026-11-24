import { randomUUID } from 'node:crypto';
import { fetchPublicPage, validateWebsiteUrl } from '../ingestion/website';
import { IngestionError } from '../ingestion/types';
import { callModel, type ModelConfig } from '../gateway/index';
import type { Evidence } from '../../shared/screening-schema';
import { PUBLIC_RESEARCH_PROMPT } from './prompts';

/** Public-only native research. Neither Deck-derived summaries nor notes enter this call. */
export async function discoverPublicEvidence(website: string, config: ModelConfig, signal: AbortSignal) {
  const started = performance.now();
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
  const seen = new Set<string>(), candidates: URL[] = [];
  const failures = new Map<string, number>();
  const twitter = (url: URL) => /^(?:www\.)?(?:x|twitter)\.com$/i.test(url.hostname);
  let twitterAttempted = false;
  const recordFailure = (host: string, reason: string) => {
    const key = `${host}: ${reason}`;
    failures.set(key, (failures.get(key) ?? 0) + 1);
  };
  // Citations and tool-returned source URLs only nominate pages. Model prose and
  // snippets never enter the ledger, even when the original cannot be retrieved.
  for (const hit of search.searchUsed ? search.citations : []) {
    try {
      const url = validateWebsiteUrl(hit.url);
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      candidates.push(url);
    } catch {
      recordFailure('URL', 'unsafe_url');
    }
  }
  // Reserve an early slot for social coverage instead of starving it behind web
  // citations. Try backups after failures, but retain at most six actual pages.
  const socialIndex = candidates.findIndex(twitter);
  if (socialIndex > 2) candidates.splice(2, 0, candidates.splice(socialIndex, 1)[0]);
  const pending = candidates.slice(0, 12);
  while (pending.length && evidence.length < 6 && !budget.aborted) {
    signal.throwIfAborted();
    // Parallelize different hosts only; never race a site's crawl-delay rules.
    const batch: URL[] = [];
    for (let i = 0; i < pending.length && batch.length < Math.min(3, 6 - evidence.length);) {
      if (batch.some(url => url.hostname === pending[i].hostname)) i++;
      else batch.push(pending.splice(i, 1)[0]);
    }
    const pages = await Promise.all(batch.map(async url => {
      twitterAttempted ||= twitter(url);
      try {
        const page = await fetchPublicPage(url.href, budget);
        if (!page.text.trim()) throw new IngestionError('site_read_limit', 'No readable text.');
        return page;
      } catch (error) {
        signal.throwIfAborted();
        const reason = error instanceof IngestionError && [
          'unsafe_url', 'unsafe_address', 'cross_hostname', 'robots_disallowed', 'robots_unavailable', 'robots_crawl_delay',
          'site_timeout', 'site_network_error', 'site_http_error', 'site_read_limit', 'site_encoding', 'response_too_large', 'redirect_limit',
        ].includes(error.code) ? error.code : budget.aborted ? 'site_timeout' : 'site_read_error';
        recordFailure(url.hostname, reason);
        return null;
      }
    }));
    for (const page of pages) {
      if (!page || evidence.some(e => e.url === page.url)) continue;
      evidence.push({ id: `search-${randomUUID()}`, type: new URL(page.url).hostname === official.hostname ? 'official_website' : 'third_party',
        url: page.url, title: page.title, documentId: null, page: null, publishedAt: null,
        retrievedAt: new Date().toISOString(), quoteOrSummary: page.text });
    }
  }
  signal.throwIfAborted();
  if (failures.size) limitations.push(`search_source_unreadable: 部分候选来源未能安全读取，未作为证据；原因按域名汇总 / Some candidates could not be safely read and were excluded; reasons by host: ${[...failures].map(([reason, count]) => `${reason} ×${count}`).join('; ')}`);
  if (budget.aborted) limitations.push('public_search_time_limit: 搜索补充达到时间上限，保留已读取来源 / Discovery time limit reached; retrieved sources retained');
  if (search.xSearchUsed && !evidence.some(e => e.url && twitter(new URL(e.url)))) {
    if (!candidates.some(twitter)) limitations.push('twitter_search_no_evidence (twitter_search_no_sources): 已定向检索 Twitter/X，但工具未返回其来源链接；不代表没有相关信息 / Twitter/X-targeted search ran but returned no Twitter source URLs; not proof of absent information');
    else if (twitterAttempted) limitations.push('twitter_search_no_evidence (twitter_source_unreadable): 已尝试读取 Twitter/X 来源但未取得原文，具体原因见域名汇总；摘要未用于事实或评分 / Twitter/X sources were attempted but unreadable; see host reasons. Summaries were not used as facts or scores');
    else limitations.push('twitter_search_no_evidence (twitter_source_not_read): 工具返回了 Twitter/X 链接，但读取预算已用尽，未确认原文内容 / Twitter/X source URLs were returned but the retrieval budget was exhausted; originals remain unconfirmed');
  }
  if (!evidence.length) limitations.push('public_search_no_evidence: 未取得可读取的补充来源，不代表公司没有公开信息 / No readable additional sources; not proof of absent public information');
  return { evidence, limitations: [...new Set(limitations)], searchUsed: search.searchUsed, xSearchUsed: search.xSearchUsed, usage: search.usage, elapsedMs: Math.round(performance.now() - started) };
}
