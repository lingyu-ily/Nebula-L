import type { Role } from '@nebula/shared'
import Fastify, { type FastifyInstance } from 'fastify'
import type { InjectOptions } from 'light-my-request'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendProblem } from '../http.js'

const mocks = vi.hoisted(() => ({
    execute: vi.fn(),
    query: vi.fn(),
    writeAudit: vi.fn()
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
vi.mock('../stable-distribution.js', (): Record<string, unknown> => ({
    getLauncherUrl: (slug: string) => `https://cdn.example.com/public/${slug}/distribution.json`,
    isStableDistributionReady: vi.fn()
}))
vi.mock('../storage.js', (): Record<string, unknown> => ({ getStoredObject: vi.fn() }))

import { registerProjectRoutes } from './projects.js'

const disabledProject = {
    id: 'project-1',
    slug: 'test-project',
    name: 'Test Project',
    description: '',
    rss: '',
    discord: null,
    draft_revision: 7,
    active_release_id: null,
    disabled: 1,
    disabled_at: new Date('2026-08-23T01:00:00Z'),
    created_at: new Date('2026-08-22T01:00:00Z'),
    updated_at: new Date('2026-08-23T01:00:00Z')
}

const apps: FastifyInstance[] = []

async function createApp(role: Role): Promise<FastifyInstance> {
    const app = Fastify()
    apps.push(app)
    app.setErrorHandler(sendProblem)
    app.addHook('onRequest', async request => {
        request.auth = {
            id: `${role.toLowerCase()}-1`,
            username: role.toLowerCase(),
            role,
            mustChangePassword: false,
            sessionTokenHash: 'session',
            csrfToken: 'csrf-token'
        }
    })
    await registerProjectRoutes(app)
    return app
}

function mutation(method: 'POST' | 'DELETE', url: string, payload: Record<string, unknown>): InjectOptions {
    return { method, url, headers: { 'x-csrf-token': 'csrf-token' }, payload }
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.execute.mockResolvedValue([{ affectedRows: 1 }])
    mocks.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM projects p')) return [[{
            ...disabledProject,
            deletion_id: null,
            deletion_status: null,
            deletion_attempts: null,
            deletion_max_attempts: null,
            deletion_error: null,
            deletion_requested_at: null
        }]]
        if (sql.startsWith('SELECT * FROM projects')) return [[disabledProject]]
        if (sql.includes('FROM project_deletion_tasks')) return [[]]
        throw new Error(`Unexpected query: ${sql}`)
    })
})

afterEach(async () => {
    await Promise.all(apps.splice(0).map(app => app.close()))
})

describe('disabled distribution lifecycle routes', () => {
    it('only allows administrators to list disabled distributions', async () => {
        const admin = await createApp('ADMIN')
        const response = await admin.inject('/api/v1/projects/disabled')
        expect(response.statusCode).toBe(200)
        expect(response.json()).toMatchObject({ items: [{ id: 'project-1', disabled: true, deletion: null }] })

        const editor = await createApp('EDITOR')
        expect((await editor.inject('/api/v1/projects/disabled')).statusCode).toBe(403)
    })

    it('restores a disabled distribution with draft version and CSRF protection', async () => {
        const app = await createApp('ADMIN')
        const missingCsrf = await app.inject({
            method: 'POST', url: '/api/v1/projects/project-1/restore', payload: { draftVersion: 7 }
        })
        expect(missingCsrf.statusCode).toBe(403)

        const response = await app.inject(mutation('POST', '/api/v1/projects/project-1/restore', { draftVersion: 7 }))
        expect(response.statusCode).toBe(200)
        expect(response.json()).toEqual({ restored: true })
        expect(mocks.execute.mock.calls.some(call => String(call[0]).includes('disabled = FALSE'))).toBe(true)
        expect(mocks.writeAudit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
            action: 'project.restored'
        }))
    })

    it('does not restore after permanent deletion has been requested', async () => {
        mocks.query.mockImplementation(async (sql: string) => {
            if (sql.startsWith('SELECT * FROM projects')) return [[disabledProject]]
            if (sql.includes('FROM project_deletion_tasks')) return [[{ id: 'deletion-1' }]]
            throw new Error(`Unexpected query: ${sql}`)
        })
        const app = await createApp('ADMIN')
        const response = await app.inject(mutation('POST', '/api/v1/projects/project-1/restore', { draftVersion: 7 }))

        expect(response.statusCode).toBe(409)
        expect(response.json()).toMatchObject({ title: 'Permanent deletion already requested' })
    })

    it('validates the exact distribution name before queueing permanent deletion', async () => {
        const app = await createApp('ADMIN')
        const mismatch = await app.inject(mutation('POST', '/api/v1/projects/project-1/purge', {
            draftVersion: 7,
            confirmationName: 'Wrong Project'
        }))
        expect(mismatch.statusCode).toBe(400)

        const response = await app.inject(mutation('POST', '/api/v1/projects/project-1/purge', {
            draftVersion: 7,
            confirmationName: 'Test Project'
        }))
        expect(response.statusCode).toBe(202)
        expect(response.json()).toMatchObject({ queued: true })
        expect(mocks.execute.mock.calls.some(call => String(call[0]).includes('INSERT INTO project_deletion_tasks'))).toBe(true)
    })

    it('rejects a duplicate permanent deletion request', async () => {
        mocks.query.mockImplementation(async (sql: string) => {
            if (sql.startsWith('SELECT * FROM projects')) return [[disabledProject]]
            if (sql.includes('FROM project_deletion_tasks')) return [[{ id: 'deletion-1' }]]
            throw new Error(`Unexpected query: ${sql}`)
        })
        const app = await createApp('ADMIN')
        const response = await app.inject(mutation('POST', '/api/v1/projects/project-1/purge', {
            draftVersion: 7,
            confirmationName: 'Test Project'
        }))

        expect(response.statusCode).toBe(409)
        expect(response.json()).toMatchObject({ title: 'Permanent deletion already requested' })
    })

    it('only retries a failed permanent deletion task', async () => {
        mocks.query.mockImplementation(async (sql: string) => {
            if (sql.startsWith('SELECT * FROM projects')) return [[disabledProject]]
            if (sql.includes('SELECT id, status FROM project_deletion_tasks')) {
                return [[{ id: 'deletion-1', status: 'FAILED' }]]
            }
            throw new Error(`Unexpected query: ${sql}`)
        })
        const app = await createApp('ADMIN')
        const response = await app.inject(mutation('POST', '/api/v1/projects/project-1/purge/retry', { draftVersion: 7 }))

        expect(response.statusCode).toBe(202)
        expect(response.json()).toEqual({ queued: true, deletionId: 'deletion-1' })
        expect(mocks.execute.mock.calls.some(call => String(call[0]).includes('status = \'QUEUED\''))).toBe(true)
    })
})
