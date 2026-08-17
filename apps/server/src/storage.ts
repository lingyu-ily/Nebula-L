import { createHash, randomUUID } from 'crypto'
import { createReadStream, createWriteStream } from 'fs'
import { mkdtemp, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import {
    DeleteObjectsCommand,
    GetObjectCommand,
    HeadBucketCommand,
    HeadObjectCommand,
    type HeadObjectCommandOutput,
    PutObjectCommand,
    S3Client
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { getConfig } from './config.js'

export interface StoredObject {
    objectKey: string
    size: number
    md5: string
    sha256: string
}

export interface StoredObjectExpectation {
    size: number
    md5?: string
    sha256: string
    cacheControl?: string
    releaseId?: string
}

interface StoredObjectMetadata {
    contentLength: number | undefined
    md5?: string | undefined
    sha256: string | undefined
    cacheControl: string | undefined
    releaseId: string | undefined
}

export class StorageObjectMissingError extends Error {
    constructor(
        readonly objectKey: string,
        readonly cause: unknown
    ) {
        super(`RustFS object ${objectKey} does not exist`)
        this.name = 'StorageObjectMissingError'
    }
}

export class StorageObjectIntegrityError extends Error {
    constructor(readonly objectKey: string) {
        super(`RustFS verification failed for ${objectKey}`)
        this.name = 'StorageObjectIntegrityError'
    }
}

export function isStorageObjectMissingError(error: unknown): error is StorageObjectMissingError {
    return error instanceof StorageObjectMissingError
        || (typeof error === 'object' && error != null && (error as { name?: string }).name === 'StorageObjectMissingError')
}

export function isStorageObjectIntegrityError(error: unknown): error is StorageObjectIntegrityError {
    return error instanceof StorageObjectIntegrityError
        || (typeof error === 'object' && error != null && (error as { name?: string }).name === 'StorageObjectIntegrityError')
}

export function storedObjectMetadataMatches(
    actual: StoredObjectMetadata,
    expected: StoredObjectExpectation
): boolean {
    return actual.contentLength === expected.size
        && (expected.md5 == null || actual.md5 === expected.md5)
        && actual.sha256 === expected.sha256
        && (expected.cacheControl == null || actual.cacheControl === expected.cacheControl)
        && (expected.releaseId == null || actual.releaseId === expected.releaseId)
}

export function storedUploadMetadataMatches(
    actual: Pick<StoredObjectMetadata, 'contentLength' | 'md5' | 'sha256'>,
    expected: Pick<StoredObjectExpectation, 'size' | 'md5' | 'sha256'>
): boolean {
    return actual.contentLength === expected.size
        && (actual.md5 == null || actual.md5 === expected.md5)
        && (actual.sha256 == null || actual.sha256 === expected.sha256)
}

let client: S3Client | undefined

export function getStorageClient(): S3Client {
    if (!client) {
        const config = getConfig().rustfs
        client = new S3Client({
            endpoint: config.endpoint,
            region: config.region,
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey
            },
            forcePathStyle: true
        })
    }
    return client
}

function safeName(name: string): string {
    return basename(name).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 255) || 'upload.bin'
}

export interface StagedUpload extends Omit<StoredObject, 'objectKey'> {
    directory: string
    path: string
}

export async function stageUpload(
    source: Readable,
    maxBytes: number,
    temporaryRoot = tmpdir()
): Promise<StagedUpload> {
    const directory = await mkdtemp(join(temporaryRoot, 'nebula-upload-'))
    const path = join(directory, 'payload')
    const md5 = createHash('md5')
    const sha256 = createHash('sha256')
    let size = 0
    const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback): void {
            size += chunk.length
            if (size > maxBytes) {
                callback(new Error(`Upload exceeds ${maxBytes} bytes`))
                return
            }
            md5.update(chunk)
            sha256.update(chunk)
            callback(null, chunk)
        }
    })
    try {
        await pipeline(source, meter, createWriteStream(path, { flags: 'wx' }))
        return {
            directory,
            path,
            size,
            md5: md5.digest('hex'),
            sha256: sha256.digest('hex')
        }
    } catch (error) {
        source.destroy()
        await rm(directory, { recursive: true, force: true })
        throw error
    }
}

