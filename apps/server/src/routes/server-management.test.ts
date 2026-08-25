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

function directoryRow(id: string, path: string): Record<string, unknown> {
    return {
        id,
        project_id: 'project-1',
        server_id: 'server-1',
        path,
        path_hash: path,
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-01T00:00:00Z')
    }
}

function explorerModule(id: string, type: 'File' | 'ForgeMod', relativePath: string | null): Record<string, unknown> {
    return {
        ...moduleRow(type),
        id,
        relative_path: relativePath,
        file_name: relativePath?.split('/').at(-1) ?? `${id}.jar`,
        display_name: relativePath?.split('/').at(-1) ?? `${id}.jar`
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
        payload: { draftVersion: 3, validateChecksum }
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
        expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining('revision = revision + 1'), [
            'server-1', 'project-1'
        ])
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

describe('Explorer batch mutations', () => {
    it('moves a directory subtree in one draft version', async () => {
        const directories = [directoryRow('directory-config', 'config'), directoryRow('directory-target', 'resourcepacks')]
        const modules = [explorerModule('module-options', 'File', 'config/options.txt')]
        mocks.query.mockImplementation(async (sql: string) => {
            if (sql.includes('FROM projects WHERE id = ? FOR UPDATE')) return [[project]]
            if (sql.includes('FROM servers WHERE id = ?') && sql.includes('FOR UPDATE')) return [[server]]
            if (sql.includes('FROM server_directories')) return [directories]
            if (sql.includes('FROM modules m LEFT JOIN uploads')) return [modules]
            throw new Error(`Unexpected query: ${sql}`)
        })
        const app = await createApp('EDITOR')

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/projects/project-1/servers/server-1/explorer/move',
            headers: { 'x-csrf-token': 'csrf-token' },
            payload: {
                draftVersion: 3,
                entries: [{ kind: 'directory', id: 'directory-config' }],
                destinationPath: 'resourcepacks'
            }
        })

        expect(response.statusCode).toBe(200)
        expect(response.json()).toMatchObject({
            movedEntries: 1,
            movedDirectories: 1,
            movedModules: 1,
            draftVersion: 4
        })
        expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining('UPDATE server_directories'), [
            'resourcepacks/config', expect.any(String), 'directory-config'
        ])
        expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining('UPDATE modules SET relative_path'), [
            'resourcepacks/config/options.txt', 'options.txt', 'module-options'
        ])
        expect(mocks.execute.mock.calls.filter(([sql]) => String(sql).includes('UPDATE projects'))).toHaveLength(1)
        expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining('revision = revision + 1'), [
            'server-1', 'project-1'
        ])
        expect(mocks.writeAudit.mock.calls[0]?.[2]).toMatchObject({ action: 'explorer.entries_moved' })
    })

    it('rejects a batch move conflict before writing any paths', async () => {
        const directories = [
            directoryRow('directory-config', 'config'),
            directoryRow('directory-target', 'resourcepacks'),
            directoryRow('directory-conflict', 'resourcepacks/config')
        ]
        mocks.query.mockImplementation(async (sql: string) => {
            if (sql.includes('FROM projects WHERE id = ? FOR UPDATE')) return [[project]]
            if (sql.includes('FROM servers WHERE id = ?') && sql.includes('FOR UPDATE')) return [[server]]
            if (sql.includes('FROM server_directories')) return [directories]
            if (sql.includes('FROM modules m LEFT JOIN uploads')) return [[]]
            throw new Error(`Unexpected query: ${sql}`)
        })
        const app = await createApp('EDITOR')

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/projects/project-1/servers/server-1/explorer/move',
            headers: { 'x-csrf-token': 'csrf-token' },
            payload: {
                draftVersion: 3,
                entries: [{ kind: 'directory', id: 'directory-config' }],
                destinationPath: 'resourcepacks'
            }
        })

        expect(response.statusCode).toBe(409)
        expect(response.json().detail).toContain('resourcepacks/config')
        expect(mocks.execute).not.toHaveBeenCalled()
        expect(mocks.writeAudit).not.toHaveBeenCalled()
    })

    it('deduplicates descendants and deletes mixed selections in one draft version', async () => {
        const directories = [directoryRow('directory-config', 'config'), directoryRow('directory-client', 'config/client')]
        const modules = [
            explorerModule('module-options', 'File', 'config/options.txt'),
            explorerModule('module-forge', 'ForgeMod', null)
        ]
        mocks.query.mockImplementation(async (sql: string) => {
            if (sql.includes('FROM projects WHERE id = ? FOR UPDATE')) return [[project]]
            if (sql.includes('FROM servers WHERE id = ?') && sql.includes('FOR UPDATE')) return [[server]]
            if (sql.includes('FROM server_directories')) return [directories]
            if (sql.includes('FROM modules m LEFT JOIN uploads')) return [modules]
            throw new Error(`Unexpected query: ${sql}`)
        })
        const app = await createApp('EDITOR')

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/projects/project-1/servers/server-1/explorer/delete',
            headers: { 'x-csrf-token': 'csrf-token' },
            payload: {
                draftVersion: 3,
                recursive: true,
                entries: [
                    { kind: 'directory', id: 'directory-config' },
                    { kind: 'directory', id: 'directory-client' },
                    { kind: 'module', id: 'module-options' },
                    { kind: 'module', id: 'module-forge' }
                ]
            }
        })

        expect(response.statusCode).toBe(200)
        expect(response.json()).toMatchObject({ deletedDirectories: 2, deletedModules: 2, draftVersion: 4 })
        expect(mocks.execute.mock.calls.filter(([sql]) => String(sql).includes('DELETE FROM modules'))).toHaveLength(2)
        expect(mocks.execute.mock.calls.filter(([sql]) => String(sql).includes('DELETE FROM server_directories'))).toHaveLength(2)
        expect(mocks.execute.mock.calls.filter(([sql]) => String(sql).includes('UPDATE projects'))).toHaveLength(1)
        expect(mocks.writeAudit.mock.calls[0]?.[2]).toMatchObject({ action: 'explorer.entries_deleted' })
    })
})
