import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import ipaddr from 'ipaddr.js';
import { load } from 'cheerio';
import robotsParser from 'robots-parser';
import { IngestionError, type IngestionResult } from './types';

const USER_AGENT = 'ScreeningReader';
const PAGE_BYTES = 1_000_000;
const TOTAL_BYTES = 4_000_000;
type Answer = { address: string; family: number };
type Reply = { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer };
interface Transport {
  resolve(host: string): Promise<Answer[]>;
  request(url: URL, address: string, signal: AbortSignal, maxBytes: number): Promise<Reply>;
}
const fail = (code: string, message: string): never => { throw new IngestionError(code, message); };

/** Conservative allowlist: transitional/mapped IPv6 is never a route to IPv4. */
export function isPublicAddress(address: string): boolean {
  try {
    const ip = ipaddr.parse(address);
    if (ip.range() !== 'unicast') return false;
    const blocked = ip.kind() === 'ipv4'
      ? ['192.0.0.0/24', '192.88.99.0/24']
      : ['2001::/23', '2001:db8::/32', '2002::/16', '3fff::/20'];
    if (ip.kind() === 'ipv6' && !ip.match(ipaddr.parseCIDR('2000::/3'))) return false;
    return !blocked.some(cidr => ip.match(ipaddr.parseCIDR(cidr)));
  } catch { return false; }
}

export function validateWebsiteUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { return fail('unsafe_url', 'A valid public HTTPS URL is required.'); }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
    host === 'localhost' || host.endsWith('.localhost') || (!host.includes('.') && !ipaddr.isValid(host)) || host.endsWith('.') ||
    (ipaddr.isValid(host) && !isPublicAddress(host))) {
    return fail('unsafe_url', 'Only public HTTPS URLs on port 443 without credentials are allowed.');
  }
  url.hash = '';
  return url;
}

/** Socket lookup is pinned to the validated address; TLS still verifies original hostname. */
const pinnedRequest: Transport['request'] = (url, address, signal, maxBytes) => new Promise((resolve, reject) => {
  const family = ipaddr.parse(address).kind() === 'ipv4' ? 4 : 6;
  const req = httpsRequest(url, {
    method: 'GET', signal, agent: false, family,
    headers: { 'user-agent': `${USER_AGENT}/1.0`, accept: 'text/html,text/plain;q=0.9', 'accept-encoding': 'identity' },
    lookup: (_host, _options, callback) => callback(null, address, family),
  }, res => {
    const sizeHeader = Number(res.headers['content-length']);
    if (Number.isFinite(sizeHeader) && sizeHeader > maxBytes) {
      res.destroy(); reject(new IngestionError('response_too_large', 'Website response exceeds the byte limit.')); return;
    }
    const chunks: Buffer[] = []; let size = 0;
    res.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) { res.destroy(new IngestionError('response_too_large', 'Website response exceeds the byte limit.')); return; }
      chunks.push(chunk);
    });
    res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    res.on('error', reject);
  });
  req.on('error', reject); req.end();
});

