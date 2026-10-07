import type { RowDataPacket } from 'mysql2/promise'
import { getPool, withTransaction } from './db/index.js'
import { fingerprint } from './publish-cache.js'
import { activatePublish, type JobRow, type ProjectSnapshot } from './publisher.js'
import { ProjectStorageBusyError, withProjectStorageLock } from './project-storage-lock.js'
import { deleteObjectPrefix, deleteObjects, isNoSuchKeyError, readStoredJson } from './storage.js'
import { getStableDistributionKey, STABLE_CACHE_CONTROL } from './stable-distribution.js'

interface ProjectRow {
    id: string
    slug: string
    active_release_id: string | null
    stable_distribution_sha256: string | null
}

interface ManifestRow {
    job_id: string
    status: 'PREPARED' | 'WRITING' | 'ACTIVE' | 'RETIRED'
    distribution: unknown
}

function parsedJson<T>(value: T | string): T {
    return typeof value === 'string' ? JSON.parse(value) as T : value
}

export async function commitManifest(projectId: string, jobId: string): Promise<void> {
    await withTransaction(async connection => {
        await connection.execute(
            'UPDATE publish_manifests SET status = \'RETIRED\' WHERE project_id = ? AND job_id <> ?', [projectId, jobId]
        )
        await connection.execute(
            'UPDATE publish_manifests SET status = \'ACTIVE\' WHERE project_id = ? AND job_id = ?', [projectId, jobId]
        )
    })
}

export async function reconcileManifest(project: ProjectRow, manifests: ManifestRow[]): Promise<boolean> {
    const writing = manifests.filter(manifest => manifest.status === 'WRITING')
    if (writing.length === 0) return true
    let stable: Awaited<ReturnType<typeof readStoredJson>>
    try {
        stable = await readStoredJson(getStableDistributionKey(project.slug))
    } catch (error) {
        if (isNoSuchKeyError(error) && !project.active_release_id) {
            await getPool().execute(
                'UPDATE publish_manifests SET status = \'RETIRED\' WHERE project_id = ? AND status = \'WRITING\'', [project.id]
            )
            return true
        }
        throw error
    }
    const candidate = writing.find(manifest => manifest.job_id === stable.releaseId
        && fingerprint(parsedJson(manifest.distribution)) === fingerprint(stable.value))
    if (candidate && stable.storedSha256 === stable.sha256 && stable.cacheControl === STABLE_CACHE_CONTROL) {
        if (project.active_release_id !== candidate.job_id) {
            const [jobs] = await getPool().execute<JobRow[]>('SELECT * FROM jobs WHERE id = ? AND project_id = ?', [candidate.job_id, project.id])
            if (!jobs[0]) return false
            const snapshot = parsedJson(jobs[0].snapshot) as ProjectSnapshot
            await activatePublish(jobs[0], snapshot, {
                objectKey: getStableDistributionKey(project.slug), size: stable.size, md5: stable.md5, sha256: stable.sha256
            })
        }
        await commitManifest(project.id, candidate.job_id)
        return true
    }
    // Only discard an ambiguous candidate after confirming the previous active
    // distribution's actual bytes. Unknown content keeps all references pinned.
    if (stable.releaseId === project.active_release_id && stable.sha256 === project.stable_distribution_sha256) {
        await getPool().execute(
            'UPDATE publish_manifests SET status = \'RETIRED\' WHERE project_id = ? AND status = \'WRITING\'', [project.id]
        )
        return true
    }
    return false
}

