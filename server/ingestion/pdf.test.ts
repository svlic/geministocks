import { describe, expect, it } from 'vitest';
import { extractPdf } from './pdf';

// Small valid text/blank PDF fixtures generated in memory, never confidential data.
function pdf(pages: number, text = true) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => `${3 + i * 2} 0 R`).join(' ')}] >>`];
  for (let i = 0; i < pages; i++) {
    const stream = text ? `BT /F1 12 Tf 30 80 Td (Company page ${i + 1} product and customer evidence.) Tj ET` : '';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${4 + i * 2} 0 R >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let data = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(data.length); data += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = data.length;
  data += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('');
  return Buffer.from(data + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}

describe('isolated PDF extraction', () => {
  it('rejects non-PDF and oversize inputs before parsing', async () => {
    await expect(extractPdf(Buffer.from('not pdf'), 'deck')).rejects.toMatchObject({ code: 'invalid_pdf' });
    await expect(extractPdf(Buffer.alloc(25 * 1024 * 1024 + 1), 'deck')).rejects.toMatchObject({ code: 'pdf_too_large' });
  });
  it('returns actual page evidence and document ID', async () => {
    const result = await extractPdf(pdf(2), 'private-deck');
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[1]).toMatchObject({ type: 'uploaded_deck', documentId: 'private-deck', url: null, page: 2, publishedAt: null });
    expect(result.evidence[1].quoteOrSummary).toContain('Company page 2');
  });
  it('rejects 41 pages', async () => {
    await expect(extractPdf(pdf(41), 'deck')).rejects.toMatchObject({ code: 'pdf_page_limit' });
  });
  it('accepts the 40 page boundary', async () => {
    expect((await extractPdf(pdf(40), 'deck')).evidence).toHaveLength(40);
  });
  it('rejects a damaged PDF with a plausible signature', async () => {
    await expect(extractPdf(Buffer.from('%PDF-1.7\ncorrupt data'), 'deck')).rejects.toMatchObject({ code: 'invalid_pdf' });
  });
  it('marks unreadable/scanned pages and does not invent content', async () => {
    const result = await extractPdf(pdf(2, false), 'deck');
    expect(result.evidence).toEqual([]);
    expect(result.limitations.join(' ')).toMatch(/1.*2.*OCR/);
  });
  it('supports cancellation', async () => {
    await expect(extractPdf(pdf(2), 'deck', AbortSignal.abort())).rejects.toMatchObject({ code: 'cancelled' });
  });
});