async function uploadKnownFile(
    path: string,
    objectKey: string,
    contentType: string,
    cacheControl: string,
    hashes: Omit<StoredObject, 'objectKey'>,
    metadata: Record<string, string> = {}
): Promise<void> {
    const upload = new Upload({
        client: getStorageClient(),
        params: {
            Bucket: getConfig().rustfs.bucket,
            Key: objectKey,
            Body: createReadStream(path),
            ContentLength: hashes.size,
            ContentType: contentType,
            CacheControl: cacheControl,
            Metadata: {
                md5: hashes.md5,
                sha256: hashes.sha256,
                ...metadata
            }
        },
        queueSize: 4,
        partSize: 8 * 1024 * 1024,
        leavePartsOnError: false
    })
    await upload.done()
}

async function deleteObjectBestEffort(objectKey: string): Promise<void> {
    try {
        await deleteObjects([objectKey])
    } catch {
        // Preserve the upload or verification error that caused cleanup.
    }
}

export async function uploadStream(
    projectId: string,
    originalName: string,
    contentType: string,
    source: Readable,
    maxBytes: number
): Promise<StoredObject> {
    const objectKey = `private/uploads/${projectId}/${randomUUID()}/${safeName(originalName)}`
    const staged = await stageUpload(source, maxBytes)
    const cacheControl = 'private, no-store'
    try {
        await uploadKnownFile(staged.path, objectKey, contentType, cacheControl, staged)
        await verifyStoredObject(objectKey, { ...staged, cacheControl })
    } catch (error) {
        await deleteObjectBestEffort(objectKey)
        throw error
    } finally {
        await rm(staged.directory, { recursive: true, force: true })
    }
    return {
        objectKey,
        size: staged.size,
        md5: staged.md5,
        sha256: staged.sha256
    }
}

export async function downloadToFile(objectKey: string, destination: string): Promise<void> {
    const response = await getStorageClient().send(new GetObjectCommand({
        Bucket: getConfig().rustfs.bucket,
        Key: objectKey
    }))
    if (!response.Body) {
        throw new Error(`RustFS object ${objectKey} has no body`)
    }
    await pipeline(response.Body as Readable, createWriteStream(destination))
}

export async function getStoredObject(objectKey: string): Promise<{
    body: Readable
    contentLength?: number
    contentType?: string
}> {
    const response = await getStorageClient().send(new GetObjectCommand({
        Bucket: getConfig().rustfs.bucket,
        Key: objectKey
    }))
    if (!response.Body) {
        throw new Error(`RustFS object ${objectKey} has no body`)
    }
    return {
        body: response.Body as Readable,
        contentLength: response.ContentLength == null ? undefined : Number(response.ContentLength),
        contentType: response.ContentType
    }
}

async function hashFile(path: string): Promise<Omit<StoredObject, 'objectKey'>> {
    const md5 = createHash('md5')
    const sha256 = createHash('sha256')
    const stream = createReadStream(path)
    for await (const chunk of stream) {
        md5.update(chunk as Buffer)
        sha256.update(chunk as Buffer)
    }
    const fileStat = await stat(path)
    return { size: fileStat.size, md5: md5.digest('hex'), sha256: sha256.digest('hex') }
}

export async function uploadFile(
    path: string,
    objectKey: string,
    contentType = 'application/octet-stream',
    cacheControl = 'public, max-age=31536000, immutable'
): Promise<StoredObject> {
    const hashes = await hashFile(path)
    try {
        await uploadKnownFile(path, objectKey, contentType, cacheControl, hashes)
        await verifyStoredObject(objectKey, { ...hashes, cacheControl })
    } catch (error) {
        await deleteObjectBestEffort(objectKey)
        throw error
    }
    return { objectKey, ...hashes }
}

export async function putJson(objectKey: string, value: unknown, cacheControl: string): Promise<void> {
    const body = Buffer.from(JSON.stringify(value, null, 2))
    const md5 = createHash('md5').update(body).digest('hex')
    const sha256 = createHash('sha256').update(body).digest('hex')
    await getStorageClient().send(new PutObjectCommand({
        Bucket: getConfig().rustfs.bucket,
        Key: objectKey,
        Body: body,
        ContentType: 'application/json; charset=utf-8',
        ContentLength: body.length,
        CacheControl: cacheControl,
        Metadata: { md5, sha256 }
    }))
}

