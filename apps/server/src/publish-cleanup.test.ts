import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), query: vi.fn(), read: vi.fn(), remove: vi.fn(), prefix: vi.fn(), activate: vi.fn() }))
vi.mock('./db/index.js', () => ({
    getPool: (): unknown => ({ execute: mocks.execute }),
    withTransaction: async (work: (connection: { execute: typeof mocks.execute, query: typeof mocks.query }) => Promise<unknown>): Promise<unknown> =>
        work({ execute: mocks.execute, query: mocks.query })
}))
vi.mock('./storage.js', async () => ({
    ...await vi.importActual<typeof import('./storage.js')>('./storage.js'),
    readStoredJson: mocks.read, deleteObjects: mocks.remove, deleteObjectPrefix: mocks.prefix
}))
vi.mock('./publisher.js', () => ({ activatePublish: mocks.activate }))

import { cleanupDeletedUploads, cleanupProjectStorage, reconcileManifest } from './publish-cleanup.js'

const project = { id: 'project', slug: 'test', active_release_id: 'previous', stable_distribution_sha256: 'previous-sha' }
const distribution = { version: '1.0.0', servers: [] }
const candidate = { job_id: 'candidate', status: 'WRITING' as const, distribution }
const stable = { value: distribution, releaseId: 'candidate', storedSha256: 'sha', sha256: 'sha', md5: 'md5', size: 123, cacheControl: 'no-cache, must-revalidate' }

beforeEach(() => {
    vi.clearAllMocks()
    mocks.execute.mockResolvedValue([[]])
    mocks.query.mockResolvedValue([[]])
    mocks.read.mockResolvedValue(stable)
    mocks.remove.mockResolvedValue(undefined)
})

describe('publish reconciliation and cleanup', () => {
    it('recovers a verified stable write after DB activation failed, using its frozen snapshot', async () => {
        const snapshot = { sourceDraftVersion: 42, servers: [] }
        mocks.execute.mockImplementation(async (sql: string) => sql.includes('SELECT * FROM jobs')
            ? [[{ id: 'candidate', snapshot, project_id: 'project' }]] : [[]])

        expect(await reconcileManifest(project, [candidate])).toBe(true)
        expect(mocks.activate).toHaveBeenCalledWith(expect.objectContaining({ id: 'candidate' }), snapshot,
            expect.objectContaining({ objectKey: 'public/test/distribution.json', sha256: 'sha' }))
        expect(mocks.execute.mock.calls.some(([sql]) => String(sql).includes('status = \'ACTIVE\''))).toBe(true)
    })

    it('keeps all references when S3 has unrecognized or corrupt content', async () => {
        mocks.read.mockResolvedValue({ ...stable, value: { ...distribution, version: 'unexpected' } })
        expect(await reconcileManifest(project, [candidate])).toBe(false)
        expect(mocks.activate).not.toHaveBeenCalled()
        expect(mocks.execute).not.toHaveBeenCalled()

        mocks.read.mockResolvedValue({ ...stable, storedSha256: 'different' })
        expect(await reconcileManifest(project, [candidate])).toBe(false)
        expect(mocks.execute).not.toHaveBeenCalled()
    })

    it('retires a failed candidate only after reading the actual previous distribution', async () => {
        mocks.read.mockResolvedValue({ ...stable, releaseId: 'previous', sha256: 'previous-sha' })
        expect(await reconcileManifest(project, [candidate])).toBe(true)
        expect(mocks.activate).not.toHaveBeenCalled()
        expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining('status = \'RETIRED\''), ['project'])
    })

    it('does not increment release revision again if activation already committed', async () => {
        expect(await reconcileManifest({ ...project, active_release_id: 'candidate' }, [candidate])).toBe(true)
        expect(mocks.activate).not.toHaveBeenCalled()
    })

    it('does not clean while a publish or import job is pending', async () => {
        mocks.execute.mockImplementation(async (sql: string) => sql.includes('FROM projects') ? [[project]] : [[{ id: 'pending' }]])
        await cleanupProjectStorage('project')
        expect(mocks.remove).not.toHaveBeenCalled()
        expect(mocks.read).not.toHaveBeenCalled()
    })

    it('rechecks shared-object references and leaves registry records when deletion fails', async () => {
        mocks.execute.mockImplementation(async (sql: string, values?: string[]) => {
            if (sql.startsWith('SELECT id, slug')) return [[project]]
            if (sql.startsWith('SELECT o.id')) return [[{ id: 'shared', object_key: 'public/shared' }, { id: 'unused', object_key: 'public/unused' }]]
            if (sql.startsWith('SELECT object_id FROM publish_object_refs') && values?.includes('shared')) return [[{ object_id: 'shared' }]]
            return [[]]
        })
        mocks.remove.mockRejectedValue(new Error('S3 unavailable'))
        await expect(cleanupProjectStorage('project')).rejects.toThrow('S3 unavailable')
        expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(['public/unused'])
        expect(mocks.execute.mock.calls.some(([sql]) => String(sql).startsWith('DELETE FROM published_objects'))).toBe(false)
        const invalidation = mocks.execute.mock.calls.findIndex(([sql]) => String(sql).includes('SET verified = FALSE'))
        expect(invalidation).toBeGreaterThan(0)
        expect(mocks.execute.mock.invocationCallOrder[invalidation]).toBeLessThan(mocks.remove.mock.invocationCallOrder[0])
    })

    it('deletes a registry record only after the S3 delete succeeds', async () => {
        mocks.execute.mockImplementation(async (sql: string) => {
            if (sql.startsWith('SELECT id, slug')) return [[project]]
            if (sql.startsWith('SELECT o.id')) return [[{ id: 'unused', object_key: 'public/unused' }]]
            return [[]]
        })
        await cleanupProjectStorage('project')
        const deleted = mocks.execute.mock.calls.findIndex(([sql]) => String(sql).startsWith('DELETE FROM published_objects'))
        expect(deleted).toBeGreaterThan(0)
        expect(mocks.execute.mock.invocationCallOrder[deleted]).toBeGreaterThan(mocks.remove.mock.invocationCallOrder[0])
    })

    it('locks draft edits and protects jobs and all asset references during private-upload cleanup', async () => {
        mocks.query.mockImplementation(async (sql: string) => sql.includes('SELECT u.id')
            ? [[{ id: 'deleted-upload', object_key: 'private/old' }]] : [[]])
        await cleanupDeletedUploads('project')
        const selection = String(mocks.query.mock.calls.find(([sql]) => String(sql).includes('SELECT u.id'))?.[0])
        expect(selection).toContain('u.status = \'DELETED\'')
        expect(selection).toContain('TIMESTAMPADD(HOUR, -24')
        expect(selection).toContain('modules m WHERE m.upload_id = u.id')
        expect(selection).toContain('s.hero_video_upload_id = u.id')
        expect(mocks.query.mock.calls[0]?.[0]).toContain('FOR UPDATE')
        expect(mocks.remove).toHaveBeenCalledWith(['private/old'])
    })

    it('keeps deleted source files for queued imports and retries', async () => {
        mocks.query.mockImplementation(async (sql: string) => sql.includes('FROM jobs') ? [[{ id: 'queued-import' }]] : [[]])
        await cleanupDeletedUploads('project')
        expect(mocks.remove).not.toHaveBeenCalled()
        expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('SELECT u.id'))).toBe(false)
    })
})
