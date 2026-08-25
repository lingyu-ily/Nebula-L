import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    execute: vi.fn(),
    query: vi.fn(),
    verifyStoredObject: vi.fn()
}))

vi.mock('./db/index.js', () => ({
    getPool: (): { execute: typeof mocks.execute, query: typeof mocks.query } => ({ execute: mocks.execute, query: mocks.query })
}))
vi.mock('./storage.js', () => ({ verifyStoredObject: mocks.verifyStoredObject }))
vi.mock('./config.js', () => ({
    getConfig: (): { rustfs: { publicBaseUrl: string } } => ({ rustfs: { publicBaseUrl: 'https://cdn.example.com' } })
}))

import { checkActiveDistributions, isStableDistributionReady } from './stable-distribution.js'

const activeProject = {
    id: 'project-1',
    slug: 'test',
    active_release_id: 'publish-1',
    stable_distribution_size: 123,
    stable_distribution_sha256: 'a'.repeat(64)
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.verifyStoredObject.mockResolvedValue(undefined)
})

describe('stable distribution readiness', () => {
    it('verifies the stable object from project metadata without a release row', async () => {
        mocks.execute.mockResolvedValue([[activeProject]])

        await expect(isStableDistributionReady('project-1', 'test', 'publish-1')).resolves.toBe(true)

        expect(mocks.verifyStoredObject).toHaveBeenCalledWith('public/test/distribution.json', {
            distributionKey: 'public/test/distribution.json',
            size: 123,
            sha256: 'a'.repeat(64),
            cacheControl: 'no-cache, must-revalidate',
            releaseId: 'publish-1'
        })
    })

    it('reports not ready when stable metadata is absent', async () => {
        mocks.execute.mockResolvedValue([[{ ...activeProject, stable_distribution_sha256: null }]])

        await expect(isStableDistributionReady('project-1', 'test', 'publish-1')).resolves.toBe(false)
    })

    it('checks every active project using the stored publish id', async () => {
        mocks.query.mockResolvedValue([[activeProject]])

        await checkActiveDistributions()

        expect(mocks.verifyStoredObject).toHaveBeenCalledOnce()
    })
})