export async function cleanupProjectStorage(projectId: string): Promise<void> {
    const [projects] = await getPool().execute<(RowDataPacket & ProjectRow)[]>(
        'SELECT id, slug, active_release_id, stable_distribution_sha256 FROM projects WHERE id = ? AND disabled = FALSE', [projectId]
    )
    const project = projects[0]
    if (!project) return
    // Includes import jobs: their frozen sources must survive private-upload GC.
    const [pending] = await getPool().execute<RowDataPacket[]>(
        'SELECT id FROM jobs WHERE project_id = ? AND status IN (\'QUEUED\', \'RUNNING\') LIMIT 1', [projectId]
    )
    if (pending.length) return
    const [manifests] = await getPool().execute<(RowDataPacket & ManifestRow)[]>(
        'SELECT job_id, status, distribution FROM publish_manifests WHERE project_id = ?', [projectId]
    )
    if (!await reconcileManifest(project, manifests)) return
    // The DB's active job is independently protected, even if activation was
    // committed but changing manifest states was interrupted.
    await getPool().execute(
        `DELETE r FROM publish_object_refs r
         INNER JOIN publish_manifests m ON m.project_id = r.project_id AND m.job_id = r.job_id
         WHERE r.project_id = ? AND m.status IN ('RETIRED', 'PREPARED')
           AND r.job_id <> COALESCE((SELECT active_release_id FROM projects WHERE id = ?), '')`, [projectId, projectId]
    )
    const [unused] = await getPool().execute<(RowDataPacket & { id: string, object_key: string })[]>(
        `SELECT o.id, o.object_key FROM published_objects o WHERE o.project_id = ?
         AND NOT EXISTS (SELECT 1 FROM publish_object_refs r WHERE r.project_id = o.project_id AND r.object_id = o.id)`, [projectId]
    )
    // Lock ownership makes the final reference check + S3 delete indivisible
    // relative to other publishers and cleaners, without holding a SQL transaction.
    for (let offset = 0; offset < unused.length; offset += 1000) {
        const batch = unused.slice(offset, offset + 1000)
        const [references] = await getPool().execute<(RowDataPacket & { object_id: string })[]>(
            `SELECT object_id FROM publish_object_refs WHERE project_id = ? AND object_id IN (${batch.map(() => '?').join(', ')})`,
            [projectId, ...batch.map(object => object.id)]
        )
        const retained = new Set(references.map(reference => reference.object_id))
        const deletable = batch.filter(object => !retained.has(object.id))
        if (!deletable.length) continue
        // A partial S3 delete or a failed DB delete must not leave missing
        // objects eligible for reuse without HEAD on the next publish.
        await getPool().execute(
            `UPDATE published_objects SET verified = FALSE WHERE project_id = ? AND id IN (${deletable.map(() => '?').join(', ')})`,
            [projectId, ...deletable.map(object => object.id)]
        )
        await deleteObjects(deletable.map(object => object.object_key))
        await getPool().execute(
            `DELETE FROM published_objects WHERE project_id = ? AND id IN (${deletable.map(() => '?').join(', ')})`,
            [projectId, ...deletable.map(object => object.id)]
        )
    }
    // Legacy prefixes are removed only once an incremental manifest is active.
    const [active] = await getPool().execute<RowDataPacket[]>(
        'SELECT job_id FROM publish_manifests WHERE project_id = ? AND status = \'ACTIVE\'', [projectId]
    )
    if (active.length) {
        const [legacy] = await getPool().execute<(RowDataPacket & { id: string, object_prefix: string })[]>(
            'SELECT id, object_prefix FROM server_builds WHERE project_id = ?', [projectId]
        )
        for (const build of legacy) {
            await deleteObjectPrefix(`${build.object_prefix}/`)
            await getPool().execute('DELETE FROM server_builds WHERE id = ?', [build.id])
        }
    }
    await cleanupDeletedUploads(projectId)
    await getPool().execute(
        `DELETE FROM publish_manifests WHERE project_id = ? AND status IN ('RETIRED', 'PREPARED')
         AND job_id <> COALESCE((SELECT active_release_id FROM projects WHERE id = ?), '')`, [projectId, projectId]
    )
}

export async function cleanupDeletedUploads(projectId: string): Promise<void> {
    // Serialize against draft edits, which lock the project before attaching
    // an upload; jobs are queued under the same lock. Recheck each candidate.
    await withTransaction(async connection => {
        await connection.query('SELECT id FROM projects WHERE id = ? FOR UPDATE', [projectId])
        const [pending] = await connection.query<RowDataPacket[]>(
            'SELECT id FROM jobs WHERE project_id = ? AND status IN (\'QUEUED\', \'RUNNING\') LIMIT 1', [projectId]
        )
        if (pending.length) return
        const [uploads] = await connection.query<(RowDataPacket & { id: string, object_key: string })[]>(
            `SELECT u.id, u.object_key FROM uploads u WHERE u.project_id = ? AND u.status = 'DELETED'
             AND u.deleted_at <= TIMESTAMPADD(HOUR, -24, UTC_TIMESTAMP(3))
             AND NOT EXISTS (SELECT 1 FROM modules m WHERE m.upload_id = u.id)
             AND NOT EXISTS (SELECT 1 FROM servers s WHERE s.icon_upload_id = u.id OR s.hero_background_upload_id = u.id
                 OR s.hero_logo_upload_id = u.id OR s.hero_video_upload_id = u.id)
             LIMIT 1000 FOR UPDATE`, [projectId]
        )
        if (uploads.length) {
            await deleteObjects(uploads.map(upload => upload.object_key))
            await connection.execute(
                `DELETE FROM uploads WHERE status = 'DELETED' AND id IN (${uploads.map(() => '?').join(', ')})`,
                uploads.map(upload => upload.id)
            )
        }
    })
}

// Periodic retries cover failed post-publish cleanup and expired private uploads,
// even when the user never publishes again. Errors are surfaced to app logging.
export class PublishCleanupWorker {
    private stopped = false
    private timer?: ReturnType<typeof setTimeout>
    constructor(private readonly onError: (error: unknown) => void) {}

    start(): void { void this.tick() }
    stop(): void {
        this.stopped = true
        if (this.timer) clearTimeout(this.timer)
    }

    private async tick(): Promise<void> {
        try {
            const [projects] = await getPool().execute<(RowDataPacket & { id: string })[]>(
                'SELECT id FROM projects WHERE disabled = FALSE'
            )
            for (const project of projects) {
                if (this.stopped) break
                try {
                    await withProjectStorageLock(project.id, () => cleanupProjectStorage(project.id))
                } catch (error) {
                    if (!(error instanceof ProjectStorageBusyError)) this.onError(error)
                }
            }
        } catch (error) { this.onError(error) }
        finally {
            if (!this.stopped) this.timer = setTimeout(() => void this.tick(), 60_000)
        }
    }
}
