# Nebula Console on Unraid

Nebula Console runs as one application container and connects to existing MariaDB, RustFS, and HTTPS reverse-proxy containers.

## Install the template

After the first successful GitHub Container Registry workflow, make the `nebula-l` package public in the GitHub package settings. Then download the template on Unraid:

```bash
curl --fail --location \
  --output /boot/config/plugins/dockerMan/templates-user/my-nebula-console.xml \
  https://raw.githubusercontent.com/lingyu-ily/Nebula-L/master/unraid/nebula-console.xml
```

Open **Docker → Add Container**, select **Nebula-Console** from the template list, and fill every required field. Select the same custom Docker network used by MariaDB, RustFS, and Nginx whenever possible.

For an HTTPS production setup, open the hostname configured in `APP_BASE_URL` to sign in. The Unraid WebUI shortcut points directly to the published HTTP port and is intended mainly for LAN diagnostics.

The template pulls:

```text
ghcr.io/lingyu-ily/nebula-l:latest
```

## Required values

- `APP_BASE_URL`: the exact external HTTPS URL for Nebula Console.
- `DATABASE_URL`: MariaDB connection URL. URL-encode reserved characters in the password.
- `COOKIE_SECRET`: at least 32 random characters; generate one with `openssl rand -hex 32`.
- `RUSTFS_ENDPOINT`: internal S3 API endpoint, normally port 9000 rather than the console port.
- `RUSTFS_BUCKET`, access key, and secret key: credentials with read/write access to `private/*` and `public/*`.
- `RUSTFS_PUBLIC_BASE_URL`: anonymous or CDN base URL from which Helios can read `public/*`.

When services share a custom Docker network, container names can be used:

```text
DATABASE_URL=mysql://nebula:URL_ENCODED_PASSWORD@mariadb:3306/nebula
RUSTFS_ENDPOINT=http://rustfs:9000
```

Otherwise, use the Unraid host address and published service ports. Never use `localhost` for a different container.

`NEBULA_HTTP_PORT` is only a Compose interpolation variable. In the Unraid template, set the Web UI port mapping instead.

## Create the first administrator

Start the container, open its Unraid Console, and run this command once:

```bash
NEBULA_ADMIN_USERNAME=admin NEBULA_ADMIN_PASSWORD='temporary-password-at-least-12-characters' npm run admin:create
```

The command only succeeds before the first account exists. Sign in through `APP_BASE_URL` and immediately replace the temporary password.

Do not add `NEBULA_ADMIN_PASSWORD` as a persistent Unraid variable. Unraid masks fields in its UI, but Docker environment variables remain visible to a host administrator through container inspection.

## Verify

The container includes its own health check. Verify readiness through the reverse proxy:

```text
https://nebula.example.com/health/ready
```

The expected response reports `database`, `rustfs`, and `java` as `ok`. If uploads are large, configure the reverse proxy request limit and timeouts to match `MAX_UPLOAD_BYTES`.
