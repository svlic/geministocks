import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { assertPublicUrl, fetchPublicPage } from './index';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('node:https', () => ({ request: vi.fn() }));
beforeEach(() => {
  vi.mocked(lookup).mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
  vi.mocked(request).mockImplementation(((url: URL, options: Record<string, unknown>, callback: (res: Readable) => void) => {
    expect(options.agent).toBe(false);
    expect(options.family).toBe(4);
    expect(options).not.toHaveProperty('rejectUnauthorized', false);
    const pinnedLookup = options.lookup as (host: string, opts: object, cb: (...args: unknown[]) => void) => void;
    const result = vi.fn(); pinnedLookup(url.hostname, {}, result);
    expect(result).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    const req = new EventEmitter() as EventEmitter & { end(): void };
    req.end = () => queueMicrotask(() => {
      const res = Readable.from([Buffer.from(url.pathname === '/robots.txt' ? '' : '<title>Real page</title><p>Public evidence from the retrieved page.</p><a href="/team">Team</a>')]);
      Object.assign(res, { statusCode: url.pathname === '/robots.txt' ? 404 : 200, headers: { 'content-type': 'text/html' } });
      callback(res);
    });
    return req;
  }) as never);
});
afterEach(() => vi.clearAllMocks());

describe('public page transport boundary', () => {
  it('up-front validation checks DNS without making an HTTP request', async () => {
    expect((await assertPublicUrl('https://example.com')).hostname).toBe('example.com');
    expect(request).not.toHaveBeenCalled();
    vi.mocked(lookup).mockResolvedValue([{ address: '10.0.0.1', family: 4 }] as never);
    await expect(assertPublicUrl('https://example.com')).rejects.toMatchObject({ code: 'unsafe_address' });
  });
  it('verifies a single actual page, pins both requests, never follows discovered links', async () => {
    await expect(fetchPublicPage('https://example.com')).resolves.toMatchObject({ url: 'https://example.com/', title: 'Real page', text: expect.stringContaining('Public evidence') });
    expect(request).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
