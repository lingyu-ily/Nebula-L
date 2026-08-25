import { launcherPresenceSchema } from '@nebula/shared'
import type { FastifyInstance } from 'fastify'
import { HttpError, requireRole } from '../http.js'
import { getLauncherUsage, recordLauncherPresence } from '../launcher-usage.js'

export const PUBLIC_LAUNCHER_PRESENCE_PREFIX = '/api/v1/public/launcher-presence/'
const PROJECT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export async function registerPublicLauncherUsageRoutes(app: FastifyInstance): Promise<void> {
    app.post('/api/v1/public/launcher-presence/:projectSlug', {
        bodyLimit: 1024,
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const parsed = launcherPresenceSchema.safeParse(request.body)
        if (!parsed.success) {
            throw new HttpError(400, 'Invalid launcher presence', undefined, parsed.error.flatten())
        }
        const { projectSlug } = request.params as { projectSlug: string }
        if (projectSlug.length < 2 || projectSlug.length > 64 || !PROJECT_SLUG_PATTERN.test(projectSlug)) {
            return reply.header('Cache-Control', 'no-store').status(204).send()
        }
        try {
            await recordLauncherPresence(projectSlug, parsed.data.dailyToken)
        } catch (error) {
            app.log.error(error, 'Anonymous Launcher presence write failed')
            return reply.header('Cache-Control', 'no-store').status(503).send()
        }
        return reply.header('Cache-Control', 'no-store').status(204).send()
    })
}

export async function registerLauncherUsageRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/v1/projects/:projectId/launcher-usage', {
        preHandler: requireRole('ADMIN', 'EDITOR', 'AUDITOR')
    }, async request => {
        const { projectId } = request.params as { projectId: string }
        const usage = await getLauncherUsage(projectId)
        if (!usage) throw new HttpError(404, 'Distribution not found')
        return usage
    })
}
