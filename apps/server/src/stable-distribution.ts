import type { RowDataPacket } from 'mysql2/promise'
import { getConfig } from './config.js'
import { getPool } from './db/index.js'
import { verifyStoredObject, type StoredObjectExpectation } from './storage.js'

const STABLE_CACHE_CONTROL = 'no-cache, must-revalidate'

interface ReleaseDistributionRow extends RowDataPacket {
    distribution_key: string
    size: number
    sha256: string
}

interface ActiveProjectRow extends RowDataPacket {
    id: string
    slug: string
    active_release_id: string
}

export interface ReleaseDistributionExpectation extends StoredObjectExpectation {
    distributionKey: string
}

export function getStableDistributionKey(slug: string): string {
    return `public/${slug}/distribution.json`
}

export function buildLauncherUrl(publicBaseUrl: string, slug: string): string {
    return `${publicBaseUrl.replace(/\/$/, '')}/${getStableDistributionKey(slug)}`
}

export function getLauncherUrl(slug: string): string {
    return buildLauncherUrl(getConfig().rustfs.publicBaseUrl, slug)
}

export async function getReleaseDistributionExpectation(
    projectId: string,
    releaseId: string
): Promise<ReleaseDistributionExpectation> {
    const [rows] = await getPool().execute<ReleaseDistributionRow[]>(
        `SELECT r.distribution_key, rf.size, rf.sha256
         FROM releases r INNER JOIN release_files rf ON rf.release_id = r.id
         WHERE r.id = ? AND r.project_id = ? AND rf.logical_path = 'distribution.json'
         LIMIT 1`,
        [releaseId, projectId]
    )
    const row = rows[0]
    if (!row) {
        throw new Error(`Distribution metadata is missing for release ${releaseId}`)
    }
    return {
        distributionKey: row.distribution_key,
        size: Number(row.size),
        sha256: row.sha256,
        cacheControl: STABLE_CACHE_CONTROL,
        releaseId
    }
}

export async function assertStableDistribution(
    slug: string,
    releaseId: string,
    expected: ReleaseDistributionExpectation
): Promise<void> {
    const expectedReleaseKey = `public/${slug}/releases/${releaseId}/distribution.json`
    if (expected.distributionKey !== expectedReleaseKey) {
        throw new Error(`Release ${releaseId} has an unexpected distribution object key`)
    }
    await verifyStoredObject(getStableDistributionKey(slug), expected)
}

export async function isStableDistributionReady(
    projectId: string,
    slug: string,
    activeReleaseId: string | null
): Promise<boolean> {
    if (!activeReleaseId) {
        return false
    }
    try {
        const expected = await getReleaseDistributionExpectation(projectId, activeReleaseId)
        await assertStableDistribution(slug, activeReleaseId, expected)
        return true
    } catch {
        return false
    }
}

export async function checkActiveDistributions(): Promise<void> {
    const [projects] = await getPool().query<ActiveProjectRow[]>(
        `SELECT id, slug, active_release_id FROM projects
         WHERE disabled = FALSE AND active_release_id IS NOT NULL`
    )
    for (const project of projects) {
        const expected = await getReleaseDistributionExpectation(project.id, project.active_release_id)
        await assertStableDistribution(project.slug, project.active_release_id, expected)
    }
}
