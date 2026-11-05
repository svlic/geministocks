import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { IngestionError, type IngestionResult } from './types';

/** PDF bytes stay on pipes, not disk; the parser inherits no application secrets. */
export async function extractPdf(buffer: Buffer, documentId: string, signal?: AbortSignal): Promise<IngestionResult> {
  if (buffer.length > 25 * 1024 * 1024) throw new IngestionError('pdf_too_large', 'PDF exceeds 25 MB.');
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw new IngestionError('invalid_pdf', 'File does not have a PDF signature.');
  if (!documentId || documentId.length > 200) throw new IngestionError('invalid_document_id', 'A valid document ID is required.');
  if (signal?.aborted) throw new IngestionError('cancelled', 'PDF extraction cancelled.');
  const childPath = fileURLToPath(new URL('./pdf-child.mjs', import.meta.url));
  const projectRoot = resolve(dirname(childPath), '../..');
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [
      '--max-old-space-size=192', '--max-semi-space-size=16', '--permission',
      `--allow-fs-read=${dirname(childPath)}`, `--allow-fs-read=${resolve(projectRoot, 'node_modules')}`,
      childPath,
    ], { cwd: projectRoot, env: { NODE_ENV: 'production', TZ: 'UTC' }, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = ''; let settled = false;
    const finish = (error?: IngestionError, result?: IngestionResult) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      child.kill('SIGKILL');
      if (error) reject(error); else resolveResult(result!);
    };
    const cancel = () => finish(new IngestionError('cancelled', 'PDF extraction cancelled.'));
    const timer = setTimeout(() => finish(new IngestionError('pdf_timeout', 'PDF parsing exceeded its 20 second resource budget.')), 20_000);
    signal?.addEventListener('abort', cancel, { once: true });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (Buffer.byteLength(output) > 1_000_000) finish(new IngestionError('pdf_output_limit', 'PDF parser output exceeds its resource budget.'));
    });
    child.on('error', () => finish(new IngestionError('pdf_parser_unavailable', 'Isolated PDF parser could not start.')));
    child.stdin.on('error', () => { /* Child exit/error handler reports a sanitized failure. */ });
    child.on('close', code => {
      if (settled) return;
      if (code !== 0) { finish(new IngestionError('pdf_parse_failed', 'PDF parser failed or exceeded its memory budget.')); return; }
      try {
        const parsed: unknown = JSON.parse(output);
        if (!parsed || typeof parsed !== 'object') throw new Error();
        const data = parsed as { error?: string; pages?: { page: number; text: string }[]; unreadable?: number[]; truncated?: number[] };
        if (data.error) {
          finish(new IngestionError(data.error === 'pdf_page_limit' ? 'pdf_page_limit' : 'invalid_pdf', data.error === 'pdf_page_limit' ? 'PDF exceeds 40 pages.' : 'PDF could not be parsed; it may be damaged or encrypted.')); return;
        }
        if (!Array.isArray(data.pages) || data.pages.length > 40 || !Array.isArray(data.unreadable) || !Array.isArray(data.truncated)) throw new Error();
        const validPage = (n: unknown) => Number.isInteger(n) && Number(n) >= 1 && Number(n) <= 40;
        if (!data.unreadable.every(validPage) || !data.truncated.every(validPage)) throw new Error();
        const seen = new Set<number>();
        const retrievedAt = new Date().toISOString();
        const evidence = data.pages.map(item => {
          if (!validPage(item.page) || typeof item.text !== 'string' || item.text.length > 12_000 || seen.has(item.page)) throw new Error();
          seen.add(item.page);
          return { id: `pdf-${randomUUID()}`, type: 'uploaded_deck' as const, title: `Uploaded deck — page ${item.page}`, url: null, documentId, page: item.page, publishedAt: null, retrievedAt, quoteOrSummary: item.text };
        });
        const limitations: string[] = [];
        if (data.unreadable.length) limitations.push(`pdf_unreadable_pages: Pages ${data.unreadable.join(', ')} contain little or no extractable text (possibly scans or charts). OCR/visual extraction is not configured; their content has not been inferred.`);
        if (data.truncated.length) limitations.push(`pdf_text_truncated: Pages ${data.truncated.join(', ')} were bounded to 12000 characters.`);
        finish(undefined, { evidence, limitations });
      } catch { finish(new IngestionError('pdf_parse_failed', 'PDF parser returned invalid output.')); }
    });
    child.stdin.end(buffer);
  });
}
