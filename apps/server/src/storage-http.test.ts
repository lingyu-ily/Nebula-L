import { createServer, type Server } from 'http'
import { createHash } from 'crypto'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => ({ endpoint: '' }))
vi.mock('./db/index.js', (): Record<string, unknown> => ({ getPool: (): unknown => ({
    execute: async (): Promise<unknown[]> => [{ affectedRows: 1 }]
}) }))
vi.mock('./config.js', () => ({ getConfig: (): unknown => ({ rustfs: {
    endpoint: settings.endpoint, region: 'us-east-1', bucket: 'test-bucket', accessKeyId: 'test', secretAccessKey: 'test-secret'
} }) }))

import { copyStoredUpload, deleteObjectPrefix, destroyStorage, downloadToFile, putJson, readStoredJson, uploadFile } from './storage.js'
import { createPublishMetrics, withPublishMetrics } from './publish-metrics.js'
import { PublishCache } from './publish-cache.js'

interface ObjectData {
    body: Buffer
    metadata: Record<string, string>
    contentType: string
    cacheControl: string
}

let server: Server
let directory: string
const objects = new Map<string, ObjectData>()
const calls: { method: string, key: string }[] = []

// This deliberately local S3 protocol fixture runs the real AWS SDK transport,
// XML codecs, CopySource encoding, metadata verification and request middleware.
// It complements unit tests; it is not a replacement for a live RustFS test.
beforeEach(async () => {
    objects.clear()
    calls.length = 0
    directory = await mkdtemp(join(tmpdir(), 'nebula-s3-http-'))
    server = createServer((request, response) => {
        void (async (): Promise<void> => {
            const url = new URL(request.url!, 'http://localhost')
            const key = decodeURIComponent(url.pathname).replace(/^\/test-bucket\/?/, '')
            calls.push({ method: request.method!, key })
            const chunks: Buffer[] = []
            for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array))
            const body = Buffer.concat(chunks)
            const metadata = Object.fromEntries(Object.entries(request.headers)
                .filter(([name]) => name.startsWith('x-amz-meta-')).map(([name, value]) => [name.slice(11), String(value)]))
            const contentType = String(request.headers['content-type'] ?? 'application/octet-stream')
            const cacheControl = String(request.headers['cache-control'] ?? '')
            if (request.method === 'PUT') {
                const copySource = request.headers['x-amz-copy-source']
                if (copySource) {
                    const sourceKey = decodeURIComponent(String(copySource)).replace(/^\/?test-bucket\//, '')
                    const source = objects.get(sourceKey)
                    if (!source) { response.writeHead(404); response.end(); return }
                    objects.set(key, { body: source.body, metadata, contentType, cacheControl })
                    response.setHeader('content-type', 'application/xml')
                    response.end('<CopyObjectResult><LastModified>2026-10-07T00:00:00Z</LastModified><ETag>"copy"</ETag></CopyObjectResult>')
                } else {
                    objects.set(key, { body, metadata, contentType, cacheControl })
                    response.setHeader('etag', '"uploaded"')
                    response.end()
                }
                return
            }
            if (request.method === 'GET' && url.searchParams.has('list-type')) {
                const keys = [...objects.keys()].filter(value => value.startsWith(url.searchParams.get('prefix') ?? ''))
                response.setHeader('content-type', 'application/xml')
                response.end(`<ListBucketResult><Name>test-bucket</Name><IsTruncated>false</IsTruncated>${keys.map(value => `<Contents><Key>${value}</Key></Contents>`).join('')}</ListBucketResult>`)
                return
            }
            if (request.method === 'POST' && url.searchParams.has('delete')) {
                for (const match of body.toString().matchAll(/<Key>([^<]+)<\/Key>/g)) objects.delete(match[1])
                response.setHeader('content-type', 'application/xml')
                response.end('<DeleteResult/>')
                return
            }
            const object = objects.get(key)
            if (!object) { response.writeHead(404); response.end(); return }
            response.setHeader('content-length', object.body.length)
            response.setHeader('content-type', object.contentType)
            response.setHeader('cache-control', object.cacheControl)
            for (const [name, value] of Object.entries(object.metadata)) response.setHeader(`x-amz-meta-${name}`, value)
            response.end(request.method === 'HEAD' ? undefined : object.body)
        })().catch((error: unknown) => {
            response.writeHead(500)
            response.end(error instanceof Error ? error.message : String(error))
        })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not bind a port')
    settings.endpoint = `http://127.0.0.1:${address.port}`
})

afterEach(async () => {
    await destroyStorage()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await rm(directory, { recursive: true, force: true })
})

describe('local S3 HTTP transport', () => {
    it('reuses an identical public object without another S3 HEAD, GET or COPY', async () => {
        const body = Buffer.from('unchanged content')
        const hashes = { size: body.length, md5: createHash('md5').update(body).digest('hex'), sha256: createHash('sha256').update(body).digest('hex') }
        for (const key of ['private/source-a', 'private/source-b']) {
            objects.set(key, { body, metadata: { md5: hashes.md5, sha256: hashes.sha256 }, contentType: 'application/octet-stream', cacheControl: 'private, no-store' })
        }
        const metrics = createPublishMetrics()
        const cache = new PublishCache('project', 'test', 'job', metrics)
        await withPublishMetrics(metrics, async () => {
            const first = await cache.source({ ...hashes, objectKey: 'private/source-a' }, 'application/java-archive')
            const requestCount = calls.length
            const second = await cache.source({ ...hashes, objectKey: 'private/source-b' }, 'application/java-archive')
            expect(second.objectKey).toBe(first.objectKey)
            expect(calls).toHaveLength(requestCount)
        })
        expect([...objects.keys()].filter(key => key.startsWith('public/'))).toHaveLength(1)
        expect(metrics).toMatchObject({ copiedBytes: body.length, objectCacheHits: 1, s3Requests: { HeadObjectCommand: 2, CopyObjectCommand: 1 } })
    })

    it('copies bytes inside S3, verifies metadata, reads content, and counts actual requests', async () => {
        const body = Buffer.from('module bytes')
        const hashes = { size: body.length, md5: createHash('md5').update(body).digest('hex'), sha256: createHash('sha256').update(body).digest('hex') }
        objects.set('private/中文 file/payload', { body, metadata: { md5: hashes.md5, sha256: hashes.sha256 }, contentType: 'application/octet-stream', cacheControl: 'private, no-store' })
        const metrics = createPublishMetrics()
        await withPublishMetrics(metrics, async () => {
            await copyStoredUpload('private/中文 file/payload', 'public/test/objects/module/payload', 'application/java-archive', hashes)
            await downloadToFile('public/test/objects/module/payload', join(directory, 'module.jar'))
        })
        expect(await readFile(join(directory, 'module.jar'))).toEqual(body)
        expect(metrics).toMatchObject({
            copiedBytes: body.length, downloadedBytes: body.length,
            s3Requests: { CopyObjectCommand: 1, HeadObjectCommand: 1, GetObjectCommand: 1 }
        })
        expect(objects.get('private/中文 file/payload')?.body).toEqual(body)
        expect(objects.get('public/test/objects/module/payload')?.cacheControl).toBe('public, max-age=31536000, immutable')
    })

    it('uploads generated content, verifies the stable release metadata, and deletes by prefix', async () => {
        const metrics = createPublishMetrics()
        await writeFile(join(directory, 'generated.jar'), 'generated')
        await withPublishMetrics(metrics, async () => {
            await uploadFile(join(directory, 'generated.jar'), 'public/test/objects/generated/payload', 'application/java-archive')
            await putJson('public/test/distribution.json', { servers: [] }, 'no-cache, must-revalidate', { 'release-id': 'job-1' })
            const stable = await readStoredJson('public/test/distribution.json')
            expect(stable).toMatchObject({ releaseId: 'job-1', value: { servers: [] }, cacheControl: 'no-cache, must-revalidate' })
            expect(stable.sha256).toBe(stable.storedSha256)
            expect(await deleteObjectPrefix('public/test/objects/')).toBe(1)
        })
        expect(objects.has('public/test/objects/generated/payload')).toBe(false)
        expect(objects.has('public/test/distribution.json')).toBe(true)
        expect(metrics.s3Requests).toMatchObject({ PutObjectCommand: 2, HeadObjectCommand: 2, GetObjectCommand: 1, ListObjectsV2Command: 1, DeleteObjectsCommand: 1 })
        expect(metrics.uploadedBytes).toBe(9 + objects.get('public/test/distribution.json')!.body.length)
    })
})
