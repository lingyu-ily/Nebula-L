import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendProblem } from '../http.js'

const mocks = vi.hoisted(() => ({
    execute: vi.fn(),
    query: vi.fn(),
    writeAudit: vi.fn(),
    buildProjectSnapshot: vi.fn()
}))

interface MockConnection {
    execute: typeof mocks.execute
    query: typeof mocks.query
}

vi.mock('../db/index.js', (): Record<string, unknown> => ({
    getPool: (): MockConnection => ({ execute: mocks.execute, query: mocks.query }),
    withTransaction: async (work: (connection: MockConnection) => Promise<unknown>) => work({
        execute: mocks.execute,
        query: mocks.query
    })
}))
vi.mock('../audit.js', (): Record<string, unknown> => ({ writeAudit: mocks.writeAudit }))
vi.mock('../publisher.js', (): Record<string, unknown> => ({ buildProjectSnapshot: mocks.buildProjectSnapshot }))

import { registerReleaseRoutes } from './releases.js'

const apps: FastifyInstance[] = []

async function createApp(): Promise<FastifyInstance> {
    const app = Fastify()
    apps.push(app)
    app.setErrorHandler(sendProblem)
    app.addHook('onRequest', async request => {
        request.auth = {
            id: 'editor-1',
            username: 'editor',
            role: 'EDITOR',
            mustChangePassword: false,
            sessionTokenHash: 'session',
            csrfToken: 'csrf-token'
        }
    })
    await registerReleaseRoutes(app)
    return app
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.execute.mockResolvedValue([{ affectedRows: 1 }])
    mocks.query.mockResolvedValue([[]])
    mocks.buildProjectSnapshot.mockResolvedValue({
        id: 'project-1',
        slug: 'test-project',
        sourceDraftVersion: 5,
        servers: [{ mainServer: true }]
    })
})

afterEach(async () => {
    await Promise.all(apps.splice(0).map(app => app.close()))
})

describe('publish routes', () => {
    it('locks the project before requeueing a failed job so source cleanup cannot race the retry', async () => {
        mocks.query.mockImplementation(async (sql: string) => {
            if (sql.startsWith('SELECT project_id FROM jobs')) return [[{ project_id: 'project-1' }]]
            if (sql.startsWith('SELECT id FROM projects')) return [[{ id: 'project-1' }]]
            if (sql.startsWith('SELECT project_id, status')) return [[{ project_id: 'project-1', status: 'FAILED' }]]
            throw new Error(`Unexpected query: ${sql}`)
        })
        const app = await createApp()
        const response = await app.inject({ method: 'POST', url: '/api/v1/jobs/failed-job/retry', headers: { 'x-csrf-token': 'csrf-token' } })
        expect(response.statusCode).toBe(200)
        expect(String(mocks.query.mock.calls[1]?.[0])).toContain('FROM projects')
        expect(String(mocks.query.mock.calls[1]?.[0])).toContain('FOR UPDATE')
        expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining('SET status = \'QUEUED\''), ['failed-job'])
    })

    it('queues a publish using the internal draft version', async () => {
        const app = await createApp()
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/projects/project-1/publish',
            headers: { 'x-csrf-token': 'csrf-token' },
            payload: { draftVersion: 5 }
        })

        expect(response.statusCode).toBe(202)
        expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining('VALUES (?, ?, \'PUBLISH\', \'QUEUED\''), expect.any(Array))
        expect(mocks.writeAudit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
            action: 'publish.queued',
            after: { sourceDraftVersion: 5 }
        }))
    })

    it('does not accept the former revision request field', async () => {
        const app = await createApp()
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/projects/project-1/publish',
            headers: { 'x-csrf-token': 'csrf-token' },
            payload: { revision: 5 }
        })

        expect(response.statusCode).toBe(400)
        expect(mocks.buildProjectSnapshot).not.toHaveBeenCalled()
    })

    it('keeps job history available', async () => {
        mocks.execute.mockResolvedValueOnce([[
            {
                id: 'publish-8', project_id: 'project-1', kind: 'PUBLISH', status: 'SUCCEEDED',
                attempts: 1, max_attempts: 3, progress: 100, result: null, error_text: null,
                created_at: new Date('2026-08-24T00:00:00Z'), started_at: null, completed_at: null
            }
        ]])
        const app = await createApp()

        const response = await app.inject('/api/v1/projects/project-1/jobs')

        expect(response.statusCode).toBe(200)
        expect(response.json()).toMatchObject({ items: [{ id: 'publish-8', status: 'SUCCEEDED' }] })
    })

    it('does not expose release history or rollback endpoints', async () => {
        const app = await createApp()

        const list = await app.inject('/api/v1/projects/project-1/releases')
        const activate = await app.inject({
            method: 'POST',
            url: '/api/v1/projects/project-1/releases/release-4/activate',
            headers: { 'x-csrf-token': 'csrf-token' }
        })

        expect(list.statusCode).toBe(404)
        expect(activate.statusCode).toBe(404)
    })
})
