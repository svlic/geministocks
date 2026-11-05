// Standalone child entrypoint; never runs inside the HTTP/job process.
// No eval, attachments, rendering, OCR, external URLs, or inherited credentials.
console.log = () => {};
console.warn = () => {};
const send = value => process.stdout.write(JSON.stringify(value));
try {
  const chunks = []; let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 25 * 1024 * 1024) throw new Error('pdf_too_large');
    chunks.push(chunk);
  }
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: new Uint8Array(Buffer.concat(chunks)),
    isEvalSupported: false, useSystemFonts: false, disableFontFace: true,
    useWasm: false, isOffscreenCanvasSupported: false,
    maxImageSize: 0, stopAtErrors: true, verbosity: 0,
  });
  const doc = await task.promise;
  if (doc.numPages > 40) {
    await task.destroy(); send({ error: 'pdf_page_limit' });
  } else {
    const pages = []; const unreadable = []; const truncated = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      try {
        const page = await doc.getPage(pageNumber);
        const content = await page.getTextContent();
        let text = '';
        for (const item of content.items) {
          if ('str' in item) text += item.str + (item.hasEOL ? '\n' : ' ');
          if (text.length > 12_000) { truncated.push(pageNumber); break; }
        }
        text = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12_000);
        if (text.length < 20) unreadable.push(pageNumber);
        if (text) pages.push({ page: pageNumber, text });
        page.cleanup();
      } catch { unreadable.push(pageNumber); }
    }
    await task.destroy();
    send({ pages, unreadable, truncated });
  }
} catch {
  send({ error: 'invalid_pdf' });
}
