import { afterEach, describe, expect, it, vi } from 'vitest';
import { callModel, type ModelConfig } from './index';

const config: ModelConfig = { provider: 'xai', modelId: 'configured-model', apiKey: 'secret-key', timeoutMs: 1000, maxOutputTokens: 400, webSearch: true, xSearch: true, allowConfidential: false };
afterEach(() => vi.unstubAllGlobals());
const reply = (usage: unknown = { server_side_tool_usage_details: { web_search_calls: 1, x_search_calls: 1, x_posts_fetched: 3 } }, annotations: unknown[] = [{ type: 'url_citation', url: 'https://example.com/source', title: 'Source' }]) => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Evidence text', annotations }] }], usage });
describe('model gateway', () => {
  it('sends native Responses tools, bounded turns, returns real annotations and usage', async () => {
    const fetcher = vi.fn(async () => Response.json(reply())); vi.stubGlobal('fetch', fetcher);
    const result = await callModel(config, { system: 'Fixed policy', input: 'Public company identity', search: true, maxTurns: 2 });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.x.ai/v1/responses');
    expect(JSON.parse(String(init.body))).toMatchObject({ tools: [{ type: 'web_search' }, { type: 'x_search' }], max_turns: 2, max_output_tokens: 400, store: false });
    expect(result).toMatchObject({ text: 'Evidence text', searchUsed: true, xSearchUsed: true, citations: [{ url: 'https://example.com/source', title: 'Source' }] });
    expect(result.usage).toEqual(reply().usage);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });
  it('does not infer search success from prose, tools offered, or attempted calls', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(reply({}, []))));
    const result = await callModel(config, { system: '', input: 'I searched https://fake.example', search: true });
    expect(result.searchUsed).toBe(false); expect(result.xSearchUsed).toBe(false); expect(result.citations).toEqual([]);
  });
  it('requires citations as well as usage before claiming verified search', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(reply(undefined, []))));
    const result = await callModel(config, { system: '', input: '', search: true });
    expect(result.searchUsed).toBe(false); expect(result.xSearchUsed).toBe(false);
  });
  it('OpenAI-compatible is text-only even when asked to search', async () => {
    const fetcher = vi.fn(async () => Response.json({ choices: [{ message: { content: 'Text only' } }], usage: { total_tokens: 20 } })); vi.stubGlobal('fetch', fetcher);
    const result = await callModel({ ...config, provider: 'openai' }, { system: 'Policy', input: 'Data', search: true });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(JSON.parse(String(init.body))).not.toHaveProperty('tools');
    expect(result).toMatchObject({ text: 'Text only', searchUsed: false, xSearchUsed: false, citations: [] });
  });
  it('retries an explicit transient rejection only once, sanitizes errors', async () => {
    const fetcher = vi.fn(async () => new Response('secret-key sensitive upstream detail', { status: 503 })); vi.stubGlobal('fetch', fetcher);
    await expect(callModel(config, { system: '', input: '' })).rejects.toMatchObject({ code: 'unavailable', retryable: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(callModel(config, { system: '', input: '' })).rejects.not.toThrow(/secret-key/);
  });
  it.each([[401, 'authentication'], [403, 'permission'], [404, 'model_not_found'], [400, 'unsupported_request']])('classifies HTTP %s without retry', async (status, code) => {
    const fetcher = vi.fn(async () => new Response('sensitive', { status: Number(status) })); vi.stubGlobal('fetch', fetcher);
    await expect(callModel(config, { system: '', input: '' })).rejects.toMatchObject({ code });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid budgets and non-HTTPS base URL', async () => {
    await expect(callModel(config, { system: '', input: '', maxTurns: 4 })).rejects.toMatchObject({ code: 'invalid_config' });
    await expect(callModel({ ...config, baseUrl: 'http://internal/' }, { system: '', input: '' })).rejects.toMatchObject({ code: 'invalid_config' });
  });
  it('aborts within timeout and does not retry ambiguous network failures', async () => {
    const fetcher = vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('abort')))));
    vi.stubGlobal('fetch', fetcher);
    await expect(callModel({ ...config, timeoutMs: 20 }, { system: '', input: '' })).rejects.toMatchObject({ code: 'timeout' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not claim completed output on truncation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...reply(), status: 'incomplete' })));
    await expect(callModel(config, { system: '', input: '' })).rejects.toMatchObject({ code: 'incomplete' });
  });
  it('bounds a stalled response body, not just response headers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start() { /* No bytes or close. */ } }))));
    await expect(callModel({ ...config, timeoutMs: 20 }, { system: '', input: '' })).rejects.toMatchObject({ code: 'timeout' });
  }, 1000);
  it('rejects oversized upstream output without trusting it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('a'.repeat(2_000_001))));
    await expect(callModel(config, { system: '', input: '' })).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('honors caller cancellation before spending tokens', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(callModel(config, { system: '', input: '', signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
