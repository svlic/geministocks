import { afterEach, describe, expect, it, vi } from 'vitest';
import { callModel, type ModelConfig } from './index';

const config: ModelConfig = { provider: 'openai', modelId: 'configured-model', apiKey: 'secret-key', timeoutMs: 1000, maxOutputTokens: 400, allowConfidential: false };
afterEach(() => vi.unstubAllGlobals());
describe('model gateway', () => {
  it.each([undefined, 'https://compatible.example/custom/v1/'])('uses text-only Chat Completions at %s without treating prose links as citations', async baseUrl => {
    const usage = { total_tokens: 20, server_side_tool_usage_details: { web_search_calls: 1 } };
    const fetcher = vi.fn(async () => Response.json({ choices: [{ message: { content: 'I searched https://fake.example' } }], citations: ['https://fake.example'], usage })); vi.stubGlobal('fetch', fetcher);
    const result = await callModel({ ...config, baseUrl }, { system: 'Policy', input: 'Data' });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${baseUrl?.replace(/\/$/, '') ?? 'https://api.openai.com/v1'}/chat/completions`);
    expect(JSON.parse(String(init.body))).toEqual({ model: 'configured-model', messages: [{ role: 'system', content: 'Policy' }, { role: 'user', content: 'Data' }], max_tokens: 400 });
    expect(result).toMatchObject({ text: 'I searched https://fake.example', searchUsed: false, xSearchUsed: false, citations: [], usage });
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
    await expect(callModel({ ...config, maxOutputTokens: 0 }, { system: '', input: '' })).rejects.toMatchObject({ code: 'invalid_config' });
    await expect(callModel({ ...config, baseUrl: 'http://internal/' }, { system: '', input: '' })).rejects.toMatchObject({ code: 'invalid_config' });
    await expect(callModel({ ...config, timeoutMs: 600001 }, { system: '', input: '' })).rejects.toMatchObject({ code: 'invalid_config' });
  });
  it('accepts the extended PDF understanding timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: 'Complete answer' } }] })));
    await expect(callModel({ ...config, timeoutMs: 300000 }, { system: '', input: '' })).resolves.toMatchObject({ text: 'Complete answer' });
  });
  it('aborts within timeout and does not retry ambiguous network failures', async () => {
    const fetcher = vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('abort')))));
    vi.stubGlobal('fetch', fetcher);
    await expect(callModel({ ...config, timeoutMs: 20 }, { system: '', input: '' })).rejects.toMatchObject({ code: 'timeout' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not claim completed output on truncation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: 'Truncated' }, finish_reason: 'length' }] })));
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
