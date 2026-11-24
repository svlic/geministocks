export interface ModelConfig {
  provider: 'openai'; modelId: string; apiKey: string; baseUrl?: string;
  timeoutMs: number; maxOutputTokens: number; allowConfidential: boolean;
}
export type GatewayConfig = ModelConfig;
export interface ModelRequest { system: string; input: string; signal?: AbortSignal; webSearch?: boolean }
export interface ModelResult {
  text: string; citations: Array<{ url: string; title: string }>; usage: unknown;
  searchUsed: boolean; xSearchUsed: boolean; elapsedMs: number;
}
export type GatewayErrorCode = 'invalid_config' | 'authentication' | 'permission' | 'model_not_found' |
  'unsupported_request' | 'rate_limit' | 'unavailable' | 'network' | 'timeout' | 'cancelled' | 'invalid_response' | 'incomplete';
/** Never includes upstream response bodies, prompts, URL credentials or API keys. */
export class GatewayError extends Error {
  constructor(public readonly code: GatewayErrorCode, public readonly retryable = false, public readonly status?: number) {
    super(`Model request failed (${code}).`); this.name = 'GatewayError';
  }
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

function endpoint(config: ModelConfig, webSearch: boolean): string {
  if (config.provider !== 'openai' || typeof config.apiKey !== 'string' || !config.apiKey || typeof config.modelId !== 'string' || !config.modelId || config.modelId.length > 200 ||
    typeof config.allowConfidential !== 'boolean' ||
    !Number.isInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 600_000 ||
    !Number.isInteger(config.maxOutputTokens) || config.maxOutputTokens < 1 || config.maxOutputTokens > 32_000) throw new GatewayError('invalid_config');
  let url: URL;
  try { url = new URL(config.baseUrl ?? 'https://api.openai.com/v1'); }
  catch { throw new GatewayError('invalid_config'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443')) throw new GatewayError('invalid_config');
  return `${url.href.replace(/\/$/, '')}/${webSearch ? 'responses' : 'chat/completions'}`;
}
function httpError(status: number): GatewayError {
  const code: GatewayErrorCode = status === 401 ? 'authentication' : status === 403 ? 'permission' : status === 404 ? 'model_not_found' : status === 429 ? 'rate_limit' : status >= 500 ? 'unavailable' : 'unsupported_request';
  return new GatewayError(code, status === 429 || status === 502 || status === 503 || status === 504, status);
}

async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) { promise.catch(() => {}); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new GatewayError('invalid_response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await withAbort(reader.read(), signal);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 2_000_000) throw new GatewayError('invalid_response');
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error instanceof GatewayError) throw error;
    throw new GatewayError('invalid_response');
  } finally { reader.releaseLock(); }
}

/** Server-only. allowConfidential is policy metadata: the orchestrator must check it before
 * sending deck text; the gateway cannot infer confidentiality from a string.
 */
export async function callModel(config: ModelConfig, request: ModelRequest): Promise<ModelResult> {
  const started = performance.now();
  const url = endpoint(config, request.webSearch === true);
  if (typeof request.system !== 'string' || typeof request.input !== 'string' || request.system.length + request.input.length > 500_000) throw new GatewayError('invalid_config');
  const messages = [{ role: 'system', content: request.system }, { role: 'user', content: request.input }];
  const body = request.webSearch
    ? { model: config.modelId, input: messages, tools: [{ type: 'web_search' }], tool_choice: 'required', max_tool_calls: 6, max_output_tokens: config.maxOutputTokens }
    : { model: config.modelId, messages, max_tokens: config.maxOutputTokens };
  const timeout = AbortSignal.timeout(config.timeoutMs);
  const signal = request.signal ? AbortSignal.any([timeout, request.signal]) : timeout;
  const aborted = () => { if (request.signal?.aborted) throw new GatewayError('cancelled'); if (timeout.aborted) throw new GatewayError('timeout', true); };
  // The timeout covers both attempts, response bytes and retry delay together.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      aborted();
      const response = await withAbort(fetch(url, { method: 'POST', headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal, redirect: 'error' }), signal);
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        const error = httpError(response.status);
        if (error.retryable && attempt === 0) {
          await new Promise<void>((resolve, reject) => {
            const cancel = () => { clearTimeout(timer); reject(new GatewayError('cancelled')); };
            const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, 100);
            if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });
          });
          continue;
        }
        throw error;
      }
      const data = object(await readJson(response, signal));
      aborted();
      if (request.webSearch) {
        if (data.status !== 'completed' || data.error) throw new GatewayError('incomplete');
        const output = array(data.output).map(object);
        const searches = output.filter(item => item.type === 'web_search_call' && item.status === 'completed');
        const searchUsed = searches.length > 0;
        const queries = searches.flatMap(item => {
          const action = object(item.action);
          return [action.query, ...array(action.queries)];
        });
        // X/Twitter coverage is about the searched site, not a native x_search tool name.
        const xSearchUsed = queries.some(query => typeof query === 'string' && /(?:^|\s|https?:\/\/|site:)(?:www\.)?(?:x\.com|twitter\.com)(?=\/|\s|$)/i.test(query));
        const parts = output.filter(item => item.type === 'message' && item.role === 'assistant')
          .flatMap(item => array(item.content).map(object)).filter(part => part.type === 'output_text');
        const text = parts.map(part => typeof part.text === 'string' ? part.text : '').join('\n');
        if (!text.trim()) throw new GatewayError('invalid_response');
        const citations: ModelResult['citations'] = [];
        if (searchUsed) for (const annotation of parts.flatMap(part => array(part.annotations).map(object))) {
          if (annotation.type !== 'url_citation' || typeof annotation.url !== 'string') continue;
          try {
            const source = new URL(annotation.url);
            if (source.protocol !== 'https:' || source.username || source.password || source.port && source.port !== '443') continue;
            source.hash = '';
            if (citations.length >= 24 || citations.some(c => c.url === source.href)) continue;
            citations.push({ url: source.href, title: typeof annotation.title === 'string' ? annotation.title.slice(0, 300) : source.hostname });
          } catch { /* Invalid citations are not discovery candidates. */ }
        }
        return { text, citations, usage: data.usage ?? null, searchUsed, xSearchUsed, elapsedMs: Math.round(performance.now() - started) };
      }
      const choice = object(array(data.choices)[0]);
      if (choice.finish_reason === 'length' || choice.finish_reason === 'content_filter') throw new GatewayError('incomplete');
      const text = object(choice.message).content;
      if (typeof text !== 'string' || !text.trim()) throw new GatewayError('invalid_response');
      const usage = data.usage ?? null;
      return { text, citations: [], usage, searchUsed: false, xSearchUsed: false,
        elapsedMs: Math.round(performance.now() - started) };
    } catch (error) {
      aborted();
      if (error instanceof GatewayError) throw error;
      // Ambiguous network/timeout errors may already have incurred model spend.
      // Never blindly replay them. Only explicit HTTP rejections get one retry.
      throw new GatewayError('network', true);
    }
  }
  throw new GatewayError('unavailable', true);
}
