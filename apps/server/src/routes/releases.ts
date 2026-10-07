import { randomUUID } from 'crypto'
import { publishSchema } from '@nebula/shared'
import type { FastifyInstance } from 'fastify'
import type { RowDataPacket } from 'mysql2/promise'
import { writeAudit } from '../audit.js'
import { getPool, withTransaction } from '../db/index.js'
import { HttpError, parsePagination, requireCsrf, requireRole } from '../http.js'
import { createPage } from '../list-pagination.js'
import { buildProjectSnapshot } from '../publisher.js'
import { auditContextFromRequest } from '../types.js'

interface JobListRow extends RowDataPacket {
    id: string
    project_id: string
    kind: string
    status: string
    attempts: number
    max_attempts: number
    progress: number
    result: unknown
    error_text: string | null
    created_at: Date
    started_at: Date | null
    completed_at: Date | null
}

export async function registerReleaseRoutes(app: FastifyInstance): Promise<void> {
    app.post('/api/v1/projects/:projectId/publish', { preHandler: requireRole('ADMIN', 'EDITOR') }, async (request, reply) => {
        requireCsrf(request)
        const { projectId } = request.params as { projectId: string }
        const parsed = publishSchema.safeParse(request.body)
        if (!parsed.success) {
            throw new HttpError(400, 'Invalid publish request', undefined, parsed.error.flatten())
        }
        const jobId = randomUUID()
        await withTransaction(async connection => {
            const snapshot = await buildProjectSnapshot(connection, projectId)
            if (snapshot.sourceDraftVersion !== parsed.data.draftVersion) {
                throw new HttpError(409, 'Draft changed', 'Reload the project before publishing')
            }
            const [activeJobs] = await connection.query<RowDataPacket[]>(
                'SELECT id FROM jobs WHERE project_id = ? AND kind = \'PUBLISH\' AND status IN (\'QUEUED\',\'RUNNING\') LIMIT 1',
                [projectId]
            )
            if (activeJobs[0]) {
                throw new HttpError(409, 'Publish already in progress')
            }
            if (snapshot.servers.length === 0 || snapshot.servers.filter(server => server.mainServer).length !== 1) {
                throw new HttpError(409, 'Exactly one main server is required')
            }
            await connection.execute(
                `INSERT INTO jobs (
                    id, project_id, kind, status, snapshot, attempts, max_attempts, progress,
                    available_at, created_by, created_at
                 ) VALUES (?, ?, 'PUBLISH', 'QUEUED', ?, 0, 3, 0, UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3))`,
                [jobId, projectId, JSON.stringify(snapshot), request.auth.id]
            )
            await writeAudit(connection, auditContextFromRequest(request), {
                action: 'publish.queued',
                entityType: 'job',
                entityId: jobId,
                projectId,
                after: { sourceDraftVersion: snapshot.sourceDraftVersion }
            })
        })
        return reply.status(202).send({ jobId })
    })

    app.get('/api/v1/projects/:projectId/jobs', { preHandler: requireRole('ADMIN', 'EDITOR', 'AUDITOR') }, async request => {
        const { projectId } = request.params as { projectId: string }
        const query = request.query as Record<string, unknown>
        const { limit, offset } = parsePagination({ ...query, limit: query.limit ?? 100 })
        const [rows] = await getPool().execute<JobListRow[]>(
            `SELECT id, project_id, kind, status, attempts, max_attempts, progress, result,
                    error_text, created_at, started_at, completed_at
             FROM jobs WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
            [projectId, limit + 1, offset]
        )
        return createPage(rows.map(row => ({
            id: row.id,
            projectId: row.project_id,
            kind: row.kind,
            status: row.status,
            attempts: row.attempts,
            maxAttempts: row.max_attempts,
            progress: row.progress,
            result: row.result,
            error: row.error_text,
            createdAt: row.created_at,
            startedAt: row.started_at,
            completedAt: row.completed_at
        })), limit, offset)
    })

    app.post('/api/v1/jobs/:jobId/retry', { preHandler: requireRole('ADMIN', 'EDITOR') }, async request => {
        requireCsrf(request)
        const { jobId } = request.params as { jobId: string }
        await withTransaction(async connection => {
            const [owners] = await connection.query<(RowDataPacket & { project_id: string })[]>(
                'SELECT project_id FROM jobs WHERE id = ?', [jobId]
            )
            if (!owners[0]) throw new HttpError(404, 'Job not found')
            // Match publish queueing and private-upload cleanup lock order.
            const [projects] = await connection.query<RowDataPacket[]>(
                'SELECT id FROM projects WHERE id = ? AND disabled = FALSE FOR UPDATE', [owners[0].project_id]
            )
            if (!projects[0]) throw new HttpError(409, 'Project is unavailable')
            const [rows] = await connection.query<(RowDataPacket & { project_id: string, status: string })[]>(
                'SELECT project_id, status FROM jobs WHERE id = ? FOR UPDATE',
                [jobId]
            )
            const job = rows[0]
            if (!job) {
                throw new HttpError(404, 'Job not found')
            }
            if (job.status !== 'FAILED') {
                throw new HttpError(409, 'Only failed jobs can be retried')
            }
            await connection.execute(
                `UPDATE jobs SET status = 'QUEUED', attempts = 0, progress = 0, available_at = UTC_TIMESTAMP(3),
                 locked_by = NULL, locked_at = NULL, heartbeat_at = NULL, error_text = NULL, completed_at = NULL WHERE id = ?`,
                [jobId]
            )
            await writeAudit(connection, auditContextFromRequest(request), {
                action: 'job.retried',
                entityType: 'job',
                entityId: jobId,
                projectId: job.project_id
            })
        })
        return { queued: true }
    })
}
