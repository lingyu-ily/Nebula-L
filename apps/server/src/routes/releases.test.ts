import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendProblem } from '../http.js'

const mocks = vi.hoisted(() => ({
    execute: vi.fn(),
    query: vi.fn(),
    writeAudit: vi.fn(),
    buildProjectSnapshot: vi.fn(),
    copyJson: vi.fn(),
    assertStableDistribution: vi.fn(),
    getReleaseDistributionExpectation: vi.fn()
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
vi.mock('../storage.js', (): Record<string, unknown> => ({ copyJson: mocks.copyJson }))
vi.mock('../stable-distribution.js', (): Record<string, unknown> => ({
    assertStableDistribution: mocks.assertStableDistribution,
    getReleaseDistributionExpectation: mocks.getReleaseDistributionExpectation,
    getStableDistributionKey: (slug: string) => `public/${slug}/distribution.json`
}))

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
    mocks.copyJson.mockResolvedValue(undefined)
    mocks.assertStableDistribution.mockResolvedValue(undefined)
    mocks.getReleaseDistributionExpectation.mockResolvedValue({})
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

describe('release revision routes', () => {
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
            action: 'release.queued',
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

    it('lists only assigned public release revisions', async () => {
        mocks.execute.mockResolvedValueOnce([[
            {
                id: 'release-8',
                project_id: 'project-1',
                draft_revision: 27,
                release_revision: 8,
                status: 'ACTIVE',
                distribution_key: 'public/test/releases/release-8/distribution.json',
                created_at: new Date('2026-08-24T00:00:00Z'),
                activated_at: new Date('2026-08-24T00:01:00Z'),
                username: 'editor'
            }
        ]])
        const app = await createApp()

        const response = await app.inject('/api/v1/projects/project-1/releases')

        expect(response.statusCode).toBe(200)
        expect(response.json()).toMatchObject({ items: [{ id: 'release-8', releaseRevision: 8 }] })
        expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining('r.release_revision IS NOT NULL'), [
            'project-1', 101, 0
        ])
    })

    it('reactivates a retained release without incrementing the project counter', async () => {
        mocks.execute.mockResolvedValueOnce([[
            {
                id: 'release-4',
                project_id: 'project-1',
                release_revision: 4,
                status: 'AVAILABLE',
                distribution_key: 'public/test/releases/release-4/distribution.json',
                slug: 'test-project'
            }
        ]])
        const app = await createApp()

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/projects/project-1/releases/release-4/activate',
            headers: { 'x-csrf-token': 'csrf-token' }
        })

        expect(response.statusCode).toBe(200)
        const projectUpdate = mocks.execute.mock.calls.find(([sql]) => String(sql).includes('UPDATE projects SET'))
        expect(String(projectUpdate?.[0])).toContain('active_release_id = ?')
        expect(String(projectUpdate?.[0])).not.toContain('release_revision')
        expect(mocks.writeAudit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
            action: 'release.activated',
            after: { releaseRevision: 4 }
        }))
    })
})
