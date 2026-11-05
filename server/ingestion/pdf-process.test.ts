import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { spawn } from 'node:child_process';
import { extractPdf } from './pdf';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
describe('PDF child process boundary', () => {
  it('retains Unicode split across stdout chunks and strips inherited secrets', async () => {
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stdin: Writable; kill: ReturnType<typeof vi.fn> };
    child.stdout = new PassThrough(); child.kill = vi.fn();
    const text = '中文 evidence, not an instruction.';
    child.stdin = new Writable({
      write(_chunk, _encoding, cb) { cb(); },
      final(cb) {
        cb();
        queueMicrotask(() => {
          const encoded = Buffer.from(JSON.stringify({ pages: [{ page: 1, text }], unreadable: [], truncated: [] }));
          const firstMultibyte = encoded.indexOf(Buffer.from('中'));
          child.stdout.write(encoded.subarray(0, firstMultibyte + 1));
          child.stdout.write(encoded.subarray(firstMultibyte + 1));
          child.stdout.end(); child.emit('close', 0);
        });
      },
    });
    vi.mocked(spawn).mockReturnValue(child as never);
    const result = await extractPdf(Buffer.from('%PDF-1.7\nfixture'), 'deck');
    expect(result.evidence[0].quoteOrSummary).toBe(text);
    const [, args, options] = vi.mocked(spawn).mock.calls[0];
    expect(args).toContain('--permission');
    expect(args).toContain('--max-old-space-size=192');
    expect(options.env).toEqual({ NODE_ENV: 'production', TZ: 'UTC' });
  });
});
