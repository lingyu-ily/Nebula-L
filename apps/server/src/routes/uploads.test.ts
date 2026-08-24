import { Readable } from 'stream'
import type { Role } from '@nebula/shared'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendProblem } from '../http.js'

const mocks = vi.hoisted(() => ({
    execute: vi.fn(),
    query: vi.fn(),
    getStoredObject: vi.fn()
}))

vi.mock('../db/index.js', (): Record<string, unknown> => ({
    getPool: () => ({ execute: mocks.execute, query: mocks.query }),
    withTransaction: vi.fn()
}))
vi.mock('../storage.js', (): Record<string, unknown> => ({
    deleteObjects: vi.fn(),
    getStoredObject: mocks.getStoredObject,
    uploadStream: vi.fn()
}))

import { registerUploadRoutes } from './uploads.js'

const downloadRow = {
    id: 'upload-1',
    project_id: 'project-1',
    object_key: 'private/uploads/project-1/upload-1/payload',
    original_name: 'original.jar',
    mime_type: 'application/java-archive',
    size: 7,
    md5: 'a'.repeat(32),
    sha256: 'b'.repeat(64),
    status: 'READY',
    created_at: new Date('2026-08-23T00:00:00Z'),
    module_file_name: '設定檔.jar',
    relative_path: null,
    display_name: 'Configuration'
}
const downloadUrl = '/api/v1/projects/project-1/servers/server-1/modules/module-1/download'
const explorerDownloadUrl = '/api/v1/projects/project-1/servers/server-1/explorer/download'
const apps: FastifyInstance[] = []

async function createApp(role: Role | 'VIEWER' | null = 'EDITOR'): Promise<FastifyInstance> {
    const app = Fastify()
    apps.push(app)
    app.setErrorHandler(sendProblem)
    if (role) {
        app.addHook('onRequest', async request => {
            request.auth = {
                id: `${role.toLowerCase()}-1`,
                username: role.toLowerCase(),
                role: role as Role,
                mustChangePassword: false,
                sessionTokenHash: 'session',
                csrfToken: 'csrf-token'
            }
        })
    }
    await registerUploadRoutes(app)
    return app
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.execute.mockResolvedValue([[downloadRow]])
    mocks.getStoredObject.mockImplementation(async () => ({
        body: Readable.from([Buffer.from('payload')]),
        contentLength: 7
    }))
})

afterEach(async () => {
    await Promise.all(apps.splice(0).map(app => app.close()))
})

describe('module file downloads', () => {
    it('streams a complete attachment with a UTF-8 file name and security headers', async () => {
        const app = await createApp()
        const response = await app.inject(downloadUrl)

        expect(response.statusCode).toBe(200)
        expect(response.body).toBe('payload')
        expect(response.headers['content-type']).toContain('application/octet-stream')
        expect(response.headers['content-disposition']).toContain('attachment; filename=')
        expect(response.headers['content-disposition']).toContain(
            `filename*=UTF-8''${encodeURIComponent(downloadRow.module_file_name)}`
        )
        expect(response.headers['cache-control']).toBe('private, no-store')
        expect(response.headers['x-content-type-options']).toBe('nosniff')
        expect(response.headers['accept-ranges']).toBe('bytes')
        expect(response.headers['content-length']).toBe('7')
        expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining('p.disabled = FALSE'), [
            'module-1', 'server-1', 'project-1'
        ])
        expect(mocks.getStoredObject).toHaveBeenCalledWith(downloadRow.object_key, undefined)
    })

    it('supports byte ranges and rejects an invalid range without reading storage', async () => {
        mocks.getStoredObject.mockResolvedValueOnce({
            body: Readable.from([Buffer.from('ylo')]),
            contentLength: 3,
            contentRange: 'bytes 2-4/7'
        })
        const app = await createApp()
        const partial = await app.inject({ url: downloadUrl, headers: { range: 'bytes=2-4' } })

        expect(partial.statusCode).toBe(206)
        expect(partial.body).toBe('ylo')
        expect(partial.headers['content-range']).toBe('bytes 2-4/7')
        expect(partial.headers['content-length']).toBe('3')
        expect(mocks.getStoredObject).toHaveBeenCalledWith(downloadRow.object_key, 'bytes=2-4')

        mocks.getStoredObject.mockClear()
        const invalid = await app.inject({ url: downloadUrl, headers: { range: 'bytes=99-100' } })
        expect(invalid.statusCode).toBe(416)
        expect(invalid.headers['content-range']).toBe('bytes */7')
        expect(mocks.getStoredObject).not.toHaveBeenCalled()
    })

    it('returns 404 for mismatched identifiers or a module without a ready upload', async () => {
        const app = await createApp()
        const missingUrls = [
            downloadUrl.replace('project-1', 'project-other'),
            downloadUrl.replace('server-1', 'server-other'),
            downloadUrl.replace('module-1', 'module-other'),
            downloadUrl
        ]
        for (const url of missingUrls) {
            mocks.execute.mockResolvedValueOnce([[]])
            const response = await app.inject(url)
            expect(response.statusCode).toBe(404)
            expect(response.json()).toMatchObject({ title: 'Module file not found' })
        }
        expect(mocks.getStoredObject).not.toHaveBeenCalled()
        expect(String(mocks.execute.mock.calls[0]?.[0])).toContain('u.status = \'READY\'')
    })

    it('allows every console role but rejects unauthenticated and unknown roles', async () => {
        for (const role of ['ADMIN', 'EDITOR', 'AUDITOR'] as const) {
            const app = await createApp(role)
            expect((await app.inject(downloadUrl)).statusCode).toBe(200)
        }
        expect((await (await createApp(null)).inject(downloadUrl)).statusCode).toBe(401)
        expect((await (await createApp('VIEWER')).inject(downloadUrl)).statusCode).toBe(403)
    })
})

