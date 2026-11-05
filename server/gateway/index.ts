export interface ModelConfig {
  provider: 'xai' | 'openai'; modelId: string; apiKey: string; baseUrl?: string;
  timeoutMs: number; maxOutputTokens: number; webSearch: boolean; xSearch: boolean; allowConfidential: boolean;
}
export type GatewayConfig = ModelConfig;
export interface ModelRequest { system: string; input: string; search?: boolean; maxTurns?: number; signal?: AbortSignal }
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

function endpoint(config: ModelConfig): string {
  if (!['xai', 'openai'].includes(config.provider) || typeof config.apiKey !== 'string' || !config.apiKey || typeof config.modelId !== 'string' || !config.modelId || config.modelId.length > 200 ||
    [config.webSearch, config.xSearch, config.allowConfidential].some(value => typeof value !== 'boolean') ||
    !Number.isInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 180_000 ||
    !Number.isInteger(config.maxOutputTokens) || config.maxOutputTokens < 1 || config.maxOutputTokens > 32_000) throw new GatewayError('invalid_config');
  let url: URL;
  try { url = new URL(config.baseUrl ?? (config.provider === 'xai' ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1')); }
  catch { throw new GatewayError('invalid_config'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443')) throw new GatewayError('invalid_config');
  // Native xAI tools must never be silently routed to a compatible proxy.
  if (config.provider === 'xai' && (url.origin !== 'https://api.x.ai' || url.pathname.replace(/\/$/, '') !== '/v1')) throw new GatewayError('invalid_config');
  return `${url.href.replace(/\/$/, '')}/${config.provider === 'xai' ? 'responses' : 'chat/completions'}`;
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

/** Server-only. Callers must pass ONLY public identity data to search calls.
 * allowConfidential is policy metadata: the orchestrator must check it before
 * sending deck text; the gateway cannot infer confidentiality from a string.
 */
export async function callModel(config: ModelConfig, request: ModelRequest): Promise<ModelResult> {
  const started = performance.now();
  const url = endpoint(config);
  const maxTurns = request.maxTurns ?? 3;
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 3 || typeof request.system !== 'string' || typeof request.input !== 'string' || request.system.length + request.input.length > 500_000) throw new GatewayError('invalid_config');
  const native = config.provider === 'xai';
  const tools: Array<{ type: string }> = [];
  if (native && request.search) {
    if (config.webSearch) tools.push({ type: 'web_search' });
    if (config.xSearch) tools.push({ type: 'x_search' });
  }
  const messages = [{ role: 'system', content: request.system }, { role: 'user', content: request.input }];
  const body = native
    ? { model: config.modelId, input: messages, max_output_tokens: config.maxOutputTokens, store: false, ...(tools.length ? { tools, max_turns: maxTurns } : {}) }
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
      let text = ''; const citations: ModelResult['citations'] = [];
      if (native) {
        if (data.status !== 'completed') throw new GatewayError(data.status === 'incomplete' ? 'incomplete' : 'invalid_response');
        const seen = new Set<string>();
        const addCitation = (value: unknown, title?: unknown) => {
          if (typeof value !== 'string') return;
          try {
            const parsed = new URL(value);
            if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || seen.has(parsed.href)) return;
            seen.add(parsed.href); citations.push({ url: parsed.href, title: typeof title === 'string' ? title.slice(0, 500) : parsed.hostname });
          } catch { /* Invalid official annotations are not accepted. */ }
        };
        for (const raw of array(data.output)) {
          const item = object(raw);
          if (item.type !== 'message' || item.role !== 'assistant') continue;
          for (const rawContent of array(item.content)) {
            const part = object(rawContent);
            if (part.type !== 'output_text' || typeof part.text !== 'string') continue;
            text += part.text;
            for (const rawAnnotation of array(part.annotations)) {
              const annotation = object(rawAnnotation);
              if (annotation.type === 'url_citation') addCitation(annotation.url, annotation.title);
            }
          }
        }
        for (const citation of array(data.citations)) addCitation(citation);
      } else {
        const choice = object(array(data.choices)[0]);
        if (choice.finish_reason === 'length' || choice.finish_reason === 'content_filter') throw new GatewayError('incomplete');
        const value = object(choice.message).content;
        if (typeof value === 'string') text = value;
      }
      if (!text.trim()) throw new GatewayError('invalid_response');
      const usage = data.usage ?? null;
      const details = object(object(usage).server_side_tool_usage_details);
      const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0;
      return { text, citations, usage,
        searchUsed: native && Boolean(request.search && config.webSearch && citations.length && positive(details.web_search_calls)),
        xSearchUsed: native && Boolean(request.search && config.xSearch && citations.length && positive(details.x_search_calls)),
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
