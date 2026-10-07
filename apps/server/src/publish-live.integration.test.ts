import { randomUUID } from 'crypto'
import { Readable } from 'stream'
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise'
import { CreateBucketCommand, DeleteBucketCommand } from '@aws-sdk/client-s3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => ({ databaseUrl: '', endpoint: '', bucket: '' }))
vi.mock('./config.js', (): Record<string, unknown> => ({ getConfig: (): unknown => ({
    databaseUrl: settings.databaseUrl, rustfs: {
        endpoint: settings.endpoint, bucket: settings.bucket, region: 'us-east-1',
        accessKeyId: 'nebula_test', secretAccessKey: 'nebula_test_secret', publicBaseUrl: `${settings.endpoint}/${settings.bucket}`
    }, appBaseUrl: 'http://localhost:3000', javaExecutable: 'java'
}) }))

import { closeDatabase, getPool } from './db/index.js'
import { migrateDatabase } from './db/migrate.js'
import { cleanupProjectStorage } from './publish-cleanup.js'
import { withProjectStorageLock } from './project-storage-lock.js'
import { buildProjectSnapshot, publishJob, type JobRow, type ProjectSnapshot } from './publisher.js'
import { deleteObjectPrefix, destroyStorage, getStorageClient, readStoredJson, uploadStream } from './storage.js'

// Explicit opt-in only. Both hosts must be loopback; fixtures use a newly created
// database and bucket, never the application's configured data or .env file.
const databaseUrl = process.env.NEBULA_PUBLISH_TEST_DATABASE_URL
const endpoint = process.env.NEBULA_PUBLISH_TEST_S3_ENDPOINT
const enabled = Boolean(databaseUrl && endpoint)
const fixtureName = `nebula_publish_test_${randomUUID().replaceAll('-', '')}`
let admin: Connection | undefined
let databaseCreated = false
let bucketCreated = false
const userId = randomUUID()
const projectId = randomUUID()
const serverId = randomUUID()

async function source(bytes: string, name: string): Promise<string> {
    const id = randomUUID()
    const stored = await uploadStream(projectId, id, Readable.from(Buffer.from(bytes)), 1024)
    await getPool().execute(
        `INSERT INTO uploads (id, project_id, object_key, original_name, mime_type, size, md5, sha256, created_by)
         VALUES (?, ?, ?, ?, 'application/java-archive', ?, ?, ?, ?)`,
        [id, projectId, stored.objectKey, name, stored.size, stored.md5, stored.sha256, userId]
    )
    return id
}

async function publish(): Promise<{ job: JobRow, snapshot: ProjectSnapshot, metrics: Record<string, unknown> }> {
    const connection = await getPool().getConnection()
    let snapshot: ProjectSnapshot
    try { snapshot = await buildProjectSnapshot(connection, projectId) }
    finally { connection.release() }
    const id = randomUUID()
    await getPool().execute(
        'INSERT INTO jobs (id, project_id, kind, status, snapshot, created_by) VALUES (?, ?, \'PUBLISH\', \'RUNNING\', ?, ?)',
        [id, projectId, JSON.stringify(snapshot), userId]
    )
    const [jobs] = await getPool().execute<JobRow[]>('SELECT * FROM jobs WHERE id = ?', [id])
    await publishJob(jobs[0])
    const [results] = await getPool().execute<(RowDataPacket & { result: string | { metrics: Record<string, unknown> } })[]>(
        'SELECT result FROM jobs WHERE id = ?', [id]
    )
    const result = typeof results[0].result === 'string'
        ? JSON.parse(results[0].result) as { metrics: Record<string, unknown> } : results[0].result
    return { job: jobs[0], snapshot, metrics: result.metrics }
}

