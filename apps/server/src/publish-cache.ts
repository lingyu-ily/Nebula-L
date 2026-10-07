import { createHash } from 'crypto'
import type { Module } from 'helios-distribution-types'
import type { RowDataPacket } from 'mysql2/promise'
import { getPool } from './db/index.js'
import { copyStoredUpload, hashFile, uploadFile, verifyStoredUpload, type StoredObject } from './storage.js'
import type { PublishMetrics } from './publish-metrics.js'

export function fingerprint(value: unknown): string {
    const serialized = JSON.stringify(value, (_key, item: unknown): unknown => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
            const record = item as Record<string, unknown>
            return Object.fromEntries(Object.keys(record).sort().map(key => [key, record[key]]))
        }
        return item
    })
    return createHash('sha256').update(serialized).digest('hex')
}

export function publishedObjectIdentity(sha256: string, contentType: string): string {
    return fingerprint([sha256, contentType])
}

export function publishedObjectKey(slug: string, sha256: string, contentType: string): string {
    return `public/${slug}/objects/${sha256}/${fingerprint(contentType).slice(0, 16)}/payload`
}

export interface PublishedObject extends StoredObject {
    id: string
    contentType: string
    verified: boolean
}

interface ObjectRow extends RowDataPacket {
    id: string
    object_key: string
    sha256: string
    md5: string
    size: number
    content_type: string
    verified: number
}

interface CacheRow extends RowDataPacket {
    cache_key: string
    spec: Module | Module[] | string
    object_ids?: string[] | string
}

export interface LoaderCache {
    modules: Module[]
    objectIds: string[]
}

function fromJson<T>(value: T | string): T {
    return typeof value === 'string' ? JSON.parse(value) as T : value
}

export class PublishCache {
    readonly objects = new Map<string, PublishedObject>()
    readonly parsed = new Map<string, Module>()
    readonly loaders = new Map<string, LoaderCache>()
    readonly references = new Set<string>()

    constructor(readonly projectId: string, readonly slug: string, readonly jobId: string, readonly metrics: PublishMetrics) {}

    async load(): Promise<void> {
        const [objects] = await getPool().execute<ObjectRow[]>(
            'SELECT * FROM published_objects WHERE project_id = ?', [this.projectId]
        )
        for (const object of objects) {
            this.objects.set(object.id, {
                id: object.id, objectKey: object.object_key, sha256: object.sha256, md5: object.md5,
                size: Number(object.size), contentType: object.content_type, verified: Boolean(object.verified)
            })
        }
        const [parsed] = await getPool().execute<CacheRow[]>(
            'SELECT cache_key, spec FROM publish_parse_cache WHERE project_id = ?', [this.projectId]
        )
        for (const row of parsed) this.parsed.set(row.cache_key, fromJson<Module>(row.spec as Module | string))
        const [loaders] = await getPool().execute<CacheRow[]>(
            'SELECT cache_key, spec, object_ids FROM publish_loader_cache WHERE project_id = ?', [this.projectId]
        )
        for (const row of loaders) this.loaders.set(row.cache_key, {
            modules: fromJson<Module[]>(row.spec as Module[] | string),
            objectIds: fromJson<string[]>(row.object_ids!)
        })
    }

    async reference(object: PublishedObject): Promise<void> {
        this.references.add(object.id)
    }

    async flushReferences(): Promise<void> {
        const ids = [...this.references]
        for (let offset = 0; offset < ids.length; offset += 500) {
            const batch = ids.slice(offset, offset + 500)
            await getPool().execute(
                `INSERT IGNORE INTO publish_object_refs (project_id, job_id, object_id) VALUES ${batch.map(() => '(?, ?, ?)').join(', ')}`,
                batch.flatMap(id => [this.projectId, this.jobId, id])
            )
        }
    }

    async ensureObject(
        hashes: Omit<StoredObject, 'objectKey'>,
        contentType: string,
        write: (key: string) => Promise<StoredObject>
    ): Promise<PublishedObject> {
        const id = publishedObjectIdentity(hashes.sha256, contentType)
        const existing = this.objects.get(id)
        if (existing?.verified) {
            this.metrics.objectCacheHits++
            await this.reference(existing)
            return existing
        }
        const object: PublishedObject = {
            ...hashes, id, contentType, verified: false,
            objectKey: publishedObjectKey(this.slug, hashes.sha256, contentType)
        }
        // Register before writing so a crash leaves a discoverable, retryable object.
        await getPool().execute(
            `INSERT INTO published_objects (project_id, id, object_key, sha256, md5, size, content_type, verified)
             VALUES (?, ?, ?, ?, ?, ?, ?, FALSE)
             ON DUPLICATE KEY UPDATE verified = FALSE`,
            [this.projectId, id, object.objectKey, hashes.sha256, hashes.md5, hashes.size, contentType]
        )
        await this.reference(object)
        await write(object.objectKey)
        await getPool().execute(
            'UPDATE published_objects SET verified = TRUE WHERE project_id = ? AND id = ?', [this.projectId, id]
        )
        object.verified = true
        this.objects.set(id, object)
        return object
    }

    async source(upload: StoredObject, contentType: string): Promise<PublishedObject> {
        return this.ensureObject(upload, contentType, async key => {
            await verifyStoredUpload(upload.objectKey, upload)
            return copyStoredUpload(upload.objectKey, key, contentType, upload)
        })
    }

    async generated(path: string, contentType: string): Promise<PublishedObject> {
        return this.ensureObject(await hashFile(path), contentType, key => uploadFile(path, key, contentType))
    }

    async saveParsed(key: string, module: Module): Promise<void> {
        await getPool().execute(
            `INSERT INTO publish_parse_cache (project_id, cache_key, spec) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE spec = VALUES(spec)`, [this.projectId, key, JSON.stringify(module)]
        )
        this.parsed.set(key, module)
    }

    async saveLoader(key: string, cache: LoaderCache): Promise<void> {
        await getPool().execute(
            `INSERT INTO publish_loader_cache (project_id, cache_key, spec, object_ids) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE spec = VALUES(spec), object_ids = VALUES(object_ids)`,
            [this.projectId, key, JSON.stringify(cache.modules), JSON.stringify(cache.objectIds)]
        )
        this.loaders.set(key, cache)
    }
}
