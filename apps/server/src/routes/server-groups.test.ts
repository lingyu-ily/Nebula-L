import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Role } from '@nebula/shared'
import { sendProblem } from '../http.js'

const mocks = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn(), audit: vi.fn() }))
vi.mock('../db/index.js', () => ({
    getPool: (): Record<string, unknown> => ({ execute: mocks.execute }),
    withTransaction: async (work: (connection: unknown) => Promise<unknown>): Promise<unknown> => work({ query: mocks.query, execute: mocks.execute })
}))
vi.mock('../audit.js', () => ({ writeAudit: mocks.audit }))
import { registerServerGroupRoutes } from './server-groups.js'

const groupId = '07c30729-b9cd-44c3-a2ac-7f36009bce31'
const firstId = 'a1ce3d4a-df36-4822-966f-7e319d6d4311'
const secondId = 'b1ce3d4a-df36-4822-966f-7e319d6d4312'
const group = { id: groupId, project_id: 'project', name: 'Survival', description: '', default_version_id: firstId, main_server: 1, sort_order: 0 }
const first = {
    id: firstId, project_id: 'project', group_id: groupId, version_name: 'Stable', enabled: 1, distribution_id: 'old-1.20.1',
    server_key: 'old', name: 'Survival', description: '', minecraft_version: '1.20.1', server_version: '1', address: 'localhost:25565',
    discord: null, java_options: null, forge_version: '47.4.0', fabric_version: null, autoconnect: 0, sort_order: 0
}
const second = { ...first, id: secondId, version_name: 'Beta', distribution_id: 'version-beta', sort_order: 1 }
let versions = [first, second]
const apps: FastifyInstance[] = []
async function appFor(role: Role = 'EDITOR'): Promise<FastifyInstance> {
    const app = Fastify()
    apps.push(app)
    app.setErrorHandler(sendProblem)
    app.addHook('onRequest', async request => {
        request.auth = { id: 'user', username: 'editor', role, mustChangePassword: false, sessionTokenHash: 's', csrfToken: 'csrf' }
    })
    await registerServerGroupRoutes(app)
    return app
}
const headers = { 'x-csrf-token': 'csrf' }
const base = `/api/v1/projects/project/server-groups/${groupId}`
beforeEach(() => {
    vi.clearAllMocks()
    versions = [first, second]
    mocks.execute.mockResolvedValue([{ affectedRows: 1 }])
    mocks.query.mockImplementation(async (sql: string, values: unknown[]) => {
        if (sql.includes('FROM projects')) return [[{ id: 'project', draft_revision: 7 }]]
        if (sql.includes('FROM server_groups')) return [values[0] === groupId && values[1] === 'project' ? [group] : []]
        if (sql.includes('FROM servers')) return [versions]
        throw new Error(sql)
    })
})
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())) })