// Abort racing covers DNS resolvers as well as the network socket/body.
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function createWebsiteIngestor(transport: Transport, maxPages = 8) {
  return async (value: string, signal?: AbortSignal): Promise<IngestionResult> => {
    const initial = validateWebsiteUrl(value);
    const overall = AbortSignal.timeout(110_000);
    const rootSignal = signal ? AbortSignal.any([signal, overall]) : overall;
    const limitations: string[] = [];
    const evidence: IngestionResult['evidence'] = [];
    let total = 0;
    let robots: ReturnType<typeof robotsParser> | undefined;
    let lastRequest = 0;

    const retrieve = async (start: URL, forRobots = false): Promise<{ url: URL; reply: Reply; retrievedAt: string }> => {
      const timeout = AbortSignal.timeout(12_000);
      const requestSignal = AbortSignal.any([rootSignal, timeout]);
      let url = start;
      try {
        for (let redirects = 0; redirects <= 3; redirects++) {
          requestSignal.throwIfAborted();
          url = validateWebsiteUrl(url.href);
          if (url.hostname !== initial.hostname) fail('cross_hostname', 'Redirects must stay on the submitted hostname.');
          if (!forRobots && robots?.isAllowed(url.href, USER_AGENT) === false) fail('robots_disallowed', 'Website robots rules disallow this page.');
          const answers = await abortable(transport.resolve(url.hostname.replace(/^\[|\]$/g, '')), requestSignal);
          if (!answers.length || answers.some(a => !isPublicAddress(a.address))) fail('unsafe_address', 'DNS resolved to a nonpublic or reserved address.');
          const remaining = Math.min(forRobots ? 500_000 : PAGE_BYTES, TOTAL_BYTES - total);
          if (remaining <= 0) fail('response_too_large', 'Website total byte budget exhausted.');
          const delay = Math.max(0, (robots?.getCrawlDelay(USER_AGENT) ?? 0) * 1000 - (Date.now() - lastRequest));
          if (delay > 12_000) fail('robots_crawl_delay', 'Site crawl delay exceeds the request budget.');
          if (delay) await sleep(delay, undefined, { signal: requestSignal });
          lastRequest = Date.now();
          const reply = await abortable(transport.request(url, answers[0].address, requestSignal, remaining), requestSignal);
          total += reply.body.length;
          if (reply.body.length > remaining || total > TOTAL_BYTES) fail('response_too_large', 'Website byte budget exhausted.');
          if ([301, 302, 303, 307, 308].includes(reply.status)) {
            const location = reply.headers.location;
            if (typeof location !== 'string' || redirects === 3) return fail('redirect_limit', 'Invalid redirect or redirect limit reached.');
            url = new URL(location, url); continue;
          }
          return { url, reply, retrievedAt: new Date().toISOString() };
        }
        return fail('redirect_limit', 'Redirect limit reached.');
      } catch (error) {
        if (signal?.aborted) return fail('cancelled', 'Website ingestion cancelled.');
        if (timeout.aborted || overall.aborted) return fail('site_timeout', 'Website request exceeded its time limit.');
        if (error instanceof IngestionError) throw error;
        return fail('site_network_error', 'Website request or DNS lookup failed.');
      }
    };

    const robotsUrl = new URL('/robots.txt', initial);
    const robotsReply = await retrieve(robotsUrl, true);
    if (robotsReply.reply.status === 404 || robotsReply.reply.status === 410) robots = robotsParser(robotsUrl.href, '');
    else if (robotsReply.reply.status === 200) {
      if ((robotsReply.reply.headers['content-encoding'] && robotsReply.reply.headers['content-encoding'] !== 'identity') || /^\s*</.test(robotsReply.reply.body.toString('utf8'))) return fail('robots_unavailable', 'Robots response could not be safely interpreted.');
      robots = robotsParser(robotsUrl.href, robotsReply.reply.body.toString('utf8'));
    }
    else return fail('robots_unavailable', 'Robots rules could not be checked; crawling was not attempted.');

    const queue = [{ url: initial, depth: 0 }];
    const seen = new Set<string>();
    let pages = 0;
    while (queue.length && pages < Math.min(8, maxPages)) {
      if (signal?.aborted) return fail('cancelled', 'Website ingestion cancelled.');
      if (overall.aborted) return fail('site_timeout', 'Website ingestion exceeded its time limit.');
      const item = queue.shift()!;
      if (seen.has(item.url.href)) continue;
      seen.add(item.url.href);
      if (robots.isAllowed(item.url.href, USER_AGENT) === false) {
        limitations.push('robots_disallowed: A requested page was excluded by the website rules.'); continue;
      }
      pages++;
      try {
        const { url, reply, retrievedAt } = await retrieve(item.url);
        if (url.href !== item.url.href && seen.has(url.href)) continue;
        seen.add(url.href);
        if (reply.status !== 200) fail('site_http_error', `Website returned HTTP ${reply.status}.`);
        const contentType = reply.headers['content-type'];
        if (typeof contentType !== 'string' || !/^text\/html\b|^application\/xhtml\+xml\b/i.test(contentType)) {
          limitations.push('site_read_limit: Non-HTML page was not parsed.'); continue;
        }
        if (reply.headers['content-encoding'] && reply.headers['content-encoding'] !== 'identity') fail('site_encoding', 'Compressed responses are not accepted.');
        const $ = load(reply.body.toString('utf8'));
        const title = $('title').first().text().trim().slice(0, 300) || url.hostname;
        const published = $('meta[property="article:published_time"],meta[name="date"]').first().attr('content');
        const publishedAt = published && Number.isFinite(Date.parse(published)) ? new Date(published).toISOString() : null;
        $('script,style,noscript,template,svg,iframe,object,form,[hidden],[aria-hidden="true"]').remove();
        $('[style]').each((_i, el) => {
          const style = $(el).attr('style');
          if (style && /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0\b/i.test(style)) $(el).remove();
        });
        const text = $('body').text().replace(/\s+/g, ' ').trim();
        if (text.length < 30) limitations.push('site_read_limit: Little readable text; JavaScript or access restrictions may limit reading.');
        if (text) evidence.push({ id: `web-${randomUUID()}`, type: 'official_website', title, url: url.href, documentId: null, page: null, publishedAt, retrievedAt, quoteOrSummary: text.slice(0, 12_000) });
        if (text.length > 12_000) limitations.push('site_text_truncated: Page evidence was bounded to 12000 characters.');
        if (item.depth < 2) {
          const links: URL[] = [];
          $('a[href]').each((_i, el) => {
            if (links.length >= 80) return;
            try {
              const candidate = validateWebsiteUrl(new URL($(el).attr('href')!, url).href);
              if (candidate.hostname === initial.hostname && !candidate.search && !seen.has(candidate.href) && /\/(about|team|product|technology|docs|pricing|company)(\/|$|[-_])/i.test(candidate.pathname)) links.push(candidate);
            } catch { /* Unsafe/unrelated links are not crawled. */ }
          });
          for (const link of links) if (queue.length < 80) queue.push({ url: link, depth: item.depth + 1 });
        }
      } catch (error) {
        if (error instanceof IngestionError && ['unsafe_url', 'unsafe_address', 'cross_hostname', 'cancelled'].includes(error.code)) throw error;
        if (pages === 1 && !evidence.length) throw error;
        limitations.push(`${error instanceof IngestionError ? error.code : 'site_read_error'}: A secondary page could not be read.`);
      }
    }
    return { evidence, limitations: [...new Set(limitations)] };
  };
}

