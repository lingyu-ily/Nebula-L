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
    activatePublish,
    type JobRow,
    type ProjectSnapshot
} from './publisher.js'

const job = {
    id: 'publish-1',
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
    sourceDraftVersion: 27,
    servers: [{ id: 'frozen-server' }]
} as ProjectSnapshot

const stableObject = {
    objectKey: 'public/test/distribution.json',
    size: 123,
    md5: 'a'.repeat(32),
    sha256: 'b'.repeat(64)
}

function mockLockedProject(projectRevision: number): void {
    mocks.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM users')) {
            return [[{ id: 'editor-1', username: 'editor', role: 'EDITOR' }]]
        }
        if (sql.includes('FROM projects')) {
            return [[{ release_revision: projectRevision }]]
        }
        throw new Error(`Unexpected query: ${sql}`)
    })
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.execute.mockResolvedValue([{ affectedRows: 1 }])
})

describe('published revisions', () => {
    it('allocates the next revision without creating a release row', async () => {
        mockLockedProject(11)

        await expect(activatePublish(job, snapshot, stableObject)).resolves.toBe(12)

        expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining('UPDATE projects SET release_revision'), [
            12, 'publish-1', 123, 'b'.repeat(64), 'project-1'
        ])
        expect(mocks.execute.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO releases'))).toBe(false)
        expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining('published_once = TRUE WHERE project_id = ? AND id IN'), [
            'project-1', 'frozen-server'
        ])
        expect(mocks.writeAudit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
            action: 'publish.succeeded',
            after: { releaseRevision: 12, sourceDraftVersion: 27 }
        }))
    })

    it('stores the stable object metadata in the job result', async () => {
        mockLockedProject(4)

        await activatePublish(job, snapshot, stableObject)

        const jobUpdate = mocks.execute.mock.calls.find(([sql]) => String(sql).includes('UPDATE jobs SET status = \'SUCCEEDED\''))
        expect(JSON.parse(String(jobUpdate?.[1]?.[0]))).toEqual({
            releaseRevision: 5,
            currentPublishId: 'publish-1',
            distributionKey: 'public/test/distribution.json',
            size: 123,
            sha256: 'b'.repeat(64)
        })
    })

    it('does not update state when the project cannot be locked', async () => {
        mocks.query.mockImplementationOnce(async () => [[{ id: 'editor-1', username: 'editor', role: 'EDITOR' }]])
            .mockImplementationOnce(async () => [[]])

        await expect(activatePublish(job, snapshot, stableObject)).rejects.toThrow('Project not found')

        expect(mocks.execute).not.toHaveBeenCalledWith(
            expect.stringContaining('UPDATE projects SET release_revision'),
            expect.anything()
        )
    })
})