describe('version management', () => {
    it('copies modules, directories and rules with new records while retaining immutable upload references', async () => {
        const app = await appFor()
        const response = await app.inject({ method: 'POST', url: `${base}/versions`, headers, payload: { draftVersion: 7, versionName: 'Copied', sourceVersionId: firstId } })
        expect(response.statusCode).toBe(201)
        const id = response.json().id as string
        expect(id).not.toBe(firstId)
        const insert = mocks.execute.mock.calls.find(([sql]) => String(sql).startsWith('INSERT INTO servers'))!
        expect(insert[1]).toContain(`version-${id}`)
        expect(insert[1]).toContain('Copied')
        const moduleCopy = mocks.execute.mock.calls.find(([sql]) => String(sql).startsWith('INSERT INTO modules'))!
        expect(moduleCopy[0]).toContain('SELECT UUID(), project_id, ?, upload_id')
        expect(moduleCopy[1]).toEqual([id, firstId, 'project'])
        expect(mocks.execute.mock.calls.some(([sql]) => String(sql).startsWith('INSERT INTO server_directories'))).toBe(true)
        expect(mocks.execute.mock.calls.some(([sql]) => String(sql).startsWith('INSERT INTO untracked_rules'))).toBe(true)
        expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ action: 'server-version.cloned' }))
    })

    it('creates an empty version with its own loader and connection settings', async () => {
        const app = await appFor()
        const response = await app.inject({ method: 'POST', url: `${base}/versions`, headers, payload: { draftVersion: 7, versionName: 'Fabric', server: {
            serverKey: 'unused', name: group.name, minecraftVersion: '1.21.1', serverVersion: '2', address: 'beta.example.com', fabricVersion: '0.16.0'
        } } })
        expect(response.statusCode).toBe(201)
        const insert = mocks.execute.mock.calls.find(([sql]) => String(sql).startsWith('INSERT INTO servers'))!
        expect(insert[1]).toEqual(expect.arrayContaining(['1.21.1', 'beta.example.com', '0.16.0']))
        expect(mocks.execute.mock.calls.some(([sql]) => String(sql).startsWith('INSERT INTO modules'))).toBe(false)
    })

    it.each(['PATCH', 'DELETE'] as const)('protects the default version from %s', async method => {
        const app = await appFor()
        const response = await app.inject({ method, url: `${base}/versions/${firstId}`, headers, payload: { draftVersion: 7, enabled: false, confirmName: 'Stable' } })
        expect(response.statusCode).toBe(409)
        expect(mocks.execute).not.toHaveBeenCalled()
    })

    it('protects the last version and validates the typed name', async () => {
        const app = await appFor()
        const request = { method: 'DELETE' as const, url: `${base}/versions/${secondId}`, headers, payload: { draftVersion: 7, confirmName: 'wrong' } }
        expect((await app.inject(request)).statusCode).toBe(400)
        versions = [second]
        expect((await app.inject({ ...request, payload: { draftVersion: 7, confirmName: 'Beta' } })).statusCode).toBe(409)
        expect(mocks.execute).not.toHaveBeenCalled()
    })

    it('deletes only the version record, leaving published assets and player directories untouched', async () => {
        const app = await appFor()
        const response = await app.inject({ method: 'DELETE', url: `${base}/versions/${secondId}`, headers, payload: { draftVersion: 7, confirmName: 'Beta' } })
        expect(response.statusCode).toBe(200)
        expect(mocks.execute.mock.calls[0]).toEqual(['DELETE FROM servers WHERE id = ? AND group_id = ? AND project_id = ?', [secondId, groupId, 'project']])
        expect(mocks.execute.mock.calls.map(([sql]) => String(sql)).join(' ')).not.toMatch(/DELETE FROM (uploads|published_objects|release_files)/)
    })

    it('renames or disables a non-default version without changing its distribution ID', async () => {
        const app = await appFor()
        const response = await app.inject({ method: 'PATCH', url: `${base}/versions/${secondId}`, headers, payload: { draftVersion: 7, enabled: false, versionName: 'Archived' } })
        expect(response.statusCode).toBe(200)
        expect(mocks.execute.mock.calls[0][0]).not.toContain('distribution_id')
        expect(mocks.execute.mock.calls[0][1]).toEqual(['Archived', false, secondId, groupId, 'project'])
    })

    it('rejects stale drafts, missing CSRF, auditors and foreign groups before mutation', async () => {
        const app = await appFor()
        const request = { method: 'PATCH' as const, url: `${base}/versions/${secondId}`, headers, payload: { draftVersion: 6, enabled: false } }
        expect((await app.inject(request)).statusCode).toBe(409)
        expect((await app.inject({ ...request, headers: {} })).statusCode).toBe(403)
        const auditor = await appFor('AUDITOR')
        expect((await auditor.inject(request)).statusCode).toBe(403)
        expect((await app.inject({ ...request, url: base.replace(groupId, firstId) + `/versions/${secondId}`, payload: { draftVersion: 7, enabled: false } })).statusCode).toBe(404)
        expect(mocks.execute).not.toHaveBeenCalled()
    })

    it('only accepts a complete unique version order', async () => {
        const app = await appFor()
        for (const serverIds of [[firstId], [firstId, firstId], [firstId, groupId]]) {
            const response = await app.inject({ method: 'PUT', url: `${base}/versions/order`, headers, payload: { draftVersion: 7, serverIds } })
            expect(response.statusCode).toBe(400)
        }
        expect(mocks.execute).not.toHaveBeenCalled()
        const response = await app.inject({ method: 'PUT', url: `${base}/versions/order`, headers, payload: { draftVersion: 7, serverIds: [secondId, firstId] } })
        expect(response.statusCode).toBe(200)
        expect(mocks.execute.mock.calls[0][1]).toEqual([0, secondId, groupId, 'project'])
    })

    it('requires an enabled, same-group default and propagates shared fields', async () => {
        const app = await appFor()
        const payload = { draftVersion: 7, name: group.name, mainServer: true, defaultVersionId: secondId }
        versions = [first, { ...second, enabled: 0 }]
        expect((await app.inject({ method: 'PUT', url: base, headers, payload })).statusCode).toBe(409)
        versions = [first, second]
        expect((await app.inject({ method: 'PUT', url: base, headers, payload: { ...payload, defaultVersionId: groupId } })).statusCode).toBe(409)
        expect((await app.inject({ method: 'PUT', url: base, headers, payload })).statusCode).toBe(200)
        expect(mocks.execute.mock.calls.some(([sql]) => String(sql).includes('s.main_server = (g.main_server AND s.id = g.default_version_id)'))).toBe(true)
    })
})
