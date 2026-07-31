import type { Role } from '@nebula/shared'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { sendProblem } from '../http.js'
import {
    VersionCatalogUnavailableError,
    type VersionCatalogProvider
} from '../version-catalog.js'
import { registerVersionCatalogRoutes } from './version-catalog.js'

const successfulCatalog: VersionCatalogProvider = {
    getMinecraftVersions: async () => ({
        versions: [{ value: '1.21.5', type: 'release', releaseTime: '2025-03-25T12:00:00Z' }],
        stale: false
    }),
    getLoaderVersions: async (loader, minecraftVersion) => ({
        loader,
        minecraftVersion,
        versions: [],
        stale: false
    })
}

const apps: FastifyInstance[] = []

async function createApp(role?: Role, catalog: VersionCatalogProvider = successfulCatalog): Promise<FastifyInstance> {
    const app = Fastify()
    apps.push(app)
    app.setErrorHandler(sendProblem)
    if (role) {
        app.addHook('onRequest', async request => {
            request.auth = {
                id: 'user-id',
                username: 'tester',
                role,
                mustChangePassword: false,
                sessionTokenHash: 'token-hash',
                csrfToken: 'csrf-token'
            }
        })
    }
    await registerVersionCatalogRoutes(app, catalog)
    return app
}

afterEach(async () => {
    await Promise.all(apps.splice(0).map(app => app.close()))
})

describe('version catalog routes', () => {
    it('requires authentication and an editing role', async () => {
        const anonymous = await createApp()
        const anonymousResponse = await anonymous.inject('/api/v1/version-catalog/minecraft')
        expect(anonymousResponse.statusCode).toBe(401)

        const auditor = await createApp('AUDITOR')
        const auditorResponse = await auditor.inject('/api/v1/version-catalog/minecraft')
        expect(auditorResponse.statusCode).toBe(403)

        const editor = await createApp('EDITOR')
        const editorResponse = await editor.inject('/api/v1/version-catalog/minecraft')
        expect(editorResponse.statusCode).toBe(200)
    })

    it('validates loader query parameters', async () => {
        const app = await createApp('ADMIN')
        const response = await app.inject('/api/v1/version-catalog/loaders?loader=neoforge&minecraftVersion=')

        expect(response.statusCode).toBe(400)
        expect(response.headers['content-type']).toContain('application/problem+json')
    })

    it('returns problem details when upstream catalogs are unavailable', async () => {
        const unavailableCatalog: VersionCatalogProvider = {
            ...successfulCatalog,
            getMinecraftVersions: async () => {
                throw new VersionCatalogUnavailableError()
            }
        }
        const app = await createApp('EDITOR', unavailableCatalog)
        const response = await app.inject('/api/v1/version-catalog/minecraft')

        expect(response.statusCode).toBe(503)
        expect(response.json()).toMatchObject({
            title: 'Version catalog unavailable',
            status: 503
        })
    })
})
