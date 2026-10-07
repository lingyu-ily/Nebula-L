import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    deleteObjectPrefix: vi.fn(),
    execute: vi.fn(),
    query: vi.fn(),
    writeAudit: vi.fn()
}))

interface MockConnection {
    execute: typeof mocks.execute
    query: typeof mocks.query
}

vi.mock('./storage.js', (): Record<string, unknown> => ({ deleteObjectPrefix: mocks.deleteObjectPrefix }))
vi.mock('./project-storage-lock.js', async (): Promise<Record<string, unknown>> => ({
    ...await vi.importActual<typeof import('./project-storage-lock.js')>('./project-storage-lock.js'),
    withProjectStorageLock: async (_id: string, work: () => Promise<unknown>): Promise<unknown> => work()
}))
vi.mock('./audit.js', (): Record<string, unknown> => ({ writeAudit: mocks.writeAudit }))
vi.mock('./config.js', (): Record<string, unknown> => ({ getConfig: (): { workerPollMs: number } => ({ workerPollMs: 2000 }) }))
vi.mock('./db/index.js', (): Record<string, unknown> => ({
    getPool: () => ({ execute: mocks.execute }),
    withTransaction: async (work: (connection: MockConnection) => Promise<unknown>) => work({
        execute: mocks.execute,
        query: mocks.query
    })
}))

import {
    claimProjectDeletion,
    failProjectDeletion,
    projectDeletionPrefixes,
    projectDeletionRetryDelay,
    purgeProject,
    recoverStaleProjectDeletions,
    type ProjectDeletionTaskRow
} from './project-deletion.js'
import { ProjectStorageBusyError } from './project-storage-lock.js'

const task = {
    id: 'deletion-1',
    project_id: 'project-1',
    project_slug: 'test-project',
    project_name: 'Test Project',
    status: 'RUNNING',
    attempts: 1,
    max_attempts: 3,
    requested_by: 'admin-1'
} as ProjectDeletionTaskRow

beforeEach(() => {
    vi.clearAllMocks()
    mocks.deleteObjectPrefix.mockImplementation(async (_prefix: string, heartbeat: () => Promise<void>) => {
        await heartbeat()
        return 1
    })
    mocks.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT d.*')) {
            return [[{
                ...task,
                disabled: 1,
                username: 'admin',
                role: 'ADMIN'
            }]]
        }
        if (sql.includes('SELECT id FROM jobs')) return [[]]
        throw new Error(`Unexpected query: ${sql}`)
    })
    mocks.execute.mockImplementation(async (sql: string) => [
        sql.includes('DELETE FROM projects') ? { affectedRows: 1 } : { affectedRows: 0 }
    ])
})

describe('project deletion', () => {
    it('does not consume a deletion attempt when publishing owns the storage lock', async () => {
        await failProjectDeletion(task, new ProjectStorageBusyError())
        expect(String(mocks.execute.mock.calls.at(-1)?.[0])).toContain('GREATEST(attempts - 1, 0)')
        expect(mocks.writeAudit).not.toHaveBeenCalled()
    })
    it('targets both public and private project prefixes', () => {
        expect(projectDeletionPrefixes('project-1', 'test-project')).toEqual([
            'public/test-project/',
            'private/uploads/project-1/'
        ])
    })

    it('caps automatic retry delays', () => {
        expect([1, 2, 3, 4].map(projectDeletionRetryDelay)).toEqual([30, 120, 600, 600])
    })

    it('only claims queued deletions after ordinary running jobs are gone', async () => {
        mocks.query.mockResolvedValueOnce([[{ ...task, status: 'QUEUED', attempts: 0 }]])

        await expect(claimProjectDeletion('worker-1')).resolves.toMatchObject({ attempts: 1 })

        const claimSql = String(mocks.query.mock.calls[0][0])
        expect(claimSql).toContain('d.status = \'QUEUED\'')
        expect(claimSql).toContain('jobs WHERE project_id = d.project_id AND status = \'RUNNING\'')
        expect(mocks.execute.mock.calls.some(call => String(call[0]).includes('status = \'RUNNING\''))).toBe(true)
    })

    it('automatically retries and becomes failed at the attempt limit', async () => {
        await failProjectDeletion({ ...task, attempts: 2 }, new Error('RustFS unavailable'))
        expect(mocks.execute.mock.calls.at(-1)?.[1]).toEqual([
            'QUEUED', 120, 'RustFS unavailable', 'deletion-1'
        ])

        await failProjectDeletion({ ...task, attempts: 3 }, new Error('RustFS unavailable'))
        expect(mocks.execute.mock.calls.at(-1)?.[1]).toEqual([
            'FAILED', 600, 'RustFS unavailable', 'deletion-1'
        ])
    })

    it('requeues stale running deletion locks on worker startup', async () => {
        await recoverStaleProjectDeletions()
        const recoverySql = String(mocks.execute.mock.calls.at(-1)?.[0])
        expect(recoverySql).toContain('SET status = \'QUEUED\'')
        expect(recoverySql).toContain('WHERE status = \'RUNNING\'')
        expect(recoverySql).toContain('TIMESTAMPADD(MINUTE, -5')
    })

    it('purges object prefixes and project records before writing a minimal audit receipt', async () => {
        await purgeProject(task)

        expect(mocks.deleteObjectPrefix.mock.calls.map(call => String(call[0]))).toEqual([
            'public/test-project/',
            'private/uploads/project-1/'
        ])
        const statements = mocks.execute.mock.calls.map(call => String(call[0]))
        expect(statements.some(sql => sql.includes('DELETE FROM audit_logs'))).toBe(true)
        expect(statements.some(sql => sql.includes('DELETE FROM projects'))).toBe(true)
        expect(mocks.writeAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            user: { id: 'admin-1', username: 'admin', role: 'ADMIN' }
        }), expect.objectContaining({
            action: 'project.purged',
            entityId: 'project-1',
            after: { name: 'Test Project' }
        }))
    })

    it('does not delete database records while a project job is still running', async () => {
        mocks.query.mockImplementation(async (sql: string) => {
            if (sql.includes('SELECT d.*')) return [[{
                ...task,
                disabled: 1,
                username: 'admin',
                role: 'ADMIN'
            }]]
            if (sql.includes('SELECT id FROM jobs')) return [[{ id: 'job-1' }]]
            throw new Error(`Unexpected query: ${sql}`)
        })

        await expect(purgeProject(task)).rejects.toThrow('running background job')
        expect(mocks.execute.mock.calls.some(call => String(call[0]).includes('DELETE FROM projects'))).toBe(false)
    })
})