describe('Explorer ZIP downloads', () => {
    it('streams selected directory contents with full Explorer paths and empty folders', async () => {
        mocks.execute.mockImplementation(async (sql: string) => {
            if (sql.includes('SELECT s.server_key')) return [[{ server_key: 'main' }]]
            if (sql.includes('FROM server_directories')) return [[
                { id: 'directory-config', path: 'config' },
                { id: 'directory-empty', path: 'config/empty' }
            ]]
            if (sql.includes('FROM modules m LEFT JOIN uploads')) return [[{
                id: 'module-options',
                upload_id: 'upload-1',
                type: 'File',
                file_name: 'options.txt',
                relative_path: 'config/options.txt',
                optional_mode: 'REQUIRED',
                display_name: 'options.txt',
                needs_manual_file: 0,
                original_name: 'options.txt',
                object_key: downloadRow.object_key,
                upload_status: 'READY'
            }]]
            throw new Error(`Unexpected query: ${sql}`)
        })
        const app = await createApp('AUDITOR')

        const response = await app.inject({
            method: 'POST',
            url: explorerDownloadUrl,
            headers: { 'x-csrf-token': 'csrf-token' },
            payload: { entries: [{ kind: 'directory', id: 'directory-config' }] }
        })

        expect(response.statusCode).toBe(200)
        expect(response.headers['content-type']).toContain('application/zip')
        expect(response.headers['content-disposition']).toContain('main-selection.zip')
        expect(response.rawPayload.subarray(0, 2).toString()).toBe('PK')
        const archiveText = response.rawPayload.toString('latin1')
        expect(archiveText).toContain('files/config/options.txt')
        expect(archiveText).toContain('files/config/empty/')
        expect(mocks.getStoredObject).toHaveBeenCalledWith(downloadRow.object_key)
    })

    it('refuses to create an incomplete ZIP when a selected module needs a file', async () => {
        mocks.execute.mockImplementation(async (sql: string) => {
            if (sql.includes('SELECT s.server_key')) return [[{ server_key: 'main' }]]
            if (sql.includes('FROM server_directories')) return [[]]
            if (sql.includes('FROM modules m LEFT JOIN uploads')) return [[{
                id: 'module-manual',
                upload_id: null,
                type: 'ForgeMod',
                file_name: 'manual.jar',
                relative_path: null,
                optional_mode: 'REQUIRED',
                display_name: 'manual.jar',
                needs_manual_file: 1,
                original_name: null,
                object_key: null,
                upload_status: null
            }]]
            throw new Error(`Unexpected query: ${sql}`)
        })
        const app = await createApp('EDITOR')

        const response = await app.inject({
            method: 'POST',
            url: explorerDownloadUrl,
            headers: { 'x-csrf-token': 'csrf-token' },
            payload: { entries: [{ kind: 'module', id: 'module-manual' }] }
        })

        expect(response.statusCode).toBe(409)
        expect(response.json().detail).toContain('forgemods/required/manual.jar')
        expect(mocks.getStoredObject).not.toHaveBeenCalled()
    })
})
