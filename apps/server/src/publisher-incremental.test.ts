import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublishCache } from './publish-cache.js'
import type { JobRow, ProjectSnapshot } from './publisher.js'

const mocks = vi.hoisted(() => ({
    execute: vi.fn(), query: vi.fn(), audit: vi.fn(), build: vi.fn(), put: vi.fn(), verify: vi.fn(),
    commit: vi.fn(), cleanup: vi.fn(), reconcile: vi.fn()
}))
vi.mock('./db/index.js', () => ({
    getPool: (): unknown => ({ execute: mocks.execute }),
    withTransaction: async (work: (connection: { execute: typeof mocks.execute, query: typeof mocks.query }) => Promise<unknown>): Promise<unknown> =>
        work({ execute: mocks.execute, query: mocks.query })
}))
vi.mock('./project-storage-lock.js', async (): Promise<Record<string, unknown>> => ({
    ...await vi.importActual<typeof import('./project-storage-lock.js')>('./project-storage-lock.js'),
    withProjectStorageLock: async (_id: string, work: () => Promise<unknown>): Promise<unknown> => work()
}))
vi.mock('./audit.js', () => ({ writeAudit: mocks.audit }))
vi.mock('./config.js', () => ({ getConfig: (): unknown => ({ appBaseUrl: 'https://nebula.test', rustfs: { publicBaseUrl: 'https://cdn.test' } }) }))
vi.mock('./incremental-publisher.js', () => ({ buildIncrementalServer: mocks.build }))
vi.mock('./publish-cleanup.js', () => ({ commitManifest: mocks.commit, cleanupProjectStorage: mocks.cleanup, reconcileManifest: mocks.reconcile }))
vi.mock('./storage.js', async () => ({ ...await vi.importActual<typeof import('./storage.js')>('./storage.js'), putJson: mocks.put }))
vi.mock('./stable-distribution.js', () => ({
    getStableDistributionKey: (slug: string): string => `public/${slug}/distribution.json`,
    STABLE_CACHE_CONTROL: 'no-cache, must-revalidate', assertStableDistribution: mocks.verify
}))

import { publishJob } from './publisher.js'

const snapshot: ProjectSnapshot = {
    id: 'project', slug: 'test', name: 'Test', description: '', rss: '', discord: null, sourceDraftVersion: 42,
    servers: [{ id: 'server', revision: 2, serverKey: 'survival', name: 'Frozen name', description: '', minecraftVersion: '1.20.1',
        serverVersion: '1', address: 'localhost', discord: null, forgeVersion: null, fabricVersion: null, mainServer: true,
        autoconnect: false, sortOrder: 0, javaOptions: null, icon: null, untrackedRules: [], modules: [],
        launcherUi: { background: null, logo: null, video: null, eyebrow: '', title: '', tagline: '', rss: '' } }]
}
const job = { id: 'job', project_id: 'project', kind: 'PUBLISH', status: 'RUNNING', snapshot, attempts: 1, max_attempts: 3, created_by: 'editor' } as JobRow
const stable = { objectKey: 'public/test/distribution.json', size: 12, sha256: 'sha', md5: 'md5' }

beforeEach(() => {
    vi.clearAllMocks()
    mocks.execute.mockResolvedValue([[]])
    mocks.query.mockImplementation(async (sql: string) => sql.includes('FROM users')
        ? [[{ id: 'editor', username: 'editor', role: 'EDITOR' }]] : [[{ release_revision: 3 }]])
    mocks.build.mockImplementation(async (cache: PublishCache, frozen: ProjectSnapshot) => {
        cache.references.add('object-1')
        return { id: 'survival-1.20.1', name: frozen.servers[0].name, modules: [] }
    })
    mocks.put.mockResolvedValue(stable)
    mocks.verify.mockResolvedValue(undefined)
    mocks.commit.mockResolvedValue(undefined)
    mocks.cleanup.mockResolvedValue(undefined)
})

describe('incremental publish activation', () => {
    it('pins candidate references before replacing the fixed key and records metrics', async () => {
        await publishJob(job)
        const refs = mocks.execute.mock.calls.findIndex(([sql]) => String(sql).startsWith('INSERT IGNORE INTO publish_object_refs'))
        const writing = mocks.execute.mock.calls.findIndex(([sql]) => String(sql).includes('status = \'WRITING\''))
        expect(mocks.execute.mock.invocationCallOrder[refs]).toBeLessThan(mocks.execute.mock.invocationCallOrder[writing])
        expect(mocks.execute.mock.invocationCallOrder[writing]).toBeLessThan(mocks.put.mock.invocationCallOrder[0])
        const result = mocks.execute.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE jobs SET status = \'SUCCEEDED\''))
        expect(JSON.parse(String(result?.[1]?.[0]))).toMatchObject({ releaseRevision: 4, currentPublishId: 'job', metrics: { parseCacheHits: 0, s3Requests: {} } })
        expect(mocks.put.mock.calls[0]?.[1]).toMatchObject({ servers: [{ name: 'Frozen name' }] })
        expect(mocks.verify.mock.invocationCallOrder[0]).toBeLessThan(mocks.commit.mock.invocationCallOrder[0])
        expect(mocks.cleanup).toHaveBeenCalledWith('project')
    })

    it('retains references when the stable PUT result is ambiguous', async () => {
        mocks.put.mockRejectedValue(new Error('Socket timed out after write'))
        await expect(publishJob(job)).rejects.toThrow('Socket timed out')
        expect(mocks.commit).not.toHaveBeenCalled()
        expect(mocks.cleanup).not.toHaveBeenCalled()
        const writing = mocks.execute.mock.calls.findIndex(([sql]) => String(sql).includes('status = \'WRITING\''))
        expect(mocks.execute.mock.calls.slice(writing + 1).some(([sql]) => String(sql).startsWith('DELETE'))).toBe(false)
    })

    it('keeps a successful publish successful when manifest promotion or cleanup needs a retry', async () => {
        mocks.commit.mockRejectedValue(new Error('DB disconnected'))
        mocks.cleanup.mockRejectedValue(new Error('S3 unavailable'))
        await expect(publishJob(job)).resolves.toBeUndefined()
        expect(mocks.execute.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE jobs SET status = \'SUCCEEDED\''))).toBe(true)
    })

    it('reconciles a previous write instead of rebuilding or allocating another revision', async () => {
        mocks.execute.mockImplementation(async (sql: string) => {
            if (sql.startsWith('SELECT job_id')) return [[{ job_id: 'job', status: 'WRITING', distribution: {} }]]
            if (sql.startsWith('SELECT id, slug')) return [[{ id: 'project', slug: 'test', active_release_id: 'old', stable_distribution_sha256: 'old-sha' }]]
            if (sql.startsWith('SELECT status FROM jobs')) return [[{ status: 'SUCCEEDED' }]]
            return [[]]
        })
        mocks.reconcile.mockResolvedValue(true)
        await publishJob(job)
        expect(mocks.reconcile).toHaveBeenCalledTimes(1)
        expect(mocks.build).not.toHaveBeenCalled()
        expect(mocks.put).not.toHaveBeenCalled()
        expect(mocks.query).not.toHaveBeenCalled()
    })
})
