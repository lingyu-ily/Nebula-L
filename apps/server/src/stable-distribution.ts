import type { RowDataPacket } from 'mysql2/promise'
import { getConfig } from './config.js'
import { getPool } from './db/index.js'
import { verifyStoredObject, type StoredObjectExpectation } from './storage.js'

export const STABLE_CACHE_CONTROL = 'no-cache, must-revalidate'

interface ActiveProjectRow extends RowDataPacket {
    id: string
    slug: string
    active_release_id: string
    stable_distribution_size: number | null
    stable_distribution_sha256: string | null
}

export interface StableDistributionExpectation extends StoredObjectExpectation {
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

function projectExpectation(project: ActiveProjectRow): StableDistributionExpectation {
    if (project.stable_distribution_size == null || !project.stable_distribution_sha256) {
        throw new Error(`Stable distribution metadata is missing for project ${project.id}`)
    }
    return {
        distributionKey: getStableDistributionKey(project.slug),
        size: Number(project.stable_distribution_size),
        sha256: project.stable_distribution_sha256,
        cacheControl: STABLE_CACHE_CONTROL,
        releaseId: project.active_release_id
    }
}

export async function assertStableDistribution(
    slug: string,
    currentPublishId: string,
    expected: StableDistributionExpectation
): Promise<void> {
    const stableKey = getStableDistributionKey(slug)
    if (expected.distributionKey !== stableKey) {
        throw new Error(`Publish ${currentPublishId} has an unexpected distribution object key`)
    }
    await verifyStoredObject(stableKey, expected)
}

export async function isStableDistributionReady(
    projectId: string,
    slug: string,
    currentPublishId: string | null
): Promise<boolean> {
    if (!currentPublishId) {
        return false
    }
    try {
        const [rows] = await getPool().execute<ActiveProjectRow[]>(
            `SELECT id, slug, active_release_id, stable_distribution_size, stable_distribution_sha256
             FROM projects WHERE id = ? AND slug = ? AND active_release_id = ?`,
            [projectId, slug, currentPublishId]
        )
        const project = rows[0]
        if (!project) {
            return false
        }
        await assertStableDistribution(slug, currentPublishId, projectExpectation(project))
        return true
    } catch {
        return false
    }
}

export async function checkActiveDistributions(): Promise<void> {
    const [projects] = await getPool().query<ActiveProjectRow[]>(
        `SELECT id, slug, active_release_id, stable_distribution_size, stable_distribution_sha256
         FROM projects WHERE disabled = FALSE AND active_release_id IS NOT NULL`
    )
    for (const project of projects) {
        await assertStableDistribution(project.slug, project.active_release_id, projectExpectation(project))
    }
}
