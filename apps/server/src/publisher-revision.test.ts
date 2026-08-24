import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    execute: vi.fn(),
    query: vi.fn(),
    writeAudit: vi.fn()
}))

interface MockConnection {
    execute: typeof mocks.execute
    query: typeof mocks.query
}

vi.mock('./db/index.js', (): Record<string, unknown> => ({
    getPool: (): MockConnection => ({ execute: mocks.execute, query: mocks.query }),
    withTransaction: async (work: (connection: MockConnection) => Promise<unknown>) => work({
        execute: mocks.execute,
        query: mocks.query
    })
}))
vi.mock('./audit.js', (): Record<string, unknown> => ({ writeAudit: mocks.writeAudit }))

import {
    activateRelease,
    type JobRow,
    type ProjectSnapshot
} from './publisher.js'

const job = {
    id: 'release-1',
    project_id: 'project-1',
    kind: 'PUBLISH',
    status: 'RUNNING',
    snapshot: {},
    attempts: 1,
    max_attempts: 3,
    created_by: 'editor-1'
} as JobRow

const snapshot = {
    id: 'project-1',
    sourceDraftVersion: 27
} as ProjectSnapshot

function mockLockedRows(projectRevision: number, releaseRevision: number | null): void {
    mocks.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM users')) {
            return [[{ id: 'editor-1', username: 'editor', role: 'EDITOR' }]]
        }
        if (sql.includes('FROM projects')) {
            return [[{ release_revision: projectRevision }]]
        }
        if (sql.includes('FROM releases')) {
            return [[{ release_revision: releaseRevision }]]
        }
        throw new Error(`Unexpected query: ${sql}`)
    })
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.execute.mockResolvedValue([{ affectedRows: 1 }])
})

describe('published release revisions', () => {
    it('allocates the next revision in the activation transaction', async () => {
        mockLockedRows(11, null)

        await expect(activateRelease(job, snapshot)).resolves.toBe(12)

        expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining('UPDATE releases SET release_revision'), [
            12, 'release-1'
        ])
        expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining('UPDATE projects SET release_revision'), [
            12, 'release-1', 'project-1'
        ])
        expect(mocks.writeAudit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
            action: 'release.published',
            after: { releaseRevision: 12, sourceDraftVersion: 27 }
        }))
    })

    it('reuses an already assigned revision when the same job is retried', async () => {
        mockLockedRows(12, 12)

        await expect(activateRelease(job, snapshot)).resolves.toBe(12)

        const projectUpdate = mocks.execute.mock.calls.find(([sql]) => String(sql).includes('UPDATE projects SET release_revision'))
        expect(projectUpdate?.[1]).toEqual([12, 'release-1', 'project-1'])
    })

    it('does not update the project counter when the candidate release cannot be locked', async () => {
        mockLockedRows(11, null)
        mocks.query.mockImplementationOnce(async () => [[{ id: 'editor-1', username: 'editor', role: 'EDITOR' }]])
            .mockImplementationOnce(async () => [[{ release_revision: 11 }]])
            .mockImplementationOnce(async () => [[]])

        await expect(activateRelease(job, snapshot)).rejects.toThrow('Release not found')

        expect(mocks.execute).not.toHaveBeenCalledWith(
            expect.stringContaining('UPDATE projects SET release_revision'),
            expect.anything()
        )
    })
})
