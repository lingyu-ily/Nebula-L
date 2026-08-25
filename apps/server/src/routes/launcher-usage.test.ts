import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Role } from '@nebula/shared'
import { sendProblem } from '../http.js'

const mocks = vi.hoisted(() => ({
    getLauncherUsage: vi.fn(),
    recordLauncherPresence: vi.fn()
}))

vi.mock('../launcher-usage.js', () => ({
    getLauncherUsage: mocks.getLauncherUsage,
    recordLauncherPresence: mocks.recordLauncherPresence
}))

import { registerLauncherUsageRoutes, registerPublicLauncherUsageRoutes } from './launcher-usage.js'

const apps: FastifyInstance[] = []

async function publicApp(): Promise<FastifyInstance> {
    const app = Fastify()
    apps.push(app)
    await app.register(rateLimit, { global: false })
    app.setErrorHandler(sendProblem)
    await registerPublicLauncherUsageRoutes(app)
    return app
}

async function authenticatedApp(initialRole: Role | null): Promise<{ app: FastifyInstance, setRole: (role: Role | null) => void }> {
    const app = Fastify()
    apps.push(app)
    let role = initialRole
    app.setErrorHandler(sendProblem)
    app.addHook('onRequest', async request => {
        request.auth = role == null ? undefined : {
            id: 'user-1', username: 'operator', role, mustChangePassword: false,
            sessionTokenHash: 'session', csrfToken: 'csrf'
        }
    })
    await registerLauncherUsageRoutes(app)
    return { app, setRole: (value): void => { role = value } }
}

afterEach(async () => {
    await Promise.all(apps.splice(0).map(app => app.close()))
})

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getLauncherUsage.mockResolvedValue({
        project: { id: 'project-1', name: 'MapleCraft', slug: 'maplecraft' },
        timeZone: 'Asia/Taipei', from: '2026-07-27', to: '2026-08-25', series: []
    })
})

describe('Launcher usage routes', () => {
    it('accepts the strict anonymous payload and always returns an empty response', async () => {
        const app = await publicApp()
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/public/launcher-presence/maplecraft',
            payload: { dailyToken: 'A'.repeat(43) }
        })
        expect(response.statusCode).toBe(204)
        expect(response.body).toBe('')
        expect(response.headers['cache-control']).toBe('no-store')
        expect(mocks.recordLauncherPresence).toHaveBeenCalledWith('maplecraft', 'A'.repeat(43))
    })

    it('rejects malformed or expanded payloads before touching storage', async () => {
        const app = await publicApp()
        for (const payload of [
            { dailyToken: 'short' },
            { dailyToken: 'A'.repeat(43), account: 'player' }
        ]) {
            const response = await app.inject({
                method: 'POST', url: '/api/v1/public/launcher-presence/maplecraft', payload
            })
            expect(response.statusCode).toBe(400)
        }
        expect(mocks.recordLauncherPresence).not.toHaveBeenCalled()
    })

    it('does not expose or query invalid project slugs', async () => {
        const app = await publicApp()
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/public/launcher-presence/INVALID_SLUG',
            payload: { dailyToken: 'A'.repeat(43) }
        })
        expect(response.statusCode).toBe(204)
        expect(mocks.recordLauncherPresence).not.toHaveBeenCalled()
    })

    it('returns a body-free service error when storage is unavailable', async () => {
        mocks.recordLauncherPresence.mockRejectedValueOnce(new Error('database unavailable'))
        const app = await publicApp()
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/public/launcher-presence/maplecraft',
            payload: { dailyToken: 'A'.repeat(43) }
        })
        expect(response.statusCode).toBe(503)
        expect(response.body).toBe('')
        expect(response.headers['cache-control']).toBe('no-store')
    })

    it('allows every signed-in role to read aggregates and rejects anonymous reads', async () => {
        const state = await authenticatedApp('AUDITOR')
        for (const role of ['AUDITOR', 'EDITOR', 'ADMIN'] as Role[]) {
            state.setRole(role)
            expect((await state.app.inject('/api/v1/projects/project-1/launcher-usage')).statusCode).toBe(200)
        }
        state.setRole(null)
        expect((await state.app.inject('/api/v1/projects/project-1/launcher-usage')).statusCode).toBe(401)
    })
})
