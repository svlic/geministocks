# Model configuration and security

## Administrator-owned configuration

Authenticated settings maintain versioned model lists, policy rules/prompt and stage weights. Saves use optimistic version checks. Blank API Key retains the previous encrypted secret; deleting a model removes it from future configuration, not existing short-lived job snapshots. Each submitted job snapshots its configuration so later edits cannot silently change the running policy/model/weights.

Assign enabled models to `research`, `team`, `synthesis` roles. Model IDs are operator supplied, not assumed universal. xAI defaults to the official API; OpenAI-compatible base URL is an administrator-controlled HTTPS text endpoint, not a user-selectable proxy. A malicious admin endpoint can exfiltrate inputs: administrators are trusted operators, not sandboxed tenants.

Keys use AES-256-GCM with fresh IV/authentication tag and a 32-byte deployment secret. Masked reads, session-only authentication, same-origin CSRF checks and strict submission schemas prevent ordinary form requests from selecting keys, endpoints or system prompts. Browser state and JS bundle contain no model secret. Model calls, including admin connectivity checks, are backend-only; entering a key into admin necessarily sends that new value to your backend over TLS.

## Native xAI and downgrade

`server/gateway` calls `/v1/responses`, `store:false`, with native `web_search`, `x_search`, `max_turns` and configured model ID. Search usage flags require actual official citation metadata and positive matching tool usage counts. Merely enabling a tool, attempting it or writing a URL in prose is not success. The admin connection test returns observed tool flags and raw usage, not a certification that every future request can search.

OpenAI-compatible calls `/chat/completions` without search tools. Reports disclose missing search support, never silently switch providers. Gateway failures are typed/sanitized. HTTP 429/502/503/504 can retry once; ambiguous timeout/network errors are not replayed automatically. Returned citations are re-fetched through the secure public reader before ledger acceptance; an accessible source is still not proof of every associated fact.

Main discovery allows at most three native turns, team at most two, and orchestration at most seven gateway invocations plus its ten-minute job deadline. A native turn can contain parallel tools; these are not exact tool-call or dollar caps. Raw token/tool usage and elapsed times are retained per module in `job_usage`, no private prompts. Provider-specific prices and a USD budget enforcement engine are not implemented; use provider spend limits. Execution summary shows provider/model/search flags/time; per-call usage is not a public user response.

## Confidentiality and untrusted material

PDF input is private. If any downstream role lacks `allowConfidential=true`, all Deck text is omitted from all model calls to avoid indirect cross-provider leakage. Public discovery receives only the public official website, never Deck text, notes, financing or founder details. PDF-only research may use a website literally present in the Deck only after securely retrieving its public origin and confirming the named company in public text; private paths/query tokens are removed before retrieval/search. Without public identity confirmation it does not initiate discovery. Notes remain unverified context; do not put secrets in them.

System prompts label website/PDF/social/tool text as untrusted. Only server rules choose policy and confidence thresholds, only code calculates weighted totals, and IDs must bind to a retrieved ledger. These structural controls do **not** guarantee a model will always classify sectors correctly or resist every semantic injection. Independent manual review remains necessary. Same-name third-party professional facts are rejected unless the name is in primary evidence and the cited source explicitly links name and company; conservative string matching can miss transliterations/aliases. Each team sub-score also needs its own rationale, sufficient evidence state and references to accepted professional facts; missing/partial/unbound support makes that score null before aggregation.

Verified facts with only official/Deck evidence are downgraded to company claims. Unbound IDs reject report material. Direct comparable categories require workflow/product/customer fit fields and evidence; financing unknowns remain null; undated public metrics are suppressed. Entailment, round compatibility and true economic comparability still require model judgment/manual review; no deterministic truth oracle is claimed.

## Input and temporary storage

Website reader: HTTPS-only, public DNS/IP checks, pinned socket lookup, safe redirects, robots, bounded 8-page/depth-2 crawl, time/byte limits. No login, CAPTCHA bypass, unauthorized LinkedIn collection or JavaScript rendering. Robots failures may prevent evidence retrieval; limitations are not evidence of a weak company.

PDF: authenticated metadata init and streaming private PUT, MIME/extension/signature/size checks, 25 MiB and 40 pages maximum. Duplicate PUT cannot claim/delete another in-flight upload; upload IDs cannot be reused across jobs. Extraction runs in a child with sanitized environment, Node permissions and bounded time/heap/output. It yields document/page references, not OCR, images or guaranteed table reconstruction. Preserve `pdf-child.mjs` in deployment and enforce container limits.

Private directory/database file permissions are 0700/0600. Raw PDFs are deleted after extraction/cancel/failure, unused uploads after one hour. Parsed checkpoints and encrypted configuration snapshots, inputs, reports and module usage expire with jobs after 24 hours. Some job data is plaintext on private disk; use encrypted volumes for confidentiality at rest beyond key encryption. Cleanup cannot erase external backups/snapshots. See [deployment](deployment.md).

## Validation status

Automated provider tests use mock Responses/Chat Completions payloads. PDF tests invoke the real child parser. Browser demo tests use the actual HTTP API but fictional research fixtures. No real paid xAI call or production HTTPS deployment was performed; these remain explicitly blocked in the acceptance report.
