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
    getLauncherUrl: (slug: string) => `https://cdn.example.com/public/${slug}/distribution.json`
}))

import { registerServerManagementRoutes } from './server-management.js'

const project = {
    id: 'project-1',
    slug: 'test-project',
    draft_revision: 3,
    disabled: 0
}

const server = {
    id: 'server-1',
    project_id: 'project-1'
}

function moduleRow(type: 'File' | 'ForgeMod', validateChecksum = 1): Record<string, unknown> {
    return {
        id: 'module-1',
        project_id: 'project-1',
        server_id: 'server-1',
        upload_id: 'upload-1',
        type,
        display_name: type === 'File' ? 'options.txt' : 'example.jar',
        file_name: type === 'File' ? 'options.txt' : 'example.jar',
        module_id: null,
        relative_path: type === 'File' ? 'config/options.txt' : null,
        optional_mode: 'REQUIRED',
        sort_order: 0,
        validate_checksum: validateChecksum,
        needs_manual_file: 0,
        manual_url: null,
        original_name: type === 'File' ? 'options.txt' : 'example.jar',
        size: 10,
        md5: 'a'.repeat(32),
        sha256: 'b'.repeat(64),
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-01T00:00:00Z')
    }
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
    await registerServerManagementRoutes(app)
    return app
}

function checksumMutation(validateChecksum: boolean): InjectOptions {
    return {
        method: 'PATCH',
        url: '/api/v1/projects/project-1/servers/server-1/modules/module-1',
        headers: { 'x-csrf-token': 'csrf-token' },
        payload: { revision: 3, validateChecksum }
    }
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.execute.mockResolvedValue([{ affectedRows: 1 }])
})

afterEach(async () => {
    await Promise.all(apps.splice(0).map(app => app.close()))
})

describe('module checksum validation route', () => {
    it('allows an editor to disable validation for a File module', async () => {
        mocks.query.mockImplementation(async (sql: string) => {
            if (sql.includes('FROM projects WHERE id = ? FOR UPDATE')) return [[project]]
            if (sql.includes('FROM servers WHERE id = ?') && sql.includes('FOR UPDATE')) return [[server]]
            if (sql.includes('FROM modules m LEFT JOIN uploads')) return [[moduleRow('File')]]
            if (sql.includes('SELECT id FROM modules')) return [[]]
            if (sql.includes('SELECT id FROM server_directories')) return [[]]
            throw new Error(`Unexpected query: ${sql}`)
        })
        const app = await createApp('EDITOR')

        const response = await app.inject(checksumMutation(false))

        expect(response.statusCode).toBe(200)
        const update = mocks.execute.mock.calls.find(([sql]) => String(sql).includes('UPDATE modules SET display_name'))
        expect(update?.[1]).toEqual(expect.arrayContaining([false, 'module-1']))
        expect(mocks.writeAudit).toHaveBeenCalled()
        expect(mocks.writeAudit.mock.calls[0]?.[2]).toMatchObject({
            action: 'module.metadata_updated',
            after: { validateChecksum: false }
        })
    })

    it('rejects disabling validation for non-File modules', async () => {
        mocks.query.mockImplementation(async (sql: string) => {
            if (sql.includes('FROM projects WHERE id = ? FOR UPDATE')) return [[project]]
            if (sql.includes('FROM servers WHERE id = ?') && sql.includes('FOR UPDATE')) return [[server]]
            if (sql.includes('FROM modules m LEFT JOIN uploads')) return [[moduleRow('ForgeMod')]]
            throw new Error(`Unexpected query: ${sql}`)
        })
        const app = await createApp('EDITOR')

        const response = await app.inject(checksumMutation(false))

        expect(response.statusCode).toBe(400)
        expect(response.json().detail).toBe('Only File modules may disable checksum validation')
        expect(mocks.execute).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE modules SET display_name'), expect.anything())
    })

    it('keeps the checksum switch read-only for auditors', async () => {
        const app = await createApp('AUDITOR')

        const response = await app.inject(checksumMutation(false))

        expect(response.statusCode).toBe(403)
        expect(mocks.query).not.toHaveBeenCalled()
    })
})
