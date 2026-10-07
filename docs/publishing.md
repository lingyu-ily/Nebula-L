# Incremental publishing

Publishing uses the frozen database snapshot, not S3 comparisons, to determine work. Draft revisions still enforce edit concurrency. Parsed JARs are cached by content hash, filename, type, Minecraft/loader environment and generator version. Installation settings and current server text are applied when assembling each new distribution.

Public objects live at `public/<slug>/objects/<sha256>/<content-type-hash>/payload`. The original private upload remains separate. Verified public objects are reused without per-publish HEAD requests. Loader modules and their nested artifact references are cached independently. Bump `PUBLISH_GENERATOR_VERSION` when changing generator or Claritas semantics.

Object reuse assumes Nebula manages the stored objects. Deleting a public object directly in S3 bypasses the registry; mark its registry entry `verified = FALSE` before publishing to recreate it. Garbage collection invalidates entries before deletion, including when S3 deletion partially fails.

Candidate references are persisted before the stable `distribution.json` PUT. An uncertain PUT keeps references pinned until a read confirms the previous release or the verified candidate. Recovery can finish a successful S3 write without rebuilding. Publish and cleanup use the same project advisory lock. Old public objects with no references are deleted immediately, so launchers downloading an older manifest may need to reload it.

The cleanup worker retries once per minute. It preserves queued/running work, rechecks references, and removes registry records only after S3 deletion succeeds. Private uploads marked `DELETED` are collected after 24 hours if no draft references remain; `READY` uploads are retained. Migration backdates no deletion: existing deleted uploads receive the migration timestamp. Legacy build prefixes are removed after the first successful incremental publish.

Job results include `metrics`: parse/loader/object cache hits, S3 requests by command, successful payload bytes downloaded/uploaded/copied and total duration. Request counts include SDK retries; byte counters describe successful logical payload transfers, not HTTP overhead or retransmissions. Normal publish statistics include synchronous cleanup; later recovery and maintenance have separate application logs.

## Validation

Run `npm test`, `npm run build`, and `npm run lint`. The normal test suite includes a loopback HTTP S3 protocol fixture using the real AWS SDK. SQL recovery/cleanup and incremental builds also have focused unit tests.

For actual MariaDB and RustFS integration, start the isolated fixtures:

```powershell
docker compose -p nebula-publish-test -f compose.publish-test.yml up -d
$env:NEBULA_PUBLISH_TEST_DATABASE_URL = 'mysql://root:nebula_publish_test@127.0.0.1:13306/'
$env:NEBULA_PUBLISH_TEST_S3_ENDPOINT = 'http://127.0.0.1:19000'
npm run test -w @nebula/server
docker compose -p nebula-publish-test -f compose.publish-test.yml down
```

Wait for MariaDB to become healthy before running tests. Integration tests create a unique database and bucket and remove both afterward. Only loopback services are accepted. They do not read the application `.env`; absent explicit test variables, the live integration test is skipped.
