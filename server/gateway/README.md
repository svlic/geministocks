# Model gateway

`index.ts` exports `callModel(config: GatewayConfig, request: ModelRequest)`;
`ModelConfig` is an equivalent alias. The result is
`{text, citations: Array<{url,title}>, usage, searchUsed, xSearchUsed, elapsedMs}`.
`GatewayError` exposes sanitized `code`, `retryable`, and optional HTTP `status`.
It never includes upstream bodies, keys, or prompts. No logging is performed.

- xAI uses **native** `https://api.x.ai/v1/responses`, `store:false`,
  `max_output_tokens`, native `web_search`/`x_search`, and top-level `max_turns`
  (default 3; accepted range 1–3, so Team can request 2). The model ID is configured,
  never hardcoded. xAI base URL overrides must still point to its official API.
- `max_turns` caps assistant/tool turns, **not individual calls**; multiple tools
  can execute within one turn. The job orchestrator must separately enforce the
  3 principal calls/2 Team calls and overall cost budget. Raw usage preserves
  token counts, tool counts and X item-fetch counts for cost accounting.
- Citations come only from official response annotations/citations, never from
  links the model happens to write in prose. Search flags require both official
  citation metadata and positive corresponding tool usage counts. Merely offering
  tools or observing attempted calls does not claim search success. A flag of
  false can mean the model chose not to search; it is not a definitive capability
  test. Citation URLs still need actual accessibility/claim checks by the caller.
- OpenAI-compatible uses `/chat/completions`, `messages`, and `max_tokens` and
  is strictly text-only. Requesting search does not send tools or claim search.
  No silent provider fallback occurs. Truncated/incomplete output is an error.
- One timeout (1–180000 ms) covers the entire call, optional retry, and bounded
  2 MB response body. Caller cancellation is supported. Explicit HTTP 429,
  502, 503, 504 rejection can be retried once after 100ms; ambiguous network
  errors/timeouts are never blindly replayed because billing may have occurred.
- Config and system prompts must come from authorized server-side snapshots.
  OpenAI-compatible base URLs are admin-controlled HTTPS endpoints; ordinary
  users must never be allowed to supply them or turn this into a proxy.
- `allowConfidential` is policy metadata. This plain-string API **cannot detect
  whether input is confidential**. The orchestrator must enforce provider consent
  before including Deck text and send only already-public identity terms in any
  search request. No unredacted Deck text should be sent to web/X tools.

Official documentation consulted (via their `.md` endpoints, November 2026):

- https://docs.x.ai/developers/tools/web-search
- https://docs.x.ai/developers/tools/x-search
- https://docs.x.ai/developers/tools/citations
- https://docs.x.ai/developers/tools/tool-usage-details

Tests use explicit mocked provider responses; passing tests **are not a live xAI
search certification**. Real authentication/tool permission checks need real keys.
