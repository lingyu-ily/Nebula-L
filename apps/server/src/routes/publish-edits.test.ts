import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendProblem } from '../http.js'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), query: vi.fn(), audit: vi.fn() }))
vi.mock('../db/index.js', () => ({
    getPool: (): unknown => ({ execute: mocks.execute }),
    withTransaction: async (work: (connection: { execute: typeof mocks.execute, query: typeof mocks.query }) => Promise<unknown>): Promise<unknown> =>
        work({ execute: mocks.execute, query: mocks.query })
}))
vi.mock('../audit.js', () => ({ writeAudit: mocks.audit }))
vi.mock('../stable-distribution.js', () => ({ getLauncherUrl: (): string => '', isStableDistributionReady: (): boolean => true }))

import { registerProjectRoutes } from './projects.js'

const body = {
    serverKey: 'survival', name: 'Survival', description: '', minecraftVersion: '1.20.1', serverVersion: '1',
    address: 'localhost:25565', mainServer: true, autoconnect: false, sortOrder: 0, untrackedRules: [], draftVersion: 7
}
const row = {
    id: 'server', server_key: 'survival', name: 'Survival', description: '', minecraft_version: '1.20.1', server_version: '1',
    address: 'localhost:25565', discord: 'null', icon_upload_id: null, forge_version: null, fabric_version: null,
    main_server: 1, autoconnect: 0, sort_order: 0, java_options: 'null', published_once: 1,
    hero_background_upload_id: null, hero_logo_upload_id: null, hero_video_source: null, hero_video_upload_id: null,
    hero_video_url: null, hero_eyebrow: null, hero_title: 'Title', hero_tagline: null, news_rss: null
}
let app: FastifyInstance

beforeEach(async () => {
    vi.clearAllMocks()
    mocks.execute.mockResolvedValue([{ affectedRows: 1 }])
    mocks.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM projects')) return [[{ id: 'project', disabled: 0, draft_revision: 7 }]]
        if (sql.includes('FROM servers')) return [[row]]
        if (sql.includes('FROM untracked_rules')) return [[]]
        throw new Error(`Unexpected query: ${sql}`)
    })
    app = Fastify()
    app.setErrorHandler(sendProblem)
    app.addHook('onRequest', async request => {
        request.auth = { id: 'editor', username: 'editor', role: 'EDITOR', mustChangePassword: false, sessionTokenHash: 'session', csrfToken: 'csrf' }
    })
    await registerProjectRoutes(app)
})
afterEach(async () => app.close())

describe('publish draft revision updates', () => {
    it('does not bump the server revision for an identical server save', async () => {
        const response = await app.inject({ method: 'PUT', url: '/api/v1/projects/project/servers/server', headers: { 'x-csrf-token': 'csrf' }, payload: body })
        expect(response.statusCode).toBe(200)
        const update = mocks.execute.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE servers SET server_key'))
        expect(update?.[1]?.slice(-2)).toEqual([0, 'server'])
        expect(response.json()).toMatchObject({ draftVersion: 8 })
    })

    it('bumps the server revision for actual text changes while retaining draft concurrency', async () => {
        const response = await app.inject({ method: 'PUT', url: '/api/v1/projects/project/servers/server', headers: { 'x-csrf-token': 'csrf' }, payload: { ...body, name: 'Renamed' } })
        expect(response.statusCode).toBe(200)
        const update = mocks.execute.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE servers SET server_key'))
        expect(update?.[1]?.slice(-2)).toEqual([1, 'server'])
    })

    it('does not bump the server revision for identical Launcher UI settings', async () => {
        const response = await app.inject({ method: 'PATCH', url: '/api/v1/projects/project/servers/server/launcher-ui', headers: { 'x-csrf-token': 'csrf' }, payload: { draftVersion: 7, title: 'Title' } })
        expect(response.statusCode).toBe(200)
        const update = mocks.execute.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE servers SET hero_background'))
        expect(update?.[1]?.slice(-2)).toEqual([0, 'server'])
    })

    it('rejects outdated draft versions before mutating a server', async () => {
        const response = await app.inject({ method: 'PUT', url: '/api/v1/projects/project/servers/server', headers: { 'x-csrf-token': 'csrf' }, payload: { ...body, draftVersion: 6 } })
        expect(response.statusCode).toBe(409)
        expect(mocks.execute).not.toHaveBeenCalled()
    })
})
