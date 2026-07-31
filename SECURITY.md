# Security

## Secrets

Keep MariaDB, RustFS, cookie, bootstrap-password, and CurseForge credentials outside the repository. Use Docker secrets or an equivalent secret manager in production. The application never returns storage credentials through its API.

The historical CurseForge key previously embedded in source must be revoked and replaced with `CURSEFORGE_API_KEY`.

## Published object policy

Grant the application credential read/write access to the configured bucket. Grant anonymous or CDN read access only to `public/*`; keep `private/*` inaccessible. Serve the application and public distribution endpoint over HTTPS.

## Reporting

Report vulnerabilities privately to the project maintainers. Do not include live credentials, user data, or private object URLs in reports.
