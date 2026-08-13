import { randomUUID } from 'crypto'
import { moduleInputSchema, projectInputSchema, serverInputSchema } from '@nebula/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { writeAudit } from '../audit.js'
import { getPool, withTransaction } from '../db/index.js'
import { HttpError, requireCsrf, requireRole } from '../http.js'
import {
    assertFileDestinationAvailable,
    ensureFileParentDirectories,
    managedPathKey,
    normalizeManagedFileName,
    normalizeManagedPath
} from '../managed-paths.js'
import { auditContextFromRequest } from '../types.js'
import { getLauncherUrl, isStableDistributionReady } from '../stable-distribution.js'

interface ProjectRow extends RowDataPacket {
    id: string
    slug: string
    name: string
    description: string
    rss: string
    discord: unknown
    draft_revision: number
    active_release_id: string | null
    disabled: number
    created_at: Date
    updated_at: Date
}

interface ServerRow extends RowDataPacket {
    id: string
    project_id: string
    server_key: string
    name: string
    description: string
    minecraft_version: string
    server_version: string
    address: string
    discord: unknown
    icon_upload_id: string | null
    forge_version: string | null
    fabric_version: string | null
    main_server: number
    autoconnect: number
    sort_order: number
    java_options: unknown
    revision: number
    published_once: number
    created_at: Date
    updated_at: Date
}

interface ModuleRow extends RowDataPacket {
    id: string
    project_id: string
    server_id: string
    upload_id: string | null
    type: 'ForgeMod' | 'FabricMod' | 'Library' | 'File'
    display_name: string
    file_name: string | null
    module_id: string | null
    relative_path: string | null
    optional_mode: 'REQUIRED' | 'OPTIONAL_ON' | 'OPTIONAL_OFF'
    sort_order: number
    needs_manual_file: number
    manual_url: string | null
    original_name?: string
    size?: number
    md5?: string
    sha256?: string
    created_at: Date
    updated_at: Date
}

function mapProject(row: ProjectRow): Record<string, unknown> {
    return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        rss: row.rss,
        discord: row.discord,
        draftRevision: Number(row.draft_revision),
        activeReleaseId: row.active_release_id,
        disabled: Boolean(row.disabled),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        launcherUrl: getLauncherUrl(row.slug)
    }
}

