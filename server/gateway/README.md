# Model gateway

`index.ts` exports `callModel(config: ModelConfig, request: ModelRequest)`. The result is
`{text, citations: Array<{url,title}>, usage, searchUsed, xSearchUsed, elapsedMs}`.
`GatewayError` exposes sanitized `code`, `retryable`, and optional HTTP `status`.
It never includes upstream bodies, keys, or prompts. No logging is performed.

- Only `provider: 'openai'` is supported: an OpenAI-compatible HTTPS base URL
  (default `https://api.openai.com/v1`). Text calls use `/chat/completions`,
  `messages` and `max_tokens`; server-owned `request.webSearch=true` instead uses
  `/responses`, `input`, `web_search`, required tool choice, a six-tool-call limit
  and `max_output_tokens`. Model IDs are configured, never hardcoded. There is no
  native `x_search` requirement or silent provider fallback. Incomplete output is an error.
- Text calls always return empty citations and false search flags, regardless of
  prose or extra metadata. Responses search flags require completed `web_search_call`
  records. Twitter/X coverage is recorded from actual queries targeting x.com or
  twitter.com, including ordinary web search. It does not guarantee post retrieval.
  Structured HTTPS `url_citation` annotations accompanied by a completed search
  and completed calls' `action.sources` nominate up to 24 candidate sources;
  the research layer still securely fetches their text
  before accepting evidence. Model prose, snippets and bare links are not evidence.
- One timeout (1–600000 ms, extended for PDF understanding) covers the entire call, optional retry, and bounded
  2 MB response body. Caller cancellation is supported. Explicit HTTP 429,
  502, 503, 504 rejection can be retried once after 100ms; ambiguous network
  errors/timeouts are never blindly replayed because billing may have occurred.
  Search requests include `web_search_call.action.sources` for backup candidates.
  HTTP 400/422 permits one retry without this optional `include` parameter, still
  requiring the same search tool. All retries share the existing two-attempt cap.
- Config and system prompts must come from authorized server-side snapshots.
  OpenAI-compatible base URLs are admin-controlled HTTPS endpoints; ordinary
  users must never be allowed to supply them or turn this into a proxy.
- `allowConfidential` is policy metadata. This plain-string API **cannot detect
  whether input is confidential**. The orchestrator must enforce provider consent
  before including Deck text. Public search is a separate origin-only request and
  never receives Decks, derived private summaries or notes, even with consent.

Tests use mocked Chat Completions and Responses payloads; passing tests **are not
a live provider certification**. Real authentication/model/search checks need real keys.
