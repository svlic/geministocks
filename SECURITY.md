# Security policy / 安全边界

This is a private server-managed application, **not the former browser-local BYOM trust model**.

- Authenticated admin enters model keys over same-origin HTTPS. They are encrypted with AES-256-GCM at rest; reads expose masks. Deployment encryption secret must remain outside the database and source control.
- Research and admin APIs require an opaque HttpOnly session; production uses Secure/SameSite=Strict, mutation Origin and CSRF checks, request limits and per-account job limits. The initial version has one administrator, no public registration.
- Website retrieval validates public DNS, pins sockets, rechecks redirects and obeys robots. PDFs stream to private disk and are parsed in a permission-restricted, bounded child process. No public raw-PDF GET endpoint exists.
- Decks enter model text only if all configured downstream roles consent; public discovery receives only the submitted public website. Do not use untrusted custom model endpoints.
- Raw files are removed after extraction/cancellation/failure; unused uploads expire after 1 hour and jobs/results/extraction caches after 24 hours. Cleanup runs while the service is running and at startup. Disk snapshots and backups have separate operator-controlled retention.

Residual risks: model-based classification and claim entailment are not deterministic security boundaries; instructions alone do not prove prompt-injection immunity. Third-party pages can contain false claims. PDF Node permissions are not a complete OS sandbox; enforce CPU/RSS and outbound-network limits at deployment. Job inputs/results live on private disk, not full-database encryption; use encrypted volumes where required. SQLite secure-delete/checkpoint cannot guarantee erasure from SSD snapshots/backups.

See [model and security details](docs/model-and-security.md) and [deployment checklist](docs/deployment.md). Never publish credentials, original private decks or unredacted payloads in issues. For inherited upstream vulnerability reporting, contact **codes@z.org** privately with reproducible steps; contact your deployment operator for instance-specific leaks.