function mapServer(row: ServerRow): Record<string, unknown> {
    return {
        id: row.id,
        projectId: row.project_id,
        serverKey: row.server_key,
        name: row.name,
        description: row.description,
        minecraftVersion: row.minecraft_version,
        serverVersion: row.server_version,
        address: row.address,
        discord: row.discord,
        iconUploadId: row.icon_upload_id,
        forgeVersion: row.forge_version,
        fabricVersion: row.fabric_version,
        mainServer: Boolean(row.main_server),
        autoconnect: Boolean(row.autoconnect),
        sortOrder: row.sort_order,
        javaOptions: row.java_options,
        revision: Number(row.revision),
        publishedOnce: Boolean(row.published_once),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

function mapModule(row: ModuleRow): Record<string, unknown> {
    return {
        id: row.id,
        projectId: row.project_id,
        serverId: row.server_id,
        uploadId: row.upload_id,
        type: row.type,
        displayName: row.display_name,
        fileName: row.file_name ?? row.original_name,
        moduleId: row.module_id,
        relativePath: row.relative_path,
        optionalMode: row.optional_mode,
        sortOrder: row.sort_order,
        needsManualFile: Boolean(row.needs_manual_file),
        manualUrl: row.manual_url,
        originalName: row.original_name,
        size: row.size,
        md5: row.md5,
        sha256: row.sha256,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

function managedFileName(
    type: ModuleRow['type'],
    relativePath: string | null,
    requestedName: string | null | undefined,
    uploadName: string
): string {
    if (type === 'File') {
        return normalizeManagedPath(relativePath ?? '').split('/').at(-1)!
    }
    return normalizeManagedFileName(requestedName ?? uploadName)
}

async function assertFixedDestinationAvailable(
    connection: PoolConnection,
    serverId: string,
    type: ModuleRow['type'],
    optionalMode: ModuleRow['optional_mode'],
    fileName: string,
    excludeModuleId?: string
): Promise<void> {
    if (type === 'File') {
        return
    }
    const [rows] = await connection.query<ModuleRow[]>(
        `SELECT m.*, u.original_name FROM modules m
         LEFT JOIN uploads u ON u.id = m.upload_id
         WHERE m.server_id = ? ${excludeModuleId ? 'AND m.id <> ?' : ''}`,
        excludeModuleId ? [serverId, excludeModuleId] : [serverId]
    )
    const destination = managedPathKey(`${type}:${type === 'Library' ? 'REQUIRED' : optionalMode}:${fileName}`)
    const duplicate = rows.some(row => {
        if (row.type !== type) {
            return false
        }
        const existingName = row.file_name ?? row.original_name
        if (!existingName) {
            return false
        }
        const existing = managedPathKey(`${row.type}:${row.type === 'Library' ? 'REQUIRED' : row.optional_mode}:${existingName}`)
        return existing === destination
    })
    if (duplicate) {
        throw new HttpError(409, 'Module path already exists')
    }
}

function getRevision(request: FastifyRequest): number {
    const revision = Number((request.body as Record<string, unknown> | undefined)?.revision)
    if (!Number.isInteger(revision) || revision < 0) {
        throw new HttpError(400, 'Revision required', 'Mutation body must contain the current project revision')
    }
    return revision
}

async function lockProject(connection: PoolConnection, projectId: string, expectedRevision: number): Promise<ProjectRow> {
    const [rows] = await connection.query<ProjectRow[]>('SELECT * FROM projects WHERE id = ? FOR UPDATE', [projectId])
    const project = rows[0]
    if (!project || project.disabled) {
        throw new HttpError(404, 'Project not found')
    }
    if (Number(project.draft_revision) !== expectedRevision) {
        throw new HttpError(409, 'Draft changed', 'Reload the project before saving')
    }
    return project
}

async function bumpProject(connection: PoolConnection, projectId: string): Promise<void> {
    await connection.execute(
        'UPDATE projects SET draft_revision = draft_revision + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?',
        [projectId]
    )
}

async function replaceUntrackedRules(
    connection: PoolConnection,
    serverId: string,
    rules: { appliesTo: string, pattern: string }[]
): Promise<void> {
    await connection.execute('DELETE FROM untracked_rules WHERE server_id = ?', [serverId])
    for (const rule of rules) {
        await connection.execute(
            'INSERT INTO untracked_rules (id, server_id, applies_to, pattern) VALUES (?, ?, ?, ?)',
            [randomUUID(), serverId, rule.appliesTo, rule.pattern]
        )
    }
}

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/v1/projects', { preHandler: requireRole('ADMIN', 'EDITOR', 'AUDITOR') }, async () => {
        const [rows] = await getPool().query<ProjectRow[]>('SELECT * FROM projects WHERE disabled = FALSE ORDER BY name')
        return { items: rows.map(mapProject) }
    })

    app.get('/api/v1/projects/:projectId', { preHandler: requireRole('ADMIN', 'EDITOR', 'AUDITOR') }, async request => {
        const { projectId } = request.params as { projectId: string }
        const [projectRows] = await getPool().execute<ProjectRow[]>('SELECT * FROM projects WHERE id = ? AND disabled = FALSE', [projectId])
        const project = projectRows[0]
        if (!project) {
            throw new HttpError(404, 'Project not found')
        }
        const [serverRows] = await getPool().execute<ServerRow[]>(
            'SELECT * FROM servers WHERE project_id = ? ORDER BY sort_order, name',
            [projectId]
        )
        const [moduleRows] = await getPool().execute<ModuleRow[]>(
            `SELECT m.*, u.original_name, u.size, u.md5, u.sha256
             FROM modules m LEFT JOIN uploads u ON u.id = m.upload_id
             WHERE m.project_id = ? ORDER BY m.server_id, m.sort_order, m.display_name`,
            [projectId]
        )
        const [ruleRows] = await getPool().execute<(RowDataPacket & { id: string, server_id: string, applies_to: string, pattern: string })[]>(
            `SELECT r.* FROM untracked_rules r INNER JOIN servers s ON s.id = r.server_id
             WHERE s.project_id = ? ORDER BY r.applies_to, r.pattern`,
            [projectId]
        )
        const stableDistributionReady = await isStableDistributionReady(
            project.id,
            project.slug,
            project.active_release_id
        )
        return {
            project: { ...mapProject(project), stableDistributionReady },
            servers: serverRows.map(row => ({
                ...mapServer(row),
                modules: moduleRows.filter(module => module.server_id === row.id).map(mapModule),
                untrackedRules: ruleRows.filter(rule => rule.server_id === row.id).map(rule => ({
                    id: rule.id,
                    appliesTo: rule.applies_to,
                    pattern: rule.pattern
                }))
            }))
        }
    })

    app.post('/api/v1/projects', { preHandler: requireRole('ADMIN') }, async (request, reply) => {
        requireCsrf(request)
        const parsed = projectInputSchema.safeParse(request.body)
        if (!parsed.success) {
            throw new HttpError(400, 'Invalid project', undefined, parsed.error.flatten())
        }
        const id = randomUUID()
        try {
            await withTransaction(async connection => {
                await connection.execute(
                    `INSERT INTO projects (id, slug, name, description, rss, discord, draft_revision, disabled, created_by, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, 0, FALSE, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
                    [id, parsed.data.slug, parsed.data.name, parsed.data.description, parsed.data.rss, JSON.stringify(parsed.data.discord ?? null), request.auth.id]
                )
                await writeAudit(connection, auditContextFromRequest(request), {
                    action: 'project.created',
                    entityType: 'project',
                    entityId: id,
                    projectId: id,
                    after: parsed.data
                })
            })
        } catch (error) {
            if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
                throw new HttpError(409, 'Project slug already exists')
            }
            throw error
        }
        return reply.status(201).send({ id, draftRevision: 0 })
    })

    app.put('/api/v1/projects/:projectId', { preHandler: requireRole('ADMIN', 'EDITOR') }, async request => {
        requireCsrf(request)
        const { projectId } = request.params as { projectId: string }
        const expectedRevision = getRevision(request)
        const parsed = projectInputSchema.safeParse(request.body)
        if (!parsed.success) {
            throw new HttpError(400, 'Invalid project', undefined, parsed.error.flatten())
        }
        await withTransaction(async connection => {
            const before = await lockProject(connection, projectId, expectedRevision)
            if (before.active_release_id && before.slug !== parsed.data.slug) {
                throw new HttpError(409, 'Published slug is immutable')
            }
            await connection.execute(
                `UPDATE projects SET slug = ?, name = ?, description = ?, rss = ?, discord = ?,
                 draft_revision = draft_revision + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
                [parsed.data.slug, parsed.data.name, parsed.data.description, parsed.data.rss, JSON.stringify(parsed.data.discord ?? null), projectId]
            )
            await writeAudit(connection, auditContextFromRequest(request), {
                action: 'project.updated',
                entityType: 'project',
                entityId: projectId,
                projectId,
                before: mapProject(before),
                after: parsed.data
            })
        })
        return { updated: true, draftRevision: expectedRevision + 1 }
    })

    app.delete('/api/v1/projects/:projectId', { preHandler: requireRole('ADMIN') }, async request => {
        requireCsrf(request)
        const { projectId } = request.params as { projectId: string }
        const expectedRevision = getRevision(request)
        await withTransaction(async connection => {
            const before = await lockProject(connection, projectId, expectedRevision)
            await connection.execute('UPDATE projects SET disabled = TRUE, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [projectId])
            await writeAudit(connection, auditContextFromRequest(request), {
                action: 'project.disabled',
                entityType: 'project',
                entityId: projectId,
                projectId,
                before: mapProject(before),
                after: { disabled: true }
            })
        })
        return { disabled: true }
    })

    app.post('/api/v1/projects/:projectId/servers', { preHandler: requireRole('ADMIN', 'EDITOR') }, async (request, reply) => {
        requireCsrf(request)
        const { projectId } = request.params as { projectId: string }
        const expectedRevision = getRevision(request)
        const parsed = serverInputSchema.safeParse(request.body)
        if (!parsed.success) {
            throw new HttpError(400, 'Invalid server', undefined, parsed.error.flatten())
        }
        const id = randomUUID()
        try {
            await withTransaction(async connection => {
                await lockProject(connection, projectId, expectedRevision)
                if (parsed.data.mainServer) {
                    await connection.execute('UPDATE servers SET main_server = FALSE WHERE project_id = ?', [projectId])
                }
                await connection.execute(
                    `INSERT INTO servers (
                        id, project_id, server_key, name, description, minecraft_version, server_version, address, discord,
                        icon_upload_id, forge_version, fabric_version, main_server, autoconnect, sort_order,
                        java_options, revision, published_once, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
                    [
                        id, projectId, parsed.data.serverKey, parsed.data.name, parsed.data.description,
                        parsed.data.minecraftVersion, parsed.data.serverVersion, parsed.data.address,
                        JSON.stringify(parsed.data.discord ?? null),
                        parsed.data.iconUploadId ?? null, parsed.data.forgeVersion || null, parsed.data.fabricVersion || null,
                        parsed.data.mainServer, parsed.data.autoconnect, parsed.data.sortOrder,
                        JSON.stringify(parsed.data.javaOptions ?? null)
                    ]
                )
                await replaceUntrackedRules(connection, id, parsed.data.untrackedRules)
                await bumpProject(connection, projectId)
                await writeAudit(connection, auditContextFromRequest(request), {
                    action: 'server.created',
                    entityType: 'server',
                    entityId: id,
                    projectId,
                    after: parsed.data
                })
            })
        } catch (error) {
            if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
                throw new HttpError(409, 'Server ID already exists')
            }
            throw error
        }
        return reply.status(201).send({ id, draftRevision: expectedRevision + 1 })
    })

    app.put('/api/v1/projects/:projectId/servers/:serverId', { preHandler: requireRole('ADMIN', 'EDITOR') }, async request => {
        requireCsrf(request)
        const { projectId, serverId } = request.params as { projectId: string, serverId: string }
        const expectedRevision = getRevision(request)
        const parsed = serverInputSchema.safeParse(request.body)
        if (!parsed.success) {
            throw new HttpError(400, 'Invalid server', undefined, parsed.error.flatten())
        }
        await withTransaction(async connection => {
            await lockProject(connection, projectId, expectedRevision)
            const [beforeRows] = await connection.query<ServerRow[]>(
                'SELECT * FROM servers WHERE id = ? AND project_id = ? FOR UPDATE',
                [serverId, projectId]
            )
            const before = beforeRows[0]
            if (!before) {
                throw new HttpError(404, 'Server not found')
            }
            if (before.published_once && before.server_key !== parsed.data.serverKey) {
                throw new HttpError(409, 'Published server ID is immutable')
            }
            if (parsed.data.mainServer) {
                await connection.execute('UPDATE servers SET main_server = FALSE WHERE project_id = ? AND id <> ?', [projectId, serverId])
            }
            await connection.execute(
                `UPDATE servers SET server_key = ?, name = ?, description = ?, minecraft_version = ?,
                 server_version = ?, address = ?, discord = ?, icon_upload_id = ?, forge_version = ?, fabric_version = ?,
                 main_server = ?, autoconnect = ?, sort_order = ?, java_options = ?, revision = revision + 1,
                 updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
                [
                    parsed.data.serverKey, parsed.data.name, parsed.data.description, parsed.data.minecraftVersion,
                    parsed.data.serverVersion, parsed.data.address, JSON.stringify(parsed.data.discord ?? null), parsed.data.iconUploadId ?? null,
                    parsed.data.forgeVersion || null, parsed.data.fabricVersion || null, parsed.data.mainServer,
                    parsed.data.autoconnect, parsed.data.sortOrder, JSON.stringify(parsed.data.javaOptions ?? null), serverId
                ]
            )
            await replaceUntrackedRules(connection, serverId, parsed.data.untrackedRules)
            await bumpProject(connection, projectId)
            await writeAudit(connection, auditContextFromRequest(request), {
                action: 'server.updated',
                entityType: 'server',
                entityId: serverId,
                projectId,
                before: mapServer(before),
                after: parsed.data
            })
        })
        return { updated: true, draftRevision: expectedRevision + 1 }
    })

    app.delete('/api/v1/projects/:projectId/servers/:serverId', { preHandler: requireRole('ADMIN', 'EDITOR') }, async request => {
        requireCsrf(request)
        const { projectId, serverId } = request.params as { projectId: string, serverId: string }
        const expectedRevision = getRevision(request)
        await withTransaction(async connection => {
            await lockProject(connection, projectId, expectedRevision)
            const [beforeRows] = await connection.query<ServerRow[]>(
                'SELECT * FROM servers WHERE id = ? AND project_id = ? FOR UPDATE',
                [serverId, projectId]
            )
            const before = beforeRows[0]
            if (!before) {
                throw new HttpError(404, 'Server not found')
            }
            await connection.execute('DELETE FROM servers WHERE id = ?', [serverId])
            await bumpProject(connection, projectId)
            await writeAudit(connection, auditContextFromRequest(request), {
                action: 'server.deleted',
                entityType: 'server',
                entityId: serverId,
                projectId,
                before: mapServer(before)
            })
        })
        return { deleted: true, draftRevision: expectedRevision + 1 }
    })

    app.post('/api/v1/projects/:projectId/servers/:serverId/modules', { preHandler: requireRole('ADMIN', 'EDITOR') }, async (request, reply) => {
        requireCsrf(request)
        const { projectId, serverId } = request.params as { projectId: string, serverId: string }
        const expectedRevision = getRevision(request)
        const parsed = moduleInputSchema.safeParse(request.body)
        if (!parsed.success) {
            throw new HttpError(400, 'Invalid module', undefined, parsed.error.flatten())
        }
        const id = randomUUID()
        await withTransaction(async connection => {
            await lockProject(connection, projectId, expectedRevision)
            const [serverRows] = await connection.query<ServerRow[]>(
                'SELECT * FROM servers WHERE id = ? AND project_id = ? FOR UPDATE',
                [serverId, projectId]
            )
            const server = serverRows[0]
            if (!server) {
                throw new HttpError(404, 'Server not found')
            }
            if (parsed.data.type === 'ForgeMod' && !server.forge_version || parsed.data.type === 'FabricMod' && !server.fabric_version) {
                throw new HttpError(409, 'Module loader mismatch')
            }
            const [uploadRows] = await connection.query<(RowDataPacket & { id: string, original_name: string })[]>(
                'SELECT id, original_name FROM uploads WHERE id = ? AND project_id = ? AND status = \'READY\'',
                [parsed.data.uploadId, projectId]
            )
            const upload = uploadRows[0]
            if (!upload) {
                throw new HttpError(404, 'Upload not found')
            }
            const relativePath = parsed.data.type === 'File'
                ? normalizeManagedPath(parsed.data.relativePath ?? '')
                : null
            const fileName = managedFileName(parsed.data.type, relativePath, parsed.data.fileName, upload.original_name)
            if (relativePath) {
                await assertFileDestinationAvailable(connection, serverId, relativePath)
                await ensureFileParentDirectories(connection, projectId, serverId, relativePath)
            }
            await assertFixedDestinationAvailable(
                connection,
                serverId,
                parsed.data.type,
                parsed.data.optionalMode,
                fileName
            )
            await connection.execute(
                `INSERT INTO modules (
                    id, project_id, server_id, upload_id, type, display_name, file_name, module_id, relative_path,
                    optional_mode, sort_order, needs_manual_file, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
                [
                    id, projectId, serverId, parsed.data.uploadId, parsed.data.type, parsed.data.displayName,
                    fileName, parsed.data.moduleId ?? null, relativePath,
                    parsed.data.optionalMode, parsed.data.sortOrder
                ]
            )
            await bumpProject(connection, projectId)
            await writeAudit(connection, auditContextFromRequest(request), {
                action: 'module.created',
                entityType: 'module',
                entityId: id,
                projectId,
                after: { ...parsed.data, fileName, relativePath }
            })
        })
        return reply.status(201).send({ id, draftRevision: expectedRevision + 1 })
    })

    app.put('/api/v1/projects/:projectId/servers/:serverId/modules/:moduleId', { preHandler: requireRole('ADMIN', 'EDITOR') }, async request => {
        requireCsrf(request)
        const { projectId, serverId, moduleId } = request.params as { projectId: string, serverId: string, moduleId: string }
        const expectedRevision = getRevision(request)
        const parsed = moduleInputSchema.safeParse(request.body)
        if (!parsed.success) {
            throw new HttpError(400, 'Invalid module', undefined, parsed.error.flatten())
        }
        await withTransaction(async connection => {
            await lockProject(connection, projectId, expectedRevision)
            const [beforeRows] = await connection.query<ModuleRow[]>(
                'SELECT * FROM modules WHERE id = ? AND server_id = ? AND project_id = ? FOR UPDATE',
                [moduleId, serverId, projectId]
            )
            const before = beforeRows[0]
            if (!before) {
                throw new HttpError(404, 'Module not found')
            }
            const [uploadRows] = await connection.query<(RowDataPacket & { id: string, original_name: string })[]>(
                'SELECT id, original_name FROM uploads WHERE id = ? AND project_id = ? AND status = \'READY\'',
                [parsed.data.uploadId, projectId]
            )
            const upload = uploadRows[0]
            if (!upload) {
                throw new HttpError(404, 'Upload not found')
            }
            const relativePath = parsed.data.type === 'File'
                ? normalizeManagedPath(parsed.data.relativePath ?? '')
                : null
            const fileName = managedFileName(
                parsed.data.type,
                relativePath,
                parsed.data.fileName ?? before.file_name,
                upload.original_name
            )
            if (relativePath) {
                await assertFileDestinationAvailable(connection, serverId, relativePath, moduleId)
                await ensureFileParentDirectories(connection, projectId, serverId, relativePath)
            }
            await assertFixedDestinationAvailable(
                connection,
                serverId,
                parsed.data.type,
                parsed.data.optionalMode,
                fileName,
                moduleId
            )
            await connection.execute(
                `UPDATE modules SET upload_id = ?, type = ?, display_name = ?, file_name = ?, module_id = ?, relative_path = ?,
                 optional_mode = ?, sort_order = ?, needs_manual_file = FALSE, manual_url = NULL,
                 updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
                [
                    parsed.data.uploadId, parsed.data.type, parsed.data.displayName, fileName, parsed.data.moduleId ?? null,
                    relativePath, parsed.data.optionalMode, parsed.data.sortOrder, moduleId
                ]
            )
            await bumpProject(connection, projectId)
            await writeAudit(connection, auditContextFromRequest(request), {
                action: 'module.updated',
                entityType: 'module',
                entityId: moduleId,
                projectId,
                before: mapModule(before),
                after: { ...parsed.data, fileName, relativePath }
            })
        })
        return { updated: true, draftRevision: expectedRevision + 1 }
    })

    app.delete('/api/v1/projects/:projectId/servers/:serverId/modules/:moduleId', { preHandler: requireRole('ADMIN', 'EDITOR') }, async request => {
        requireCsrf(request)
        const { projectId, serverId, moduleId } = request.params as { projectId: string, serverId: string, moduleId: string }
        const expectedRevision = getRevision(request)
        await withTransaction(async connection => {
            await lockProject(connection, projectId, expectedRevision)
            const [beforeRows] = await connection.query<ModuleRow[]>(
                'SELECT * FROM modules WHERE id = ? AND server_id = ? AND project_id = ? FOR UPDATE',
                [moduleId, serverId, projectId]
            )
            const before = beforeRows[0]
            if (!before) {
                throw new HttpError(404, 'Module not found')
            }
            const [result] = await connection.execute<ResultSetHeader>('DELETE FROM modules WHERE id = ?', [moduleId])
            if (result.affectedRows === 0) {
                throw new HttpError(404, 'Module not found')
            }
            await bumpProject(connection, projectId)
            await writeAudit(connection, auditContextFromRequest(request), {
                action: 'module.deleted',
                entityType: 'module',
                entityId: moduleId,
                projectId,
                before: mapModule(before)
            })
        })
        return { deleted: true, draftRevision: expectedRevision + 1 }
    })
}