export async function copyJson(
    sourceKey: string,
    destinationKey: string,
    cacheControl: string,
    releaseId?: string
): Promise<StoredObject> {
    const source = await getStorageClient().send(new GetObjectCommand({
        Bucket: getConfig().rustfs.bucket,
        Key: sourceKey
    }))
    if (!source.Body) {
        throw new Error(`RustFS object ${sourceKey} has no body`)
    }
    const body = Buffer.from(await source.Body.transformToByteArray())
    const md5 = createHash('md5').update(body).digest('hex')
    const sha256 = createHash('sha256').update(body).digest('hex')
    await getStorageClient().send(new PutObjectCommand({
        Bucket: getConfig().rustfs.bucket,
        Key: destinationKey,
        ContentType: 'application/json; charset=utf-8',
        ContentLength: body.length,
        CacheControl: cacheControl,
        Metadata: { md5, sha256, ...(releaseId ? { 'release-id': releaseId } : {}) },
        Body: body
    }))
    await verifyStoredObject(destinationKey, { size: body.length, sha256, cacheControl, releaseId })
    return { objectKey: destinationKey, size: body.length, md5, sha256 }
}

export async function verifyStoredObject(
    objectKey: string,
    expected: StoredObjectExpectation
): Promise<void> {
    const head = await headStoredObject(objectKey)
    const matches = storedObjectMetadataMatches({
        contentLength: head.ContentLength == null ? undefined : Number(head.ContentLength),
        md5: head.Metadata?.md5,
        sha256: head.Metadata?.sha256,
        cacheControl: head.CacheControl,
        releaseId: head.Metadata?.['release-id']
    }, expected)
    if (!matches) {
        throw new StorageObjectIntegrityError(objectKey)
    }
}

export function isNoSuchKeyError(error: unknown): boolean {
    if (typeof error !== 'object' || error == null) {
        return false
    }
    const value = error as {
        name?: string
        Code?: string
        code?: string
        $metadata?: { httpStatusCode?: number }
    }
    return value.name === 'NoSuchKey'
        || value.name === 'NotFound'
        || value.Code === 'NoSuchKey'
        || value.code === 'NoSuchKey'
        || value.$metadata?.httpStatusCode === 404
}

export async function retryNoSuchKey<T>(
    operation: () => Promise<T>,
    retryDelays = [0, 100, 200, 400, 800, 1000],
    wait: (milliseconds: number) => Promise<void> = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
): Promise<T> {
    let missingError: unknown
    for (const delayMs of retryDelays) {
        if (delayMs > 0) {
            await wait(delayMs)
        }
        try {
            return await operation()
        } catch (error) {
            if (!isNoSuchKeyError(error)) {
                throw error
            }
            missingError = error
        }
    }
    throw missingError
}

async function headStoredObject(objectKey: string): Promise<HeadObjectCommandOutput> {
    try {
        return await retryNoSuchKey(() => getStorageClient().send(new HeadObjectCommand({
            Bucket: getConfig().rustfs.bucket,
            Key: objectKey
        })))
    } catch (error) {
        if (isNoSuchKeyError(error)) {
            throw new StorageObjectMissingError(objectKey, error)
        }
        throw error
    }
}

export async function verifyStoredUpload(
    objectKey: string,
    expected: Pick<StoredObjectExpectation, 'size' | 'md5' | 'sha256'>
): Promise<void> {
    const head = await headStoredObject(objectKey)
    const contentLength = head.ContentLength == null ? undefined : Number(head.ContentLength)
    const storedMd5 = head.Metadata?.md5
    const storedSha256 = head.Metadata?.sha256
    const matches = storedUploadMetadataMatches({
        contentLength,
        md5: storedMd5,
        sha256: storedSha256
    }, expected)
    if (!matches) {
        throw new StorageObjectIntegrityError(objectKey)
    }
}

export async function deleteObjects(keys: string[]): Promise<void> {
    for (let index = 0; index < keys.length; index += 1000) {
        const batch = keys.slice(index, index + 1000)
        if (batch.length === 0) {
            continue
        }
        await getStorageClient().send(new DeleteObjectsCommand({
            Bucket: getConfig().rustfs.bucket,
            Delete: { Objects: batch.map(Key => ({ Key })), Quiet: true }
        }))
    }
}

export async function checkStorage(): Promise<void> {
    await getStorageClient().send(new HeadBucketCommand({ Bucket: getConfig().rustfs.bucket }))
}

export async function destroyStorage(): Promise<void> {
    client?.destroy()
    client = undefined
}
