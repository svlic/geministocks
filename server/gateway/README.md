# Model gateway

`index.ts` exports `callModel(config: GatewayConfig, request: ModelRequest)`;
`ModelConfig` is an equivalent alias. The result is
`{text, citations: Array<{url,title}>, usage, searchUsed, xSearchUsed, elapsedMs}`.
`GatewayError` exposes sanitized `code`, `retryable`, and optional HTTP `status`.
It never includes upstream bodies, keys, or prompts. No logging is performed.

- Only `provider: 'openai'` is supported: an OpenAI-compatible HTTPS base URL
  (default `https://api.openai.com/v1`), `/chat/completions`, `messages`, and
  `max_tokens`. The model ID is configured, never hardcoded. No native Responses
  adapter or silent provider fallback exists. Truncated output is an error.
- The adapter is strictly text-only. Citations are always empty and search flags
  always false, even if provider prose or extra metadata claims search. These
  result fields remain compatible with the report contract. Evidence comes from
  the secure website/PDF readers, not generated URLs.
- One timeout (1–180000 ms) covers the entire call, optional retry, and bounded
  2 MB response body. Caller cancellation is supported. Explicit HTTP 429,
  502, 503, 504 rejection can be retried once after 100ms; ambiguous network
  errors/timeouts are never blindly replayed because billing may have occurred.
- Config and system prompts must come from authorized server-side snapshots.
  OpenAI-compatible base URLs are admin-controlled HTTPS endpoints; ordinary
  users must never be allowed to supply them or turn this into a proxy.
- `allowConfidential` is policy metadata. This plain-string API **cannot detect
  whether input is confidential**. The orchestrator must enforce provider consent
  before including Deck text.

Tests use mocked Chat Completions responses; passing tests **are not a live
provider certification**. Real authentication/model checks need real keys.