const transport: Transport = { resolve: host => lookup(host, { all: true, verbatim: true }), request: pinnedRequest };
export const ingestWebsite = createWebsiteIngestor(transport);
const ingestOnePage = createWebsiteIngestor(transport, 1);

/** Job-creation check. Repeated by the fetcher to prevent DNS rebinding. */
export async function assertPublicUrl(value: string): Promise<URL> {
  const url = validateWebsiteUrl(value);
  const signal = AbortSignal.timeout(12_000);
  try {
    const answers = await abortable(transport.resolve(url.hostname.replace(/^\[|\]$/g, '')), signal);
    if (!answers.length || answers.some(a => !isPublicAddress(a.address))) fail('unsafe_address', 'DNS resolved to a nonpublic or reserved address.');
    return url;
  } catch (error) {
    if (error instanceof IngestionError) throw error;
    return fail(signal.aborted ? 'site_timeout' : 'site_network_error', 'Public DNS validation failed.');
  }
}

export async function fetchPublicPage(value: string, signal?: AbortSignal): Promise<{ url: string; title: string; text: string }> {
  const result = await ingestOnePage(value, signal);
  const page = result.evidence[0];
  if (!page?.url) return fail('site_read_limit', result.limitations[0] ?? 'No readable public page was retrieved.');
  return { url: page.url, title: page.title, text: page.quoteOrSummary };
}