describe.runIf(enabled)('isolated MariaDB + RustFS publishing', () => {
    beforeAll(async () => {
        const db = new URL(databaseUrl!)
        const s3 = new URL(endpoint!)
        if (![db.hostname, s3.hostname].every(host => ['127.0.0.1', 'localhost', '[::1]'].includes(host))) {
            throw new Error('Live publishing tests require loopback test services')
        }
        db.pathname = '/'
        admin = await mysql.createConnection(db.toString())
        await admin.query(`CREATE DATABASE ${fixtureName}`)
        databaseCreated = true
        db.pathname = `/${fixtureName}`
        settings.databaseUrl = db.toString()
        settings.endpoint = endpoint!
        settings.bucket = fixtureName.replaceAll('_', '-')
        await migrateDatabase()
        await getStorageClient().send(new CreateBucketCommand({ Bucket: settings.bucket }))
        bucketCreated = true
        await getPool().execute('INSERT INTO users (id, username, password_hash, role) VALUES (?, \'test-editor\', \'unused-test-hash\', \'EDITOR\')', [userId])
        await getPool().execute('INSERT INTO projects (id, slug, name, description, rss, created_by) VALUES (?, \'test\', \'Test\', \'\', \'\', ?)', [projectId, userId])
        await getPool().execute(
            `INSERT INTO servers (id, project_id, server_key, name, description, minecraft_version, server_version, address, main_server)
             VALUES (?, ?, 'survival', 'Survival', '', '1.20.1', '1', 'localhost:25565', TRUE)`, [serverId, projectId]
        )
    }, 60_000)

    afterAll(async () => {
        try {
            if (bucketCreated) {
                await deleteObjectPrefix('')
                await getStorageClient().send(new DeleteBucketCommand({ Bucket: settings.bucket }))
            }
        } finally {
            await destroyStorage()
            await closeDatabase()
            if (admin) {
                if (databaseCreated) await admin.query(`DROP DATABASE IF EXISTS ${fixtureName}`)
                await admin.end()
            }
        }
    }, 60_000)

    it('migrates, reuses 99 of 100 JARs, preserves URLs, retires legacy builds and collects expired deleted sources', async () => {
        const moduleIds: string[] = []
        const sourceIds: string[] = []
        for (let index = 0; index < 100; index++) {
            const uploadId = await source(`original jar ${index}`, `library-${index}-1.0.jar`)
            const id = randomUUID()
            moduleIds.push(id)
            sourceIds.push(uploadId)
            await getPool().execute(
                `INSERT INTO modules (id, project_id, server_id, upload_id, type, display_name, file_name, sort_order)
                 VALUES (?, ?, ?, ?, 'Library', ?, ?, ?)`,
                [id, projectId, serverId, uploadId, `Library ${index}`, `library-${index}-1.0.jar`, index]
            )
        }
        await getPool().execute(
            `INSERT INTO server_builds (id, project_id, server_id, source_revision, spec, object_prefix, created_at)
             VALUES (?, ?, ?, 0, '{}', 'public/test/server-builds/legacy', UTC_TIMESTAMP(3))`, [randomUUID(), projectId, serverId]
        )
        const first = await publish()
        const initial = await readStoredJson('public/test/distribution.json')
        const second = await publish()
        expect(second.metrics).toMatchObject({ parseCacheHits: 100, objectCacheHits: 100, downloadedBytes: 0, copiedBytes: 0 })
        expect(second.metrics.s3Requests).toEqual({ PutObjectCommand: 1, HeadObjectCommand: 2 })
        const replacement = await source('replacement jar', 'library-57-1.0.jar')
        await getPool().execute('UPDATE modules SET upload_id = ? WHERE id = ?', [replacement, moduleIds[57]])
        await getPool().execute('UPDATE servers SET name = \'Renamed\', revision = revision + 1 WHERE id = ?', [serverId])
        const third = await publish()
        const latest = await readStoredJson('public/test/distribution.json')
        expect(third.metrics).toMatchObject({ parseCacheHits: 99, objectCacheHits: 99, downloadedBytes: 15, copiedBytes: 15 })
        expect(third.metrics.s3Requests).toMatchObject({ GetObjectCommand: 1, CopyObjectCommand: 1, DeleteObjectsCommand: 1 })
        const before = initial.value as { servers: { modules: { artifact: { url: string } }[] }[] }
        const after = latest.value as { servers: { name: string, modules: { artifact: { url: string } }[] }[] }
        expect(after.servers[0].name).toBe('Renamed')
        expect(after.servers[0].modules[0].artifact.url).toBe(before.servers[0].modules[0].artifact.url)
        expect(after.servers[0].modules[57].artifact.url).not.toBe(before.servers[0].modules[57].artifact.url)
        const [objects] = await getPool().execute<(RowDataPacket & { count: number })[]>('SELECT COUNT(*) AS count FROM published_objects')
        expect(Number(objects[0].count)).toBe(100)
        const [legacy] = await getPool().execute<RowDataPacket[]>('SELECT id FROM server_builds')
        expect(legacy).toHaveLength(0)
        expect(first.snapshot.sourceDraftVersion).toBe(0)
        await getPool().execute(
            'UPDATE uploads SET status = \'DELETED\', deleted_at = TIMESTAMPADD(HOUR, -25, UTC_TIMESTAMP(3)) WHERE id = ?', [sourceIds[57]]
        )
        await withProjectStorageLock(projectId, () => cleanupProjectStorage(projectId))
        const [deleted] = await getPool().execute<RowDataPacket[]>('SELECT id FROM uploads WHERE id = ?', [sourceIds[57]])
        expect(deleted).toHaveLength(0)
    }, 60_000)
})
