# Implementation decisions

## S0 — baseline (2026-11-05)

- Source HEAD: `9d71ac57c628f26cd8f5db96bac0b9f43578dc74`.
- Development branch: `feat/primary-market-screening`.
- Runner initially lacked Node and pnpm. Installed isolated Node 24.11.0 toolchain in `/tmp`; used Corepack pnpm 11.8.0 without changing the project's package manager.
- `pnpm install`, `pnpm typecheck`, `pnpm test` (24 files / 178 tests), and `pnpm build` all passed before edits.
- MIT LICENSE and existing copyright retained.

## Dependency audit and removal boundary

The entry path is `index.tsx → App.tsx → streamingService/geminiService → apiConfigService + exaSearchService`; App also mounts news, thermometer, TACO, history, stock handoff and BYOM settings. These form the old application, not shared screening infrastructure.

`AnalysisResult → markdownService/exportUtils → types.ts` is stock/trading-specific (core holdings, satellites, positional warfare). Its export contract cannot safely be reused for primary-market screening; the new exporter retains the Markdown capability with the new evidence contract. `IndustryChainViz → types.ts + TextRenderer + useI18n` depends on the stock report schema; retain its analytical purpose as evidence-linked value-chain positioning rather than carrying trading types into the new report. React, Vite, TypeScript, Tailwind, Vitest, local font assets and responsive paper/ink/copper visual language remain.

Remove orphaned old components, services, hooks, translations, tests, API handlers, worker, rewrites, ads, marketing metadata, tracking, service worker and legacy database scripts after the replacement entry point is ready. Keep unrelated generic utilities only if used by the new app. Do not retain an accessible old arbitrary model proxy or client-supplied system prompt API.

## Runtime choice

Use a single persistent Node 24 service, SQLite relational database and private local upload directory on a persistent volume, behind an HTTPS reverse proxy. This is the PRD's explicitly allowed resident-Node alternative, not a Vercel background-function workaround. Uploads stream directly to this authenticated service (not through a Vercel function). SQL-backed jobs are claimed by a worker loop and recover after process restart; never acknowledge an unpersisted timer-only job. Config snapshots are fixed at submission; short-lived jobs and files expire within 24 hours. Single-instance deployment only; horizontal scaling requires a shared database/object-store queue implementation.

Model keys are encrypted at rest with AES-256-GCM and a deployment secret; browser/admin reads expose masks only. Minimal one-admin authentication uses scrypt, opaque hashed sessions, HttpOnly/SameSite cookies, Secure in production, origin + CSRF checks and rate limits. Demo mode uses explicit fictional fixtures and never falls back silently from live failures.

## Delivery policy

Stage commits are local, as requested by the attached execution specification. No push, production infrastructure change or deployment is authorized by that document. Live provider and production TLS checks must be marked blocked unless executed with actual credentials/infrastructure.

## S1–S7 actual delivery

S1 removed the old application entry graph, obsolete API/worker/proxies, trading schemas, translations, history/key storage and related dependencies. New UI retains React/TypeScript/Vite/Tailwind, bilingual behavior, local typography, report rendering and Markdown capability rather than attempting to adapt stock-trading reports.

S2–S6 backend modules were implemented and independently tested, then integrated as one coherent local stage commit instead of pretending that each independently developed module was a fully working deployed stage. Frontend and ingestion/gateway contributions were validated together: final 15 files / 121 tests, typecheck/build, real private HTTP PDF upload/child extraction, and browser demo workflows. Details and remaining verification are in [acceptance-report.md](acceptance-report.md); S4 live verification and S7 production/adversarial validation remain incomplete.

Budget is bounded through gateway invocations, native turns, timeout/retry, and raw provider usage records, not a universal money estimator. No USD totals are invented. Research sources are accepted only after secure retrieval, but semantic entailment/independence cannot be proven by structural validation. Team identity association is deliberately conservative; every numeric team sub-score requires its own rationale and sufficient, bound professional evidence. PDF-only discovery requires a literally supplied website whose public origin confirms the company name, with private URL paths/queries excluded from public discovery.

The runtime migration is automatic SQLite schema v1. Old browser history and model keys are intentionally not imported; old deployment routes must be removed at cutover. New active documentation is README, deployment, model-and-security, implementation-decisions and acceptance-report. Inherited Cloudflare/Google/Jev/A-share notes are historical only.

![Browser-to-backend trust boundaries](https://ampcode.com/artifacts/visuals/15b88b53-7d7f-4008-84c8-2951772f5167)
