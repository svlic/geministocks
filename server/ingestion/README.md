# Ingestion boundary (Node 24)

Public exports from `index.ts`:

```ts
ingestWebsite(url: string, signal?: AbortSignal): Promise<IngestionResult>
extractPdf(buffer: Buffer, documentId: string, signal?: AbortSignal): Promise<IngestionResult>
assertPublicUrl(url: string): Promise<URL>
fetchPublicPage(url: string, signal?: AbortSignal): Promise<{ url: string; title: string; text: string }>
```

`IngestionResult` is `{ evidence: Evidence[]; limitations: string[] }`; `Evidence`
has the PRD fields without importing the shared application schema. It provides
source text, **not independently verified claims**. Website evidence is
`official_website`; deck evidence is `uploaded_deck` with a 1-based page and the
provided document ID. `retrievedAt` is the actual extraction/retrieval time.
`IngestionError.code` distinguishes technical/security failures from missing facts.

## Website limits

- HTTPS only, no URL credentials, no non-default port; no automatic HTTP upgrade.
- Every DNS answer must be public. Mapped/translation/tunnel and reserved IP
  ranges are denied conservatively; only global-unicast IPv6 in `2000::/3`
  outside special ranges is accepted. DNS is checked again at each redirect.
- A fresh HTTPS socket uses a pinned lookup result, explicit address family,
  and ordinary hostname/TLS certificate validation. No cookie or proxy forwarding.
- At most 8 same-hostname pages (not registrable-domain expansion), 2 link levels,
  3 redirects per page, 12 seconds including DNS/redirects/body per logical request,
  110 seconds for the entire crawl. The robots retrieval is additional to the
  page budget and shares the total byte budget.
- 1,000,000 bytes/page, 500,000 bytes/robots, 4,000,000 bytes/crawl including
  redirect bodies. Only uncompressed HTML is parsed; evidence is bounded to
  12,000 characters/page. Discovered candidate links and queues are also bounded.
- Robots allow/disallow and crawl-delay are respected on each request, including
  redirected pages. Only robots 404/410 is treated as absence; other robots
  failures and HTML/challenge responses fail closed.
- `fetchPublicPage` uses the same reader with a **one-page** budget, including
  robots; it returns actually retrieved text for citation checking. It does not
  authenticate a claim or prove a document's independence.
- No JavaScript rendering, external stylesheet/computed visibility analysis,
  login, CAPTCHA, paywall circumvention, or unauthorized LinkedIn crawler.
  Scripts and explicit hidden content are removed, but **all remaining content
  is still untrusted data**. Agents must not treat it as policy/instructions.

## PDF limits and deployment

PDFs require the `%PDF-` signature, at most 25 MiB, and at most 40 pages. A new
child receives bytes on stdin and returns bounded JSON on stdout. No source file
is written to disk; no application credentials or environment secrets are
inherited. The child has a 192 MiB V8 old-space cap, 16 MiB semi-space cap, a
20-second wall deadline, and 1 MB output cap. Node's permission mode allows
read access only to this module directory and node_modules; it does not grant
filesystem writes, subprocesses, workers, or native addons. This is **not a
complete OS/container sandbox or a total native-memory quota**; deployments
should additionally use process/container CPU and RSS limits for hostile files.

The PDF.js parser disables eval, system fonts, font-face rendering and WASM.
Scanned/low-text/unreadable pages are reported by page number, never invented.
No OCR, chart interpretation, or visual model is called. Text is capped at
12,000 characters per page; extraction order and complex table layout can be
imperfect. Damaged/encrypted inputs fail explicitly.

Production packaging must retain `pdf-child.mjs` beside `pdf.ts` and install
`pdfjs-dist` in project node_modules. The service must run under Node 24. Private
upload authorization/MIME metadata checks, object storage and retention are the
caller's responsibility; do not POST a 25 MB file to a Vercel function body.

Dependencies: `pdfjs-dist`, `ipaddr.js`, `cheerio`, `robots-parser`.

Checks: `pnpm exec vitest run server/ingestion server/gateway`.
