import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { promisify } from 'util'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerAuthRoutes, loadSession } from './auth.js'
import { getConfig } from './config.js'
import { getPool } from './db/index.js'
import { sendProblem } from './http.js'
import { registerAuditRoutes } from './routes/audit.js'
import { registerProjectRoutes } from './routes/projects.js'
import { registerReleaseRoutes } from './routes/releases.js'
import { registerUploadRoutes } from './routes/uploads.js'
import { registerUserRoutes } from './routes/users.js'
import { registerVersionCatalogRoutes } from './routes/version-catalog.js'
import { checkStorage } from './storage.js'

const execFileAsync = promisify(execFile)

export async function buildApp(): Promise<FastifyInstance> {
    const config = getConfig()
    const app = Fastify({
        logger: {
            level: config.nodeEnv === 'production' ? 'info' : 'debug'
        },
        trustProxy: config.trustProxy,
        bodyLimit: 1024 * 1024
    })

    await app.register(cookie, { secret: config.cookieSecret })
    await app.register(rateLimit, { global: false })
    await app.register(multipart, {
        limits: { fileSize: config.maxUploadBytes, files: 1 }
    })
    await app.register(swagger, {
        openapi: {
            info: {
                title: 'Nebula Console API',
                version: '1.0.0',
                description: 'Helios distribution management, publishing, and audit API'
            }
        }
    })
    await app.register(swaggerUi, { routePrefix: '/api/docs' })

    app.addHook('onRequest', loadSession)
    app.setErrorHandler(sendProblem)

    app.get('/health/live', async () => ({ status: 'ok' }))
    app.get('/health/ready', async (_request, reply) => {
        try {
            await getPool().query('SELECT 1')
            await checkStorage()
            await execFileAsync(config.javaExecutable, ['-version'], { timeout: 5000 })
            return { status: 'ready', database: 'ok', rustfs: 'ok', java: 'ok' }
        } catch (error) {
            return reply.status(503).send({
                status: 'not_ready',
                detail: error instanceof Error ? error.message : String(error)
            })
        }
    })

    await registerAuthRoutes(app)
    await registerUserRoutes(app)
    await registerProjectRoutes(app)
    await registerUploadRoutes(app)
    await registerReleaseRoutes(app)
    await registerAuditRoutes(app)
    await registerVersionCatalogRoutes(app)

    const webRoot = resolve(process.cwd(), 'apps', 'web', 'dist')
    if (existsSync(webRoot)) {
        await app.register(fastifyStatic, {
            root: webRoot,
            prefix: '/'
        })
        app.setNotFoundHandler((request, reply) => {
            if (request.url.startsWith('/api/') || request.url.startsWith('/health/')) {
                return reply.status(404).type('application/problem+json').send({
                    type: 'about:blank',
                    title: 'Not Found',
                    status: 404,
                    requestId: request.id
                })
            }
            return reply.sendFile('index.html')
        })
    }

    return app
}
