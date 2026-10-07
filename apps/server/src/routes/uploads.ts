import { randomUUID } from 'crypto'
import { curseForgeImportSchema, explorerDownloadSchema, isSafeRelativePath } from '@nebula/shared'
import { ZipArchive, type ArchiverError } from 'archiver'
import type { FastifyInstance } from 'fastify'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { PassThrough } from 'stream'
import { pipeline } from 'stream/promises'
import { writeAudit } from '../audit.js'
import { getConfig } from '../config.js'
import { getPool, withTransaction } from '../db/index.js'
import { HttpError, requireCsrf, requireRole } from '../http.js'
import { deleteObjects, getStoredObject, uploadStream } from '../storage.js'
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

interface ModuleDownloadRow extends UploadRow {
    module_file_name: string | null
    relative_path: string | null
    display_name: string
}

interface ExplorerDownloadDirectoryRow extends RowDataPacket {
    id: string
    path: string
}

interface ExplorerDownloadModuleRow extends RowDataPacket {
    id: string
    upload_id: string | null
    type: 'ForgeMod' | 'FabricMod' | 'Library' | 'File'
    file_name: string | null
    relative_path: string | null
    optional_mode: 'REQUIRED' | 'OPTIONAL_ON' | 'OPTIONAL_OFF'
    display_name: string
    needs_manual_file: number
    original_name: string | null
    object_key: string | null
    upload_status: 'READY' | 'DELETED' | null
}

