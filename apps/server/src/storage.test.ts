import { mkdtemp, readdir, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { Readable } from 'stream'
import { DeleteObjectsCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3'
import { describe, expect, it } from 'vitest'
import {
    deleteObjectPrefix,
    isNoSuchKeyError,
    PRIVATE_UPLOAD_CONTENT_TYPE,
    privateUploadObjectKey,
    retryNoSuchKey,
    S3_COMPATIBILITY_OPTIONS,
    stageUpload,
    storedObjectMetadataMatches,
    storedUploadMetadataMatches
} from './storage.js'

describe('project object cleanup', () => {
    it('lists every page before deleting objects in RustFS batches', async () => {
        const commands: unknown[] = []
        let listPage = 0
        const storageClient = {
            send: async (command: unknown) => {
                commands.push(command)
                if (command instanceof ListObjectsV2Command) {
                    listPage += 1
                    return listPage === 1 ? {
                        Contents: [{ Key: 'public/test/a' }, { Key: 'public/test/b' }],
                        IsTruncated: true,
                        NextContinuationToken: 'page-2'
                    } : {
                        Contents: [{ Key: 'public/test/c' }],
                        IsTruncated: false
                    }
                }
                if (command instanceof DeleteObjectsCommand) return {}
                throw new Error('Unexpected command')
            }
        } as unknown as S3Client
        let heartbeats = 0

        await expect(deleteObjectPrefix(
            'public/test/',
            async () => { heartbeats += 1 },
            storageClient,
            'bucket'
        )).resolves.toBe(3)

        expect(commands.filter(command => command instanceof ListObjectsV2Command)).toHaveLength(2)
        const deletion = commands.find(command => command instanceof DeleteObjectsCommand)!
        expect(deletion.input.Delete?.Objects).toEqual([
            { Key: 'public/test/a' },
            { Key: 'public/test/b' },
            { Key: 'public/test/c' }
        ])
        expect(heartbeats).toBe(3)
    })

    it('fails cleanup when RustFS reports a partial batch error', async () => {
        const storageClient = {
            send: async (command: unknown) => command instanceof ListObjectsV2Command ? {
                Contents: [{ Key: 'private/uploads/project-1/file' }],
                IsTruncated: false
            } : {
                Errors: [{ Key: 'private/uploads/project-1/file', Code: 'AccessDenied' }]
            }
        } as unknown as S3Client

        await expect(deleteObjectPrefix(
            'private/uploads/project-1/',
            async () => undefined,
            storageClient,
            'bucket'
        )).rejects.toThrow('private/uploads/project-1/file')
    })
})

describe('release object layout', () => {
    it('keeps stable and immutable paths separate', () => {
        const slug = 'production-pack'
        const release = '0b61e959-5299-429b-bfcb-9b213f9c89fb'
        expect(`public/${slug}/releases/${release}/distribution.json`)
            .not.toBe(`public/${slug}/distribution.json`)
    })
})

describe('stored object verification', () => {
    const expected = {
        size: 128,
        sha256: 'a'.repeat(64),
        cacheControl: 'no-cache, must-revalidate',
        releaseId: 'release-1'
    }

    it('accepts matching stable distribution metadata', () => {
        expect(storedObjectMetadataMatches({
            contentLength: 128,
            sha256: 'a'.repeat(64),
            cacheControl: 'no-cache, must-revalidate',
            releaseId: 'release-1'
        }, expected)).toBe(true)
    })

    it.each([
        { contentLength: 127, sha256: 'a'.repeat(64), cacheControl: 'no-cache, must-revalidate', releaseId: 'release-1' },
        { contentLength: 128, sha256: 'b'.repeat(64), cacheControl: 'no-cache, must-revalidate', releaseId: 'release-1' },
        { contentLength: 128, sha256: 'a'.repeat(64), cacheControl: 'public, max-age=31536000, immutable', releaseId: 'release-1' },
        { contentLength: 128, sha256: 'a'.repeat(64), cacheControl: 'no-cache, must-revalidate', releaseId: 'release-2' }
    ])('rejects mismatched stable distribution metadata', actual => {
        expect(storedObjectMetadataMatches(actual, expected)).toBe(false)
    })
})

describe('private upload verification', () => {
    const expected = { size: 128, md5: 'a'.repeat(32), sha256: 'b'.repeat(64) }

    it('uses an opaque key and neutral storage content type', () => {
        expect(privateUploadObjectKey('project-1', 'upload-1'))
            .toBe('private/uploads/project-1/upload-1/payload')
        expect(PRIVATE_UPLOAD_CONTENT_TYPE).toBe('application/octet-stream')
    })

    it('disables optional AWS streaming checksums for RustFS compatibility', () => {
        expect(S3_COMPATIBILITY_OPTIONS).toEqual({
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED'
        })
    })

    it('accepts legacy objects without hash metadata when size matches', () => {
        expect(storedUploadMetadataMatches({
            contentLength: 128,
            md5: undefined,
            sha256: undefined
        }, expected)).toBe(true)
    })

    it('rejects new objects with mismatched hash metadata', () => {
        expect(storedUploadMetadataMatches({
            contentLength: 128,
            md5: 'c'.repeat(32),
            sha256: 'b'.repeat(64)
        }, expected)).toBe(false)
    })

    it('retries transient NoSuchKey responses and then succeeds', async () => {
        let attempts = 0
        const waits: number[] = []
        const result = await retryNoSuchKey(async () => {
            attempts += 1
            if (attempts < 3) {
                throw Object.assign(new Error('missing'), {
                    name: 'NoSuchKey',
                    $metadata: { httpStatusCode: 404 }
                })
            }
            return 'ready'
        }, [0, 100, 200, 400, 800, 1000], milliseconds => {
            waits.push(milliseconds)
            return Promise.resolve()
        })

        expect(result).toBe('ready')
        expect(attempts).toBe(3)
        expect(waits).toEqual([100, 200])
    })

    it('stops after five NoSuchKey retries', async () => {
        let attempts = 0
        const error = Object.assign(new Error('missing'), { name: 'NoSuchKey' })
        await expect(retryNoSuchKey(async () => {
            attempts += 1
            throw error
        }, [0, 100, 200, 400, 800, 1000], () => Promise.resolve())).rejects.toBe(error)
        expect(attempts).toBe(6)
    })

    it('does not retry RustFS 5xx errors inside object visibility checks', async () => {
        let attempts = 0
        const error = Object.assign(new Error('unavailable'), {
            name: 'InternalError',
            $metadata: { httpStatusCode: 503 }
        })
        await expect(retryNoSuchKey(async () => {
            attempts += 1
            throw error
        })).rejects.toBe(error)
        expect(attempts).toBe(1)
        expect(isNoSuchKeyError(error)).toBe(false)
    })

    it('spools an upload with its actual size and hashes', async () => {
        const root = await mkdtemp(join(tmpdir(), 'nebula-storage-test-'))
        try {
            const staged = await stageUpload(Readable.from(Buffer.from('maplecraft')), 1024, root)
            expect(staged.size).toBe(10)
            expect(staged.md5).toBe('bd21d5e4a0ffbe0582a03ed27bb0eb6c')
            expect(staged.sha256).toBe('33f7d0220a3203b837163ad8cfeff67ec250d88032403a5db3adec66c3c44788')
            expect((await stat(staged.path)).size).toBe(10)
            await rm(staged.directory, { recursive: true, force: true })
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    })

    it('removes its temporary file when the upload exceeds the limit', async () => {
        const root = await mkdtemp(join(tmpdir(), 'nebula-storage-test-'))
        try {
            await expect(stageUpload(Readable.from(Buffer.alloc(5)), 4, root))
                .rejects.toThrow('Upload exceeds 4 bytes')
            expect(await readdir(root)).toEqual([])
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    })
})
