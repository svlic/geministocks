import { describe, expect, it, vi } from 'vitest';
import { createWebsiteIngestor, isPublicAddress, validateWebsiteUrl } from './website';

describe('website safety', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '192.0.0.1', '192.0.2.1', '198.18.0.1', '224.0.0.1',
    '255.255.255.255', '::', '::1', 'fc00::1', 'fe80::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:8.8.8.8', '64:ff9b::a00:1', '2001:db8::1', '2002:a00:1::'])('rejects %s', ip => {
    expect(isPublicAddress(ip)).toBe(false);
  });
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('accepts %s', ip => {
    expect(isPublicAddress(ip)).toBe(true);
  });
  it.each(['http://example.com', 'https://localhost', 'https://example.com:444', 'https://user:pass@example.com', 'https://127.1', 'file:///etc/passwd'])('rejects unsafe URL %s', url => {
    expect(() => validateWebsiteUrl(url)).toThrow();
  });
  it('fails closed for mixed public and private DNS answers without requesting', async () => {
    const request = vi.fn();
    const ingest = createWebsiteIngestor({ resolve: async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }], request });
    await expect(ingest('https://example.com')).rejects.toMatchObject({ code: 'unsafe_address' });
    expect(request).not.toHaveBeenCalled();
  });
  it('obeys robots, removes hidden content, bounds pages and stays on hostname', async () => {
    const request = vi.fn(async (url: URL, address: string) => {
      expect(address).toBe('8.8.8.8');
      return { status: 200, headers: { 'content-type': url.pathname === '/robots.txt' ? 'text/plain' : 'text/html' },
        body: Buffer.from(url.pathname === '/robots.txt' ? 'User-agent: *\nDisallow: /team\n' : '<title>Company</title><script>evil</script><p hidden>secret</p><p>Useful product.</p><a href="/team">Team</a><a href="https://other.example/about">Other</a>' + Array.from({ length: 15 }, (_, i) => `<a href="/product/${i}">Product</a>`).join('')) };
    });
    const result = await createWebsiteIngestor({ resolve: async () => [{ address: '8.8.8.8', family: 4 }], request })('https://example.com');
    expect(result.evidence).toHaveLength(8);
    expect(result.evidence[0]).toMatchObject({ type: 'official_website', page: null, publishedAt: null });
    expect(result.evidence[0].quoteOrSummary).not.toMatch(/evil|secret/);
    expect(Date.parse(result.evidence[0].retrievedAt)).toBeGreaterThan(Date.now() - 10000);
    expect(request.mock.calls.every(([url]) => url.hostname === 'example.com' && url.pathname !== '/team')).toBe(true);
  });
  it('checks redirects and never contacts a redirected private host', async () => {
    const request = vi.fn(async (url: URL) => url.pathname === '/robots.txt'
      ? { status: 404, headers: {}, body: Buffer.alloc(0) }
      : { status: 302, headers: { location: 'https://127.0.0.1/admin' }, body: Buffer.alloc(0) });
    await expect(createWebsiteIngestor({ resolve: async () => [{ address: '8.8.8.8', family: 4 }], request })('https://example.com')).rejects.toMatchObject({ code: 'unsafe_url' });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('does not crawl when robots retrieval fails', async () => {
    const request = vi.fn(async () => ({ status: 503, headers: {}, body: Buffer.alloc(0) }));
    await expect(createWebsiteIngestor({ resolve: async () => [{ address: '8.8.8.8', family: 4 }], request })('https://example.com')).rejects.toMatchObject({ code: 'robots_unavailable' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('enforces byte budget even on injected transport', async () => {
    const request = vi.fn(async () => ({ status: 200, headers: {}, body: Buffer.alloc(2_000_001) }));
    await expect(createWebsiteIngestor({ resolve: async () => [{ address: '8.8.8.8', family: 4 }], request })('https://example.com')).rejects.toMatchObject({ code: 'response_too_large' });
  });
  it('re-resolves the same hostname after redirects to stop rebinding', async () => {
    const resolve = vi.fn().mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]).mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]).mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    const request = vi.fn(async (url: URL) => url.pathname === '/robots.txt' ? { status: 404, headers: {}, body: Buffer.alloc(0) } : { status: 302, headers: { location: '/about' }, body: Buffer.alloc(0) });
    await expect(createWebsiteIngestor({ resolve, request })('https://example.com')).rejects.toMatchObject({ code: 'unsafe_address' });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('checks robots before requesting a redirected destination', async () => {
    const request = vi.fn(async (url: URL) => url.pathname === '/robots.txt' ? { status: 200, headers: {}, body: Buffer.from('User-agent: *\nDisallow: /private') } : { status: 302, headers: { location: '/private' }, body: Buffer.alloc(0) });
    await expect(createWebsiteIngestor({ resolve: async () => [{ address: '8.8.8.8', family: 4 }], request })('https://example.com')).rejects.toMatchObject({ code: 'robots_disallowed' });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('times out stalled DNS as well as HTTP at the configured 12 second boundary', async () => {
    const nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
    const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => nativeTimeout(ms === 12_000 ? 20 : ms));
    try {
      const request = vi.fn();
      await expect(createWebsiteIngestor({ resolve: () => new Promise(() => {}), request })('https://example.com')).rejects.toMatchObject({ code: 'site_timeout' });
      expect(spy).toHaveBeenCalledWith(12_000);
      expect(request).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
  it('honors cancellation without starting an HTTP request', async () => {
    const request = vi.fn();
    await expect(createWebsiteIngestor({ resolve: async () => [{ address: '8.8.8.8', family: 4 }], request })('https://example.com', AbortSignal.abort())).rejects.toMatchObject({ code: 'cancelled' });
    expect(request).not.toHaveBeenCalled();
  });
});
