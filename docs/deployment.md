# Deployment and migration

## Supported topology

One persistent Node ≥24.11.0 process, SQLite and private filesystem on a persistent volume, behind an operator-managed reverse proxy. TLS and HSTS are the proxy's responsibility, not application startup requirements; HTTP origins are supported for trusted private access. Do not send credentials or private materials over untrusted plaintext networks. Do not run multiple replicas against this worker/database. Vercel/Cloudflare static deployment alone is not sufficient; the old deployment documents do not apply. Transport security and live-provider deployment remain environment-specific acceptance checks.

For the recommended Docker Compose path, follow the [README deployment instructions](../README.md#docker-compose-部署推荐). The image includes the built frontend, Node backend, PDF child parser and SQLite migration. Compose persists `/data` in a named volume and binds port 3001 to host loopback for an existing HTTPS proxy. Never remove that volume on upgrade or regenerate its encryption key. The steps below describe the alternative non-container installation.

1. Install the declared pnpm version and `pnpm install --frozen-lockfile` including build dependencies. Run all checks, then `pnpm build`.
2. Set `.env` or secret-manager variables from `.env.example`. Use a fixed random 32-byte hex `CONFIG_ENCRYPTION_KEY`, strong administrator credentials, a browser-facing `APP_ORIGIN` (HTTP or HTTPS, no path or trailing slash), `DATA_DIR` on private durable storage, and `DEMO_MODE=false` for live service. Request Origin is not validated; `APP_ORIGIN` supplies the base URL and determines Secure cookies, so its scheme should match browser access even when proxy-to-backend traffic is HTTP. Session authentication and CSRF tokens remain required for authenticated mutations. Never expose the encryption key as a Vite variable.
3. Run `pnpm start` under a restart-capable service manager as a dedicated unprivileged user. It serves `dist/` and `/api/` from port 3001 by default. Set HOST only for the intended private network/interface.
4. Reverse proxy requests to the backend. Permit at least 25 MiB request bodies; stream uploads rather than buffering through serverless functions. Set upload timeouts compatible with the backend's 30-second request timeout, and test slow-client behavior in your environment.
5. Firewall direct backend access; use private volume permissions, encrypted storage if required, container CPU/RSS ceilings and outbound egress rules. PDF child heap limits do not cover total native memory. Keep `server/ingestion/pdf-child.mjs`, SQL migration and node_modules in the runtime package.
6. Verify HttpOnly/SameSite cookies and CSP; HTTPS origins must also set Secure cookies. Verify TLS/HSTS at the outer proxy if used; the application does not emit HSTS. Check anonymous API denial, a private PDF upload, cancellation/restart, TTL cleanup, and admin model connectivity. Test the configured OpenAI-compatible model with a small approved public sample before allowing private materials. Optional public web discovery uses the separate server-side `BRAVE_SEARCH_API_KEY`; verify it with a public domain if configured. Model-native tools and X search are not supported.

The reverse proxy is the sole peer seen by current rate limiting; one admin instance is deliberately conservative. Horizontal scale, per-forwarded-IP trust, distributed queues/object storage and automated USD budget enforcement require a different deployment design.

## Database initialization / migration

`server/persistence/001_initial.sql` is applied automatically and idempotently on startup, sets SQLite `user_version=1`, and creates admin/session/config/upload/job/usage tables. No manual migration command is needed for a new volume. The initial admin is inserted only if absent; changing `ADMIN_PASSWORD` later does **not** reset it. There is no self-service reset endpoint; an operator must perform a reviewed maintenance procedure if needed.

The OpenAI-compatible-only upgrade also migrates editable JSON settings on startup, once per affected config: remove model search flags and scoring turn budgets, increment their config versions, and convert legacy `xai` entries to disabled `openai` entries while preserving encrypted keys, model IDs and base URLs (defaulting legacy xAI URLs to `https://api.x.ai/v1`). Review the compatible endpoint and explicitly save/re-enable before use. Existing compatible models retain their enabled state. Job snapshots/results are not rewritten; unfinished native jobs cannot use the removed adapter and must be resubmitted under a new snapshot. Back up the DB/key pair before upgrading; roll back with matched pre-upgrade data and code, not by deleting user records.

The provisional-scoring upgrade changes only the untouched version-1 scoring threshold of 75% to 5% and increments that configuration to version 2. Administrator revisions (including a later version still using 75%) and non-default thresholds are preserved; lower them explicitly in scoring settings if desired. No SQL schema change, job snapshot rewrite or stored report rescore is performed. New jobs use the current scoring configuration; pending/recovered jobs retain their snapshotted threshold and weights but run the installed analysis code. Back up the DB/key pair before upgrading. This migration is idempotent and does not delete user data.

No migration imports old browser localStorage API keys or stock history. Export anything needed from the old version separately; clear old browser site storage manually after verifying exports. Old browser keys should be rotated/re-entered in the new protected admin if reused. Remove old API/worker routes and deployed proxy rewrites when replacing the old site, not only its static homepage.

Stop the service before backing up a volume or use SQLite's supported online backup tooling. Keep database and deployment encryption key backed up separately with access controls. Restore a matched DB/key pair and retain its schema-compatible code. Do not regenerate the encryption key on restart. No automatic key-rotation or admin-password-reset workflow is supplied.

## Retention and recovery

Unused uploads expire after one hour. Extraction is checkpointed encrypted into the task before raw deletion, so an interrupted job can resume. Tasks/results/usage expire 24 hours after submission; sessions expire after eight hours. Startup and worker cleanup remove expired records and orphan files, enable secure-delete and truncate WAL. Service downtime delays cleanup until restart; external snapshots/backups need their own short retention. Parsed text and report data remain sensitive despite raw deletion.

Persisted running tasks return to queued on restart, max two execution attempts. A restart can repeat provider work and incur charges; external model calls are not exactly-once. Job timeout is ten minutes. Per-model timeouts and bounded calls are not a guaranteed monetary cap; set provider-side spend limits. The UI intentionally has no history list.

## Demo and rollback

Use a separate disposable DATA_DIR and credentials for demo. Fixtures are conspicuously fictional and make no live-search claim. Switching DEMO_MODE affects new snapshots after restart, not already submitted jobs. For rollback, stop the service, restore a consistent volume snapshot with its encryption key and matching code, then verify auth and config before reopening traffic. Never point an old stock application at the new screening database.
