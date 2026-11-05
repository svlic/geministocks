# Contributing / 贡献指南

Use Node ≥24.11.0 and pnpm 11.8.0. Follow [README](README.md) for local backend/frontend setup and [AGENTS.md](AGENTS.md) for module ownership and product invariants.

Before submitting run `pnpm typecheck`, `pnpm test`, `pnpm build`. Add focused public-contract regression tests, not provider-call-order snapshots. UI changes need rendered desktop/mobile inspection; keep Chinese and English labels functional. Do not add browser key storage, arbitrary client system prompts, news/trading paths or multi-round research.

Keep live calls out of ordinary tests; mocked xAI fixtures do not prove provider permissions. Never include API keys, private documents or upstream error bodies in test artifacts or reports. See [SECURITY.md](SECURITY.md) for disclosure.
