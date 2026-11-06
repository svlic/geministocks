# Deployment and migration

## Supported topology

One persistent Node ≥24.11.0 process, SQLite and private filesystem on a persistent volume, behind an HTTPS reverse proxy. Do not run multiple replicas against this worker/database. Vercel/Cloudflare static deployment alone is not sufficient; the old deployment documents do not apply. Production HTTPS and live-provider deployment remain environment-specific acceptance checks.

For the recommended Docker Compose path, follow the [README deployment instructions](../README.md#docker-compose-部署推荐). The image includes the built frontend, Node backend, PDF child parser and SQLite migration. Compose persists `/data` in a named volume and binds port 3001 to host loopback for an existing HTTPS proxy. Never remove that volume on upgrade or regenerate its encryption key. The steps below describe the alternative non-container installation.

1. Install the declared pnpm version and `pnpm install --frozen-lockfile` including build dependencies. Run all checks, then `pnpm build`.
2. Set `.env` or secret-manager variables from `.env.example`. Use a fixed random 32-byte hex `CONFIG_ENCRYPTION_KEY`, strong administrator credentials, an HTTPS `APP_ORIGIN`, `DATA_DIR` on private durable storage, and `DEMO_MODE=false` for live service. Never expose the encryption key as a Vite variable.
3. Run `pnpm start` under a restart-capable service manager as a dedicated unprivileged user. It serves `dist/` and `/api/` from port 3001 by default. Set HOST only for the intended private network/interface.
4. Reverse proxy TLS requests without modifying Origin. Permit at least 25 MiB request bodies; stream uploads rather than buffering through serverless functions. Set upload timeouts compatible with the backend's 30-second request timeout, and test slow-client behavior in your environment.
5. Firewall direct backend access; use private volume permissions, encrypted storage if required, container CPU/RSS ceilings and outbound egress rules. PDF child heap limits do not cover total native memory. Keep `server/ingestion/pdf-child.mjs`, SQL migration and node_modules in the runtime package.
6. Verify Secure/HttpOnly/SameSite cookie and CSP/HSTS over actual HTTPS, anonymous API denial, a private PDF upload, cancellation/restart, TTL cleanup, and admin model connectivity. Test real provider web/X tools with a small approved public sample before allowing private materials.

The reverse proxy is the sole peer seen by current rate limiting; one admin instance is deliberately conservative. Horizontal scale, per-forwarded-IP trust, distributed queues/object storage and automated USD budget enforcement require a different deployment design.

## Database initialization / migration

`server/persistence/001_initial.sql` is applied automatically and idempotently on startup, sets SQLite `user_version=1`, and creates admin/session/config/upload/job/usage tables. No manual migration command is needed for a new volume. The initial admin is inserted only if absent; changing `ADMIN_PASSWORD` later does **not** reset it. There is no self-service reset endpoint; an operator must perform a reviewed maintenance procedure if needed.

No migration imports old browser localStorage API keys or stock history. Export anything needed from the old version separately; clear old browser site storage manually after verifying exports. Old browser keys should be rotated/re-entered in the new protected admin if reused. Remove old API/worker routes and deployed proxy rewrites when replacing the old site, not only its static homepage.

Stop the service before backing up a volume or use SQLite's supported online backup tooling. Keep database and deployment encryption key backed up separately with access controls. Restore a matched DB/key pair and retain its schema-compatible code. Do not regenerate the encryption key on restart. No automatic key-rotation or admin-password-reset workflow is supplied.

## Retention and recovery

Unused uploads expire after one hour. Extraction is checkpointed encrypted into the task before raw deletion, so an interrupted job can resume. Tasks/results/usage expire 24 hours after submission; sessions expire after eight hours. Startup and worker cleanup remove expired records and orphan files, enable secure-delete and truncate WAL. Service downtime delays cleanup until restart; external snapshots/backups need their own short retention. Parsed text and report data remain sensitive despite raw deletion.

Persisted running tasks return to queued on restart, max two execution attempts. A restart can repeat provider work and incur charges; external model calls are not exactly-once. Job timeout is ten minutes. Per-model timeouts and bounded calls/turns are not a guaranteed monetary cap; set provider-side spend limits. The UI intentionally has no history list.

## Demo and rollback

Use a separate disposable DATA_DIR and credentials for demo. Fixtures are conspicuously fictional and make no live-search claim. Switching DEMO_MODE affects new snapshots after restart, not already submitted jobs. For rollback, stop the service, restore a consistent volume snapshot with its encryption key and matching code, then verify auth and config before reopening traffic. Never point an old stock application at the new screening database.
