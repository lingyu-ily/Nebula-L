import type { Role } from '@nebula/shared'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendProblem } from '../http.js'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), ready: vi.fn() }))
vi.mock('../db/index.js', () => ({ getPool: (): unknown => ({ execute: mocks.execute }) }))
vi.mock('../stable-distribution.js', () => ({
    getLauncherUrl: (): string => 'https://cdn.example.com/distribution.json',
    isStableDistributionReady: mocks.ready
}))

import { registerProjectRoutes } from './projects.js'

const project = {
    id: 'project-1', slug: 'test', name: 'Test', description: '', rss: '', discord: null,
    draft_revision: 7, release_revision: 3, active_release_id: 'publish-3', disabled: 0, disabled_at: null
}
const server = {
    id: 'server-1', project_id: project.id, server_key: 'survival', name: 'Survival', description: '',
    minecraft_version: '1.20.1', server_version: '1', address: 'localhost:25565', discord: null,
    icon_upload_id: null, forge_version: null, fabric_version: null, main_server: 1, autoconnect: 0,
    sort_order: 0, java_options: null, revision: 2, published_once: 1
}
const moduleRow = {
    id: 'module-1', project_id: project.id, server_id: server.id, upload_id: 'upload-1', type: 'File',
    display_name: 'Options', file_name: 'options.txt', relative_path: 'config/options.txt',
    optional_mode: 'REQUIRED', sort_order: 0, validate_checksum: 1, needs_manual_file: 0,
    size: 100, sha256: 'a'.repeat(64), md5: 'b'.repeat(32)
}
const rule = { id: 'rule-1', server_id: server.id, applies_to: 'files', pattern: '*.log' }
const apps: FastifyInstance[] = []

async function createApp(role: Role | null = 'EDITOR'): Promise<FastifyInstance> {
    const app = Fastify()
    apps.push(app)
    app.setErrorHandler(sendProblem)
    app.addHook('onRequest', async request => {
        if (role) request.auth = {
            id: 'user-1', username: 'test', role, mustChangePassword: false,
            sessionTokenHash: 'session', csrfToken: 'csrf'
        }
    })
    await registerProjectRoutes(app)
    return app
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.ready.mockResolvedValue(true)
    mocks.execute.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM projects')) return [[project]]
        if (sql.includes('FROM servers WHERE')) return [[server]]
        if (sql.includes('FROM modules')) return [[moduleRow]]
        if (sql.includes('FROM untracked_rules')) return [[rule]]
        throw new Error(`Unexpected query: ${sql}`)
    })
})

afterEach(async () => {
    await Promise.all(apps.splice(0).map(app => app.close()))
})

describe('project summary', () => {
    it.each(['ADMIN', 'EDITOR', 'AUDITOR'] as const)('returns metadata without querying files or rules for %s', async role => {
        const app = await createApp(role)
        const response = await app.inject('/api/v1/projects/project-1?view=summary')

        expect(response.statusCode).toBe(200)
        expect(response.json()).toMatchObject({
            project: { id: project.id, draftVersion: 7, currentPublishId: 'publish-3', stableDistributionReady: true },
            servers: [{ id: server.id, serverKey: 'survival', sortOrder: 0, mainServer: true, revision: 2 }]
        })
        expect(response.json().servers[0]).not.toHaveProperty('modules')
        expect(response.json().servers[0]).not.toHaveProperty('untrackedRules')
        expect(mocks.execute).toHaveBeenCalledTimes(2)
        expect(mocks.execute.mock.calls.map(([sql]) => String(sql)).join(' ')).not.toMatch(/modules|untracked_rules|uploads/)
        expect(mocks.ready).toHaveBeenCalledWith(project.id, project.slug, project.active_release_id)
    })

    it.each(['', '?view=full'])('preserves complete project responses for view %s', async query => {
        const app = await createApp()
        const response = await app.inject(`/api/v1/projects/project-1${query}`)

        expect(response.statusCode).toBe(200)
        expect(response.json()).toMatchObject({ servers: [{
            id: server.id,
            modules: [{ id: moduleRow.id, relativePath: moduleRow.relative_path }],
            untrackedRules: [{ id: rule.id, appliesTo: rule.applies_to, pattern: rule.pattern }]
        }] })
    })

    it('keeps summary bytes constant when the project grows to 28,000 files', async () => {
        const app = await createApp()
        const before = await app.inject('/api/v1/projects/project-1?view=summary')
        const modules = Array.from({ length: 28_000 }, (_, index) => ({
            ...moduleRow, id: `module-${index}`, display_name: 'x'.repeat(400)
        }))
        mocks.execute.mockImplementation(async (sql: string) => {
            if (sql.includes('FROM projects')) return [[project]]
            if (sql.includes('FROM servers WHERE')) return [[server]]
            if (sql.includes('FROM modules')) return [modules]
            if (sql.includes('FROM untracked_rules')) return [[rule]]
            throw new Error(`Unexpected query: ${sql}`)
        })
        const full = await app.inject('/api/v1/projects/project-1')
        const after = await app.inject('/api/v1/projects/project-1?view=summary')

        expect(full.statusCode).toBe(200)
        expect(full.json().servers[0].modules).toHaveLength(28_000)
        expect(Buffer.byteLength(full.body)).toBeGreaterThan(20 * 1024 * 1024)
        expect(after.statusCode).toBe(200)
        expect(after.body).toBe(before.body)
        expect(Buffer.byteLength(after.body)).toBeLessThan(2048)
    })

    it('requires authentication before querying project summaries', async () => {
        const app = await createApp(null)
        expect((await app.inject('/api/v1/projects/project-1?view=summary')).statusCode).toBe(401)
        expect(mocks.execute).not.toHaveBeenCalled()
    })

    it('returns 404 for missing or disabled projects before querying servers', async () => {
        mocks.execute.mockResolvedValue([[]])
        const app = await createApp()
        expect((await app.inject('/api/v1/projects/project-1?view=summary')).statusCode).toBe(404)
        expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining('disabled = FALSE'), [project.id])
        expect(mocks.execute).toHaveBeenCalledTimes(1)
        expect(mocks.ready).not.toHaveBeenCalled()
    })
})
