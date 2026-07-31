import { randomUUID } from 'crypto'
import { curseForgeImportSchema } from '@nebula/shared'
import type { FastifyInstance } from 'fastify'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { writeAudit } from '../audit.js'
import { getConfig } from '../config.js'
import { getPool, withTransaction } from '../db/index.js'
import { HttpError, requireCsrf, requireRole } from '../http.js'
import { uploadStream } from '../storage.js'
import { auditContextFromRequest } from '../types.js'

interface UploadRow extends RowDataPacket {
    id: string
    project_id: string
    object_key: string
    original_name: string
    mime_type: string
    size: number
    md5: string
    sha256: string
    status: 'READY' | 'DELETED'
    created_at: Date
}

export async function registerUploadRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/v1/projects/:projectId/uploads', { preHandler: requireRole('ADMIN', 'EDITOR', 'AUDITOR') }, async request => {
        const { projectId } = request.params as { projectId: string }
        const [rows] = await getPool().execute<UploadRow[]>(
            `SELECT id, project_id, original_name, mime_type, size, md5, sha256, status, created_at
             FROM uploads WHERE project_id = ? AND status = 'READY' ORDER BY created_at DESC LIMIT 500`,
            [projectId]
        )
        return { items: rows.map(row => ({
            id: row.id,
            projectId: row.project_id,
            originalName: row.original_name,
            mimeType: row.mime_type,
            size: Number(row.size),
            md5: row.md5,
            sha256: row.sha256,
            status: row.status,
            createdAt: row.created_at
        })) }
    })

    app.post('/api/v1/projects/:projectId/uploads', { preHandler: requireRole('ADMIN', 'EDITOR') }, async (request, reply) => {
        requireCsrf(request)
        const { projectId } = request.params as { projectId: string }
        const [projects] = await getPool().execute<RowDataPacket[]>(
            'SELECT id FROM projects WHERE id = ? AND disabled = FALSE',
            [projectId]
        )
        if (!projects[0]) {
            throw new HttpError(404, 'Project not found')
        }
        const file = await request.file({ limits: { fileSize: getConfig().maxUploadBytes, files: 1 } })
        if (!file) {
            throw new HttpError(400, 'File is required')
        }
        const stored = await uploadStream(
            projectId,
            file.filename,
            file.mimetype || 'application/octet-stream',
            file.file,
            getConfig().maxUploadBytes
        )
        if (file.file.truncated) {
            throw new HttpError(413, 'Upload too large')
        }
        const id = randomUUID()
        await withTransaction(async connection => {
            await connection.execute(
                `INSERT INTO uploads (
                    id, project_id, object_key, original_name, mime_type, size, md5, sha256, status, created_by, created_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'READY', ?, UTC_TIMESTAMP(3))`,
                [
                    id, projectId, stored.objectKey, file.filename.slice(0, 512),
                    file.mimetype || 'application/octet-stream', stored.size, stored.md5, stored.sha256, request.auth.id
                ]
            )
            await writeAudit(connection, auditContextFromRequest(request), {
                action: 'upload.created',
                entityType: 'upload',
                entityId: id,
                projectId,
                after: {
                    originalName: file.filename,
                    size: stored.size,
                    md5: stored.md5,
                    sha256: stored.sha256
                }
            })
        })
        return reply.status(201).send({ id, ...stored, objectKey: undefined })
    })

    app.delete('/api/v1/projects/:projectId/uploads/:uploadId', { preHandler: requireRole('ADMIN', 'EDITOR') }, async request => {
        requireCsrf(request)
        const { projectId, uploadId } = request.params as { projectId: string, uploadId: string }
        await withTransaction(async connection => {
            const [references] = await connection.query<RowDataPacket[]>(
                `SELECT id FROM modules WHERE upload_id = ?
                 UNION ALL SELECT id FROM servers WHERE icon_upload_id = ? LIMIT 1`,
                [uploadId, uploadId]
            )
            if (references[0]) {
                throw new HttpError(409, 'Upload is still in use')
            }
            const [result] = await connection.execute<ResultSetHeader>(
                'UPDATE uploads SET status = \'DELETED\' WHERE id = ? AND project_id = ? AND status = \'READY\'',
                [uploadId, projectId]
            )
            if (result.affectedRows === 0) {
                throw new HttpError(404, 'Upload not found')
            }
            await writeAudit(connection, auditContextFromRequest(request), {
                action: 'upload.deleted',
                entityType: 'upload',
                entityId: uploadId,
                projectId
            })
        })
        return { deleted: true }
    })

    app.post('/api/v1/projects/:projectId/imports/curseforge', { preHandler: requireRole('ADMIN', 'EDITOR') }, async (request, reply) => {
        requireCsrf(request)
        const { projectId } = request.params as { projectId: string }
        const parsed = curseForgeImportSchema.safeParse(request.body)
        if (!parsed.success) {
            throw new HttpError(400, 'Invalid CurseForge import', undefined, parsed.error.flatten())
        }
        if (!process.env.CURSEFORGE_API_KEY) {
            throw new HttpError(503, 'CurseForge integration is not configured')
        }
        const jobId = randomUUID()
        await withTransaction(async connection => {
            const [uploads] = await connection.query<UploadRow[]>(
                'SELECT * FROM uploads WHERE id = ? AND project_id = ? AND status = \'READY\' FOR UPDATE',
                [parsed.data.uploadId, projectId]
            )
            if (!uploads[0]) {
                throw new HttpError(404, 'Upload not found')
            }
            const [duplicate] = await connection.query<RowDataPacket[]>(
                'SELECT id FROM servers WHERE project_id = ? AND server_key = ?',
                [projectId, parsed.data.serverKey]
            )
            if (duplicate[0]) {
                throw new HttpError(409, 'Server ID already exists')
            }
            await connection.execute(
                `INSERT INTO jobs (
                    id, project_id, kind, status, snapshot, attempts, max_attempts, progress,
                    available_at, created_by, created_at
                 ) VALUES (?, ?, 'CURSEFORGE_IMPORT', 'QUEUED', ?, 0, 3, 0, UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3))`,
                [jobId, projectId, JSON.stringify({ uploadId: parsed.data.uploadId, serverKey: parsed.data.serverKey }), request.auth.id]
            )
            await writeAudit(connection, auditContextFromRequest(request), {
                action: 'curseforge.import_queued',
                entityType: 'job',
                entityId: jobId,
                projectId,
                after: parsed.data
            })
        })
        return reply.status(202).send({ jobId })
    })
}
