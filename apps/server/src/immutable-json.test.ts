import { createHash } from 'crypto'
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('./config.js', () => ({ getConfig: (): unknown => ({ rustfs: {
    bucket: 'test', endpoint: 'http://localhost', region: 'us-east-1', accessKeyId: 'test', secretAccessKey: 'test'
} }) }))
vi.mock('@aws-sdk/client-s3', async () => ({
    ...await vi.importActual<typeof import('@aws-sdk/client-s3')>('@aws-sdk/client-s3'),
    S3Client: class {
        send = mocks.send
        middlewareStack = { add: (): void => undefined }
    }
}))

import { IMMUTABLE_JSON_CACHE_CONTROL, putImmutableJson, putJson } from './storage.js'

const body = Buffer.from('{"id":"server","modules":[]}')
const sha256 = createHash('sha256').update(body).digest('hex')
const md5 = createHash('md5').update(body).digest('hex')
const key = `public/test/server-distributions/${sha256}.json`
const head = { ContentLength: body.length, Metadata: { sha256, md5 }, CacheControl: IMMUTABLE_JSON_CACHE_CONTROL }

beforeEach(() => { vi.resetAllMocks() })

describe('immutable server JSON storage', () => {
    it('uploads exact compact bytes on a cache miss and verifies them before returning', async () => {
        mocks.send.mockRejectedValueOnce({ name: 'NotFound' }).mockResolvedValueOnce({}).mockResolvedValueOnce(head)
        expect(await putImmutableJson(key, body)).toEqual({ objectKey: key, size: body.length, sha256, md5 })
        expect(mocks.send.mock.calls.map(([command]) => (command as object).constructor.name))
            .toEqual(['HeadObjectCommand', 'PutObjectCommand', 'HeadObjectCommand'])
        const put = mocks.send.mock.calls[1][0] as PutObjectCommand
        expect(put.input.Body).toEqual(body)
        expect(put.input.ContentLength).toBe(body.length)
        expect(put.input.CacheControl).toBe(IMMUTABLE_JSON_CACHE_CONTROL)
        expect(put.input.Metadata).toEqual({ md5, sha256 })
    })

    it('reuses verified contents without uploading', async () => {
        mocks.send.mockResolvedValue(head)
        expect((await putImmutableJson(key, body)).sha256).toBe(sha256)
        expect(mocks.send).toHaveBeenCalledTimes(1)
        expect(mocks.send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand)
    })

    it('repairs a corrupt object with deterministic bytes', async () => {
        mocks.send.mockResolvedValueOnce({ ...head, ContentLength: 1 }).mockResolvedValueOnce({}).mockResolvedValueOnce(head)
        await putImmutableJson(key, body)
        expect(mocks.send.mock.calls[1][0]).toBeInstanceOf(PutObjectCommand)
        expect((mocks.send.mock.calls[1][0] as PutObjectCommand).input.Body).toEqual(body)
    })

    it('does not treat authorization or transport failures as cache misses', async () => {
        mocks.send.mockRejectedValue(new Error('Access denied'))
        await expect(putImmutableJson(key, body)).rejects.toThrow('Access denied')
        expect(mocks.send).toHaveBeenCalledTimes(1)
    })

    it('propagates interrupted uploads without returning a reference', async () => {
        mocks.send.mockRejectedValueOnce({ name: 'NotFound' }).mockRejectedValueOnce(new Error('Upload interrupted'))
        await expect(putImmutableJson(key, body)).rejects.toThrow('Upload interrupted')
    })

    it('rejects a PUT whose resulting metadata does not match', async () => {
        mocks.send.mockRejectedValueOnce({ name: 'NotFound' }).mockResolvedValueOnce({}).mockResolvedValue({ ...head, ContentLength: 1 })
        await expect(putImmutableJson(key, body)).rejects.toThrow('RustFS verification failed')
    })

    it('preserves the existing pretty JSON writer and release metadata', async () => {
        const value = { version: '1.0.0', servers: [] }
        const pretty = Buffer.from(JSON.stringify(value, null, 2))
        mocks.send.mockResolvedValueOnce({}).mockResolvedValueOnce({
            ContentLength: pretty.length, CacheControl: 'no-cache, must-revalidate',
            Metadata: {
                sha256: createHash('sha256').update(pretty).digest('hex'),
                md5: createHash('md5').update(pretty).digest('hex'), 'release-id': 'job'
            }
        })
        await putJson('public/test/distribution.json', value, 'no-cache, must-revalidate', { 'release-id': 'job' })
        const put = mocks.send.mock.calls[0][0] as PutObjectCommand
        expect(put.input.Body).toEqual(pretty)
        expect(put.input.Metadata?.['release-id']).toBe('job')
    })
})