function parseByteRange(header: string | undefined, size: number): { start: number, end: number } | null | false {
    if (!header) {
        return null
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
    if (!match || (!match[1] && !match[2])) {
        return false
    }
    let start: number
    let end: number
    if (!match[1]) {
        const suffix = Number(match[2])
        if (!Number.isInteger(suffix) || suffix <= 0) {
            return false
        }
        start = Math.max(0, size - suffix)
        end = size - 1
    } else {
        start = Number(match[1])
        end = match[2] ? Number(match[2]) : size - 1
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) {
        return false
    }
    return { start, end: Math.min(end, size - 1) }
}

function downloadFileName(row: ModuleDownloadRow): string {
    const candidate = row.module_file_name
        ?? row.relative_path?.split('/').at(-1)
        ?? row.original_name
        ?? row.display_name
    return candidate.split(/[/\\]/).at(-1) || 'download'
}

function attachmentDisposition(fileName: string): string {
    const fallback = Array.from(fileName, character => {
        const codePoint = character.codePointAt(0) ?? 0
        return codePoint >= 0x20 && codePoint <= 0x7e && character !== '"' && character !== '\\'
            ? character
            : '_'
    }).join('') || 'download'
    const encoded = encodeURIComponent(fileName).replace(/[!'()*]/g, character =>
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    )
    return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

function archiveModulePath(row: ExplorerDownloadModuleRow): string {
    let path: string
    if (row.type === 'File') {
        if (!row.relative_path) throw new HttpError(409, 'Module path is missing')
        path = `files/${row.relative_path}`
    } else {
        const fileName = row.file_name ?? row.original_name ?? row.display_name
        if (row.type === 'Library') {
            path = `libraries/${fileName}`
        } else {
            const root = row.type === 'ForgeMod' ? 'forgemods' : 'fabricmods'
            const folder = row.optional_mode === 'OPTIONAL_ON'
                ? 'optionalon'
                : row.optional_mode === 'OPTIONAL_OFF'
                    ? 'optionaloff'
                    : 'required'
            path = `${root}/${folder}/${fileName}`
        }
    }
    const normalized = path.normalize('NFC')
    if (!isSafeRelativePath(normalized)) {
        throw new HttpError(409, 'Unsafe archive path', `Cannot archive ${row.display_name}`)
    }
    return normalized
}

function pathInside(candidate: string, parent: string): boolean {
    const candidateKey = candidate.normalize('NFC').toLowerCase()
    const parentKey = parent.normalize('NFC').toLowerCase()
    return candidateKey === parentKey || candidateKey.startsWith(`${parentKey}/`)
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

    app.get('/api/v1/projects/:projectId/uploads/:uploadId/content', {
        preHandler: requireRole('ADMIN', 'EDITOR', 'AUDITOR')
    }, async (request, reply) => {
        const { projectId, uploadId } = request.params as { projectId: string, uploadId: string }
        const [rows] = await getPool().execute<UploadRow[]>(
            `SELECT * FROM uploads
             WHERE id = ? AND project_id = ? AND status = 'READY'`,
            [uploadId, projectId]
        )
        const upload = rows[0]
        if (!upload) {
            throw new HttpError(404, 'Upload not found')
        }
        if (!['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm'].includes(upload.mime_type.toLowerCase())) {
            throw new HttpError(415, 'Upload is not supported Launcher media')
        }
        const size = Number(upload.size)
        const range = parseByteRange(request.headers.range, size)
        if (range === false) {
            reply.code(416)
            reply.header('Content-Range', `bytes */${size}`)
            reply.header('Accept-Ranges', 'bytes')
            return reply.send()
        }
        const rangeHeader = range ? `bytes=${range.start}-${range.end}` : undefined
        const stored = await getStoredObject(upload.object_key, rangeHeader)
        reply.type(upload.mime_type)
        reply.header('Cache-Control', 'private, no-store')
        reply.header('X-Content-Type-Options', 'nosniff')
        reply.header('Accept-Ranges', 'bytes')
        if (range) {
            reply.code(206)
            reply.header('Content-Range', stored.contentRange ?? `bytes ${range.start}-${range.end}/${size}`)
            reply.header('Content-Length', stored.contentLength ?? range.end - range.start + 1)
        } else {
            reply.header('Content-Length', stored.contentLength ?? size)
        }
        return reply.send(stored.body)
    })

    app.get('/api/v1/projects/:projectId/servers/:serverId/modules/:moduleRecordId/download', {
        preHandler: requireRole('ADMIN', 'EDITOR', 'AUDITOR')
    }, async (request, reply) => {
        const { projectId, serverId, moduleRecordId } = request.params as {
            projectId: string
            serverId: string
            moduleRecordId: string
        }
        const [rows] = await getPool().execute<ModuleDownloadRow[]>(
            `SELECT u.*, m.file_name AS module_file_name, m.relative_path, m.display_name
             FROM modules m
             INNER JOIN servers s ON s.id = m.server_id AND s.project_id = m.project_id
             INNER JOIN projects p ON p.id = m.project_id AND p.disabled = FALSE
             INNER JOIN uploads u ON u.id = m.upload_id AND u.project_id = m.project_id
             WHERE m.id = ? AND m.server_id = ? AND m.project_id = ? AND u.status = 'READY'`,
            [moduleRecordId, serverId, projectId]
        )
        const upload = rows[0]
        if (!upload) {
            throw new HttpError(404, 'Module file not found')
        }
        const size = Number(upload.size)
        const range = parseByteRange(request.headers.range, size)
        if (range === false) {
            reply.code(416)
            reply.header('Content-Range', `bytes */${size}`)
            reply.header('Accept-Ranges', 'bytes')
            return reply.send()
        }
        const rangeHeader = range ? `bytes=${range.start}-${range.end}` : undefined
        const stored = await getStoredObject(upload.object_key, rangeHeader)
        reply.type('application/octet-stream')
        reply.header('Content-Disposition', attachmentDisposition(downloadFileName(upload)))
        reply.header('Cache-Control', 'private, no-store')
        reply.header('X-Content-Type-Options', 'nosniff')
        reply.header('Accept-Ranges', 'bytes')
        if (range) {
            reply.code(206)
            reply.header('Content-Range', stored.contentRange ?? `bytes ${range.start}-${range.end}/${size}`)
            reply.header('Content-Length', stored.contentLength ?? range.end - range.start + 1)
        } else {
            reply.header('Content-Length', stored.contentLength ?? size)
        }
        return reply.send(stored.body)
    })

    app.post('/api/v1/projects/:projectId/servers/:serverId/explorer/download', {
        preHandler: requireRole('ADMIN', 'EDITOR', 'AUDITOR')
    }, async (request, reply) => {
        requireCsrf(request)
        const { projectId, serverId } = request.params as { projectId: string, serverId: string }
        const parsed = explorerDownloadSchema.safeParse(request.body)
        if (!parsed.success) {
            throw new HttpError(400, 'Invalid Explorer download', undefined, parsed.error.flatten())
        }
        const [servers] = await getPool().execute<(RowDataPacket & { server_key: string })[]>(
            `SELECT s.server_key FROM servers s
             INNER JOIN projects p ON p.id = s.project_id AND p.disabled = FALSE
             WHERE s.id = ? AND s.project_id = ?`,
            [serverId, projectId]
        )
        const server = servers[0]
        if (!server) throw new HttpError(404, 'Server not found')
        const [directories] = await getPool().execute<ExplorerDownloadDirectoryRow[]>(
            'SELECT id, path FROM server_directories WHERE server_id = ? AND project_id = ? ORDER BY path',
            [serverId, projectId]
        )
        const [modules] = await getPool().execute<ExplorerDownloadModuleRow[]>(
            `SELECT m.id, m.upload_id, m.type, m.file_name, m.relative_path, m.optional_mode,
                    m.display_name, m.needs_manual_file, u.original_name, u.object_key,
                    u.status AS upload_status
             FROM modules m LEFT JOIN uploads u ON u.id = m.upload_id AND u.project_id = m.project_id
             WHERE m.server_id = ? AND m.project_id = ?`,
            [serverId, projectId]
        )
        const directoryById = new Map(directories.map(directory => [directory.id, directory]))
        const moduleById = new Map(modules.map(module => [module.id, module]))
        const selectedDirectories: ExplorerDownloadDirectoryRow[] = []
        const selectedModuleIds = new Set<string>()
        for (const entry of parsed.data.entries) {
            if (entry.kind === 'directory') {
                const directory = directoryById.get(entry.id)
                if (!directory) throw new HttpError(404, 'Directory not found')
                selectedDirectories.push(directory)
            } else {
                if (!moduleById.has(entry.id)) throw new HttpError(404, 'Module not found')
                selectedModuleIds.add(entry.id)
            }
        }
        const directoryRoots = selectedDirectories.filter(directory => !selectedDirectories.some(other =>
            other.id !== directory.id && pathInside(directory.path, other.path)
        ))
        const archiveDirectories = directories.filter(directory =>
            directoryRoots.some(root => pathInside(directory.path, root.path))
        )
        const archiveModules = modules.filter(module =>
            selectedModuleIds.has(module.id)
            || module.type === 'File'
                && module.relative_path != null
                && directoryRoots.some(root => pathInside(module.relative_path!, root.path))
        )
        const missingPaths = archiveModules
            .filter(module => module.needs_manual_file || !module.object_key || module.upload_status !== 'READY')
            .map(archiveModulePath)
        if (missingPaths.length > 0) {
            const visiblePaths = missingPaths.slice(0, 20)
            const suffix = missingPaths.length > visiblePaths.length
                ? ` and ${missingPaths.length - visiblePaths.length} more`
                : ''
            throw new HttpError(409, 'Stored files are missing', `Cannot create ZIP: ${visiblePaths.join(', ')}${suffix}`)
        }
        const archiveDirectoryPaths = archiveDirectories.map(directory => {
            const path = `files/${directory.path}`.normalize('NFC')
            if (!isSafeRelativePath(path)) {
                throw new HttpError(409, 'Unsafe archive path', `Cannot archive ${directory.path}`)
            }
            return path
        })
        const archive = new ZipArchive({ zlib: { level: 6 } })
        archive.on('warning', (error: ArchiverError) => archive.destroy(error))
        for (const path of archiveDirectoryPaths) {
            archive.append('', { name: `${path}/` })
        }
        const pendingModules = archiveModules.map(module => {
            const source = new PassThrough()
            archive.append(source, { name: archiveModulePath(module) })
            return { module, source }
        })
        void (async (): Promise<void> => {
            for (const pending of pendingModules) {
                const stored = await getStoredObject(pending.module.object_key!)
                await pipeline(stored.body, pending.source)
            }
        })().catch(error => archive.destroy(error instanceof Error ? error : new Error(String(error))))
        reply.type('application/zip')
        reply.header('Content-Disposition', attachmentDisposition(`${server.server_key}-selection.zip`))
        reply.header('Cache-Control', 'private, no-store')
        reply.header('X-Content-Type-Options', 'nosniff')
        void archive.finalize().catch((error: unknown) =>
            archive.destroy(error instanceof Error ? error : new Error(String(error)))
        )
        return reply.send(archive)
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
        const id = randomUUID()
        const stored = await uploadStream(
            projectId,
            id,
            file.file,
            getConfig().maxUploadBytes
        )
        if (file.file.truncated) {
            await deleteObjects([stored.objectKey]).catch(() => undefined)
            throw new HttpError(413, 'Upload too large')
        }
        try {
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
        } catch (error) {
            await deleteObjects([stored.objectKey]).catch(() => undefined)
            throw error
        }
        return reply.status(201).send({ id, ...stored, objectKey: undefined })
    })

    app.delete('/api/v1/projects/:projectId/uploads/:uploadId', { preHandler: requireRole('ADMIN', 'EDITOR') }, async request => {
        requireCsrf(request)
        const { projectId, uploadId } = request.params as { projectId: string, uploadId: string }
        await withTransaction(async connection => {
            const [references] = await connection.query<RowDataPacket[]>(
                `SELECT id FROM modules WHERE upload_id = ?
                 UNION ALL SELECT id FROM servers WHERE icon_upload_id = ?
                 UNION ALL SELECT id FROM servers WHERE hero_background_upload_id = ?
                 UNION ALL SELECT id FROM servers WHERE hero_logo_upload_id = ?
                 UNION ALL SELECT id FROM servers WHERE hero_video_upload_id = ? LIMIT 1`,
                [uploadId, uploadId, uploadId, uploadId, uploadId]
            )
            if (references[0]) {
                throw new HttpError(409, 'Upload is still in use')
            }
            const [result] = await connection.execute<ResultSetHeader>(
                'UPDATE uploads SET status = \'DELETED\', deleted_at = UTC_TIMESTAMP(3) WHERE id = ? AND project_id = ? AND status = \'READY\'',
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
