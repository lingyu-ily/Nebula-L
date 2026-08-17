import { randomUUID } from 'crypto'
import {
    directoryDeleteSchema,
    directoryInputSchema,
    modulePatchSchema,
    moduleReplaceSchema
} from '@nebula/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { writeAudit } from '../audit.js'
import { getPool, withTransaction } from '../db/index.js'
import { HttpError, requireCsrf, requireRole } from '../http.js'
import {
    assertFileDestinationAvailable,
    ensureFileParentDirectories,
    isPathWithin,
    managedPathHash,
    managedPathKey,
    normalizeManagedFileName,
    normalizeManagedPath,
    replacePathPrefix
} from '../managed-paths.js'
import { auditContextFromRequest } from '../types.js'
import { getLauncherUrl } from '../stable-distribution.js'

type ModuleType = 'ForgeMod' | 'FabricMod' | 'Library' | 'File'
type OptionalMode = 'REQUIRED' | 'OPTIONAL_ON' | 'OPTIONAL_OFF'

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
    hero_background_upload_id: string | null
    hero_logo_upload_id: string | null
    hero_eyebrow: string | null
    hero_title: string | null
    hero_tagline: string | null
    news_rss: string | null
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

interface DirectoryRow extends RowDataPacket {
    id: string
    project_id: string
    server_id: string
    path: string
    path_hash: string
    created_at: Date
    updated_at: Date
}

interface ModuleRow extends RowDataPacket {
    id: string
    project_id: string
    server_id: string
    upload_id: string | null
    type: ModuleType
    display_name: string
    file_name: string | null
    module_id: string | null
    relative_path: string | null
    optional_mode: OptionalMode
    sort_order: number
    needs_manual_file: number
    manual_url: string | null
    original_name: string | null
    size: number | null
    md5: string | null
    sha256: string | null
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
        launcherUrl: getLauncherUrl(row.slug),
        disabled: Boolean(row.disabled),
        createdAt: row.created_at,
        updatedAt: row.updated_at
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
        launcherUi: {
            backgroundUploadId: row.hero_background_upload_id,
            logoUploadId: row.hero_logo_upload_id,
            eyebrow: row.hero_eyebrow ?? '',
            title: row.hero_title ?? '',
            tagline: row.hero_tagline ?? '',
            rss: row.news_rss ?? ''
        },
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
        size: row.size == null ? null : Number(row.size),
        md5: row.md5,
        sha256: row.sha256,
        createdAt: row.created_at,
        updatedAt: row.updated_at
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

async function lockServer(connection: PoolConnection, projectId: string, serverId: string): Promise<ServerRow> {
    const [rows] = await connection.query<ServerRow[]>(
        'SELECT * FROM servers WHERE id = ? AND project_id = ? FOR UPDATE',
        [serverId, projectId]
    )
    const server = rows[0]
    if (!server) {
        throw new HttpError(404, 'Server not found')
    }
    return server
}

async function bumpProject(connection: PoolConnection, projectId: string): Promise<void> {
    await connection.execute(
        'UPDATE projects SET draft_revision = draft_revision + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?',
        [projectId]
    )
}

function fixedDestinationKey(type: ModuleType, optionalMode: OptionalMode, fileName: string): string {
    return managedPathKey(`${type}:${type === 'Library' ? 'REQUIRED' : optionalMode}:${fileName}`)
}

async function assertFixedDestinationAvailable(
    connection: PoolConnection,
    serverId: string,
    type: ModuleType,
    optionalMode: OptionalMode,
    fileName: string,
    excludeModuleId: string
): Promise<void> {
    if (type === 'File') {
        return
    }
    const [rows] = await connection.query<ModuleRow[]>(
        `SELECT m.*, u.original_name, u.size, u.md5, u.sha256
         FROM modules m LEFT JOIN uploads u ON u.id = m.upload_id
         WHERE m.server_id = ? AND m.id <> ?`,
        [serverId, excludeModuleId]
    )
    const destination = fixedDestinationKey(type, optionalMode, fileName)
    if (rows.some(row => {
        const existingName = row.file_name ?? row.original_name
        return row.type === type
            && existingName != null
            && fixedDestinationKey(row.type, row.optional_mode, existingName) === destination
    })) {
        throw new HttpError(409, 'Module path already exists')
    }
}

function fileNameFromPath(path: string): string {
    return path.split('/').at(-1)!
}

function directoryParent(path: string): string {
    return path.split('/').slice(0, -1).join('/')
}

export async function registerServerManagementRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/v1/projects/:projectId/servers/:serverId', {
        preHandler: requireRole('ADMIN', 'EDITOR', 'AUDITOR')
    }, async request => {
        const { projectId, serverId } = request.params as { projectId: string, serverId: string }
        const [projectRows] = await getPool().execute<ProjectRow[]>(
            'SELECT * FROM projects WHERE id = ? AND disabled = FALSE',
            [projectId]
        )
        const project = projectRows[0]
        if (!project) {
            throw new HttpError(404, 'Project not found')
        }
        const [serverRows] = await getPool().execute<ServerRow[]>(
            'SELECT * FROM servers WHERE id = ? AND project_id = ?',
            [serverId, projectId]
        )
        const server = serverRows[0]
        if (!server) {
            throw new HttpError(404, 'Server not found')
        }
        const [moduleRows] = await getPool().execute<ModuleRow[]>(
            `SELECT m.*, u.original_name, u.size, u.md5, u.sha256
             FROM modules m LEFT JOIN uploads u ON u.id = m.upload_id
             WHERE m.server_id = ? AND m.project_id = ?
             ORDER BY m.sort_order, m.display_name`,
            [serverId, projectId]
        )
        const [directoryRows] = await getPool().execute<DirectoryRow[]>(
            'SELECT * FROM server_directories WHERE server_id = ? AND project_id = ? ORDER BY path',
            [serverId, projectId]
        )
        const [ruleRows] = await getPool().execute<(RowDataPacket & {
            id: string
            applies_to: string
            pattern: string
        })[]>(
            'SELECT id, applies_to, pattern FROM untracked_rules WHERE server_id = ? ORDER BY applies_to, pattern',
            [serverId]
        )
        return {
            project: mapProject(project),
            server: {
                ...mapServer(server),
                modules: moduleRows.map(mapModule),
                untrackedRules: ruleRows.map(rule => ({
                    id: rule.id,
                    appliesTo: rule.applies_to,
                    pattern: rule.pattern
                }))
            },
            directories: directoryRows.map(row => ({
                id: row.id,
                path: row.path,
                createdAt: row.created_at,
                updatedAt: row.updated_at
            }))
        }
    })

    app.post('/api/v1/projects/:projectId/servers/:serverId/directories', {
        preHandler: requireRole('ADMIN', 'EDITOR')
    }, async (request, reply) => {
        requireCsrf(request)
        const { projectId, serverId } = request.params as { projectId: string, serverId: string }
        const expectedRevision = getRevision(request)
        const parsed = directoryInputSchema.safeParse(request.body)
        if (!parsed.success) {
            throw new HttpError(400, 'Invalid directory', undefined, parsed.error.flatten())
        }
        const path = normalizeManagedPath(parsed.data.path)
        const id = randomUUID()
        await withTransaction(async connection => {
            await lockProject(connection, projectId, expectedRevision)
            await lockServer(connection, projectId, serverId)
            const [existing] = await connection.query<DirectoryRow[]>(
                'SELECT * FROM server_directories WHERE server_id = ? AND path_hash = ? FOR UPDATE',
                [serverId, managedPathHash(path)]
            )
            if (existing[0]) {
                throw new HttpError(409, 'Directory already exists')
            }
            const segments = path.split('/')
            for (let length = 1; length <= segments.length; length++) {
                const currentPath = segments.slice(0, length).join('/')
                const [fileRows] = await connection.query<RowDataPacket[]>(
                    `SELECT id FROM modules
                     WHERE server_id = ? AND type = 'File' AND LOWER(relative_path) = LOWER(?) LIMIT 1`,
                    [serverId, currentPath]
                )
                if (fileRows[0]) {
                    throw new HttpError(409, 'Path conflict', `A file already exists at ${currentPath}`)
                }
                const directoryId = currentPath === path ? id : randomUUID()
                const [result] = await connection.execute<ResultSetHeader>(
                    `INSERT IGNORE INTO server_directories
                        (id, project_id, server_id, path, path_hash, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
                    [directoryId, projectId, serverId, currentPath, managedPathHash(currentPath)]
                )
                if (currentPath === path && result.affectedRows === 0) {
                    throw new HttpError(409, 'Directory already exists')
                }
            }
            await bumpProject(connection, projectId)
            await writeAudit(connection, auditContextFromRequest(request), {
                action: 'directory.created',
                entityType: 'directory',
                entityId: id,
                projectId,
                after: { serverId, path }
            })
        })
        return reply.status(201).send({ id, path, draftRevision: expectedRevision + 1 })
    })

    app.patch('/api/v1/projects/:projectId/servers/:serverId/directories/:directoryId', {
        preHandler: requireRole('ADMIN', 'EDITOR')
    }, async request => {
        requireCsrf(request)
        const { projectId, serverId, directoryId } = request.params as {
            projectId: string
            serverId: string
            directoryId: string
        }
        const expectedRevision = getRevision(request)
        const parsed = directoryInputSchema.safeParse(request.body)
        if (!parsed.success) {
            throw new HttpError(400, 'Invalid directory', undefined, parsed.error.flatten())
        }
        const target = normalizeManagedPath(parsed.data.path)
        let source = ''
        await withTransaction(async connection => {
            await lockProject(connection, projectId, expectedRevision)
            await lockServer(connection, projectId, serverId)
            const [directories] = await connection.query<DirectoryRow[]>(
                'SELECT * FROM server_directories WHERE server_id = ? AND project_id = ? FOR UPDATE',
                [serverId, projectId]
            )
            const current = directories.find(row => row.id === directoryId)
            if (!current) {
                throw new HttpError(404, 'Directory not found')
            }
            source = current.path
            if (source === target) {
                throw new HttpError(400, 'Directory path is unchanged')
            }
            if (isPathWithin(target, source)) {
                throw new HttpError(409, 'Invalid directory move', 'A directory cannot be moved inside itself')
            }
            const parent = directoryParent(target)
            if (parent && !directories.some(row => managedPathKey(row.path) === managedPathKey(parent))) {
                throw new HttpError(409, 'Parent directory not found')
            }
            const [files] = await connection.query<ModuleRow[]>(
                `SELECT m.*, u.original_name, u.size, u.md5, u.sha256
                 FROM modules m LEFT JOIN uploads u ON u.id = m.upload_id
                 WHERE m.server_id = ? AND m.project_id = ? AND m.type = 'File' FOR UPDATE`,
                [serverId, projectId]
            )
            const movedDirectories = directories
                .filter(row => isPathWithin(row.path, source))
                .map(row => ({ row, nextPath: replacePathPrefix(row.path, source, target) }))
            const movedFiles = files
                .filter(row => row.relative_path != null && isPathWithin(row.relative_path, source))
                .map(row => ({ row, nextPath: replacePathPrefix(row.relative_path!, source, target) }))
            const movedDirectoryIds = new Set(movedDirectories.map(value => value.row.id))
            const movedFileIds = new Set(movedFiles.map(value => value.row.id))
            const directoryKeys = new Set(
                directories.filter(row => !movedDirectoryIds.has(row.id)).map(row => managedPathKey(row.path))
            )
            const fileKeys = new Set(
                files
                    .filter(row => !movedFileIds.has(row.id) && row.relative_path != null)
                    .map(row => managedPathKey(row.relative_path!))
            )
            for (const value of movedDirectories) {
                const key = managedPathKey(value.nextPath)
                if (directoryKeys.has(key) || fileKeys.has(key)) {
                    throw new HttpError(409, 'Path conflict', `The target path ${value.nextPath} already exists`)
                }
                directoryKeys.add(key)
            }
            for (const value of movedFiles) {
                const key = managedPathKey(value.nextPath)
                if (directoryKeys.has(key) || fileKeys.has(key)) {
                    throw new HttpError(409, 'Path conflict', `The target path ${value.nextPath} already exists`)
                }
                fileKeys.add(key)
            }
            for (const value of movedDirectories) {
                await connection.execute(
                    `UPDATE server_directories SET path = ?, path_hash = ?, updated_at = UTC_TIMESTAMP(3)
                     WHERE id = ?`,
                    [value.nextPath, managedPathHash(value.nextPath), value.row.id]
                )
            }
            for (const value of movedFiles) {
                await connection.execute(
                    `UPDATE modules SET relative_path = ?, file_name = ?, updated_at = UTC_TIMESTAMP(3)
                     WHERE id = ?`,
                    [value.nextPath, fileNameFromPath(value.nextPath), value.row.id]
                )
            }
            await bumpProject(connection, projectId)
            await writeAudit(connection, auditContextFromRequest(request), {
                action: 'directory.moved',
                entityType: 'directory',
                entityId: directoryId,
                projectId,
                before: {
                    path: source,
                    directories: movedDirectories.map(value => value.row.path),
                    modules: movedFiles.map(value => mapModule(value.row))
                },
                after: {
                    path: target,
                    directoryCount: movedDirectories.length,
                    moduleCount: movedFiles.length
                }
            })
        })
        return { updated: true, path: target, previousPath: source, draftRevision: expectedRevision + 1 }
    })

    app.delete('/api/v1/projects/:projectId/servers/:serverId/directories/:directoryId', {
        preHandler: requireRole('ADMIN', 'EDITOR')
    }, async request => {
        requireCsrf(request)
        const { projectId, serverId, directoryId } = request.params as {
            projectId: string
            serverId: string
            directoryId: string
        }
        const expectedRevision = getRevision(request)
        const parsed = directoryDeleteSchema.safeParse(request.body)
        if (!parsed.success) {
            throw new HttpError(400, 'Recursive confirmation required', undefined, parsed.error.flatten())
        }
        let deletedDirectories = 0
        let deletedModules = 0
        await withTransaction(async connection => {
            await lockProject(connection, projectId, expectedRevision)
            await lockServer(connection, projectId, serverId)
            const [directories] = await connection.query<DirectoryRow[]>(
                'SELECT * FROM server_directories WHERE server_id = ? AND project_id = ? FOR UPDATE',
                [serverId, projectId]
            )
            const current = directories.find(row => row.id === directoryId)
            if (!current) {
                throw new HttpError(404, 'Directory not found')
            }
            const [files] = await connection.query<ModuleRow[]>(
                `SELECT m.*, u.original_name, u.size, u.md5, u.sha256
                 FROM modules m LEFT JOIN uploads u ON u.id = m.upload_id
                 WHERE m.server_id = ? AND m.project_id = ? AND m.type = 'File' FOR UPDATE`,
                [serverId, projectId]
            )
            const subtree = directories
                .filter(row => isPathWithin(row.path, current.path))
                .sort((left, right) => right.path.length - left.path.length)
            const modules = files.filter(row => row.relative_path != null && isPathWithin(row.relative_path, current.path))
            for (const module of modules) {
                await connection.execute('DELETE FROM modules WHERE id = ?', [module.id])
            }
            for (const directory of subtree) {
                await connection.execute('DELETE FROM server_directories WHERE id = ?', [directory.id])
            }
            deletedDirectories = subtree.length
            deletedModules = modules.length
            await bumpProject(connection, projectId)
            await writeAudit(connection, auditContextFromRequest(request), {
                action: 'directory.deleted',
                entityType: 'directory',
                entityId: directoryId,
                projectId,
                before: {
                    path: current.path,
                    directories: subtree.map(row => row.path),
                    modules: modules.map(mapModule)
                },
                after: { deletedDirectories, deletedModules }
            })
        })
        return { deleted: true, deletedDirectories, deletedModules, draftRevision: expectedRevision + 1 }
    })

    app.patch('/api/v1/projects/:projectId/servers/:serverId/modules/:moduleRecordId', {
        preHandler: requireRole('ADMIN', 'EDITOR')
    }, async request => {
        requireCsrf(request)
        const { projectId, serverId, moduleRecordId } = request.params as {
            projectId: string
            serverId: string
            moduleRecordId: string
        }
        const expectedRevision = getRevision(request)
        const parsed = modulePatchSchema.safeParse(request.body)
        if (!parsed.success) {
            throw new HttpError(400, 'Invalid module update', undefined, parsed.error.flatten())
        }
        await withTransaction(async connection => {
            await lockProject(connection, projectId, expectedRevision)
            await lockServer(connection, projectId, serverId)
            const [rows] = await connection.query<ModuleRow[]>(
                `SELECT m.*, u.original_name, u.size, u.md5, u.sha256
                 FROM modules m LEFT JOIN uploads u ON u.id = m.upload_id
                 WHERE m.id = ? AND m.server_id = ? AND m.project_id = ? FOR UPDATE`,
                [moduleRecordId, serverId, projectId]
            )
            const before = rows[0]
            if (!before) {
                throw new HttpError(404, 'Module not found')
            }
            let relativePath = before.relative_path
            let fileName = before.file_name ?? before.original_name ?? before.display_name
            const optionalMode = parsed.data.optionalMode ?? before.optional_mode
            if ((before.type === 'File' || before.type === 'Library') && optionalMode !== 'REQUIRED') {
                throw new HttpError(400, 'Only mod modules may be optional')
            }
            if (before.type === 'File') {
                relativePath = normalizeManagedPath(parsed.data.relativePath ?? relativePath ?? '')
                if (parsed.data.fileName) {
                    const renamed = normalizeManagedFileName(parsed.data.fileName)
                    const parent = directoryParent(relativePath)
                    relativePath = parent ? `${parent}/${renamed}` : renamed
                }
                fileName = fileNameFromPath(relativePath)
                await assertFileDestinationAvailable(connection, serverId, relativePath, moduleRecordId)
                await ensureFileParentDirectories(connection, projectId, serverId, relativePath)
            } else {
                if (parsed.data.relativePath != null) {
                    throw new HttpError(400, 'Only File modules have a relative path')
                }
                fileName = normalizeManagedFileName(parsed.data.fileName ?? fileName)
                await assertFixedDestinationAvailable(
                    connection,
                    serverId,
                    before.type,
                    optionalMode,
                    fileName,
                    moduleRecordId
                )
            }
            await connection.execute(
                `UPDATE modules SET display_name = ?, file_name = ?, module_id = ?, relative_path = ?,
                 optional_mode = ?, sort_order = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
                [
                    parsed.data.displayName ?? before.display_name,
                    fileName,
                    parsed.data.moduleId === undefined ? before.module_id : parsed.data.moduleId,
                    relativePath,
                    optionalMode,
                    parsed.data.sortOrder ?? before.sort_order,
                    moduleRecordId
                ]
            )
            await bumpProject(connection, projectId)
            await writeAudit(connection, auditContextFromRequest(request), {
                action: 'module.metadata_updated',
                entityType: 'module',
                entityId: moduleRecordId,
                projectId,
                before: mapModule(before),
                after: { ...parsed.data, fileName, relativePath, optionalMode }
            })
        })
        return { updated: true, draftRevision: expectedRevision + 1 }
    })

    app.post('/api/v1/projects/:projectId/servers/:serverId/modules/:moduleRecordId/replace', {
        preHandler: requireRole('ADMIN', 'EDITOR')
    }, async request => {
        requireCsrf(request)
        const { projectId, serverId, moduleRecordId } = request.params as {
            projectId: string
            serverId: string
            moduleRecordId: string
        }
        const expectedRevision = getRevision(request)
        const parsed = moduleReplaceSchema.safeParse(request.body)
        if (!parsed.success) {
            throw new HttpError(400, 'Invalid replacement', undefined, parsed.error.flatten())
        }
        await withTransaction(async connection => {
            await lockProject(connection, projectId, expectedRevision)
            await lockServer(connection, projectId, serverId)
            const [rows] = await connection.query<ModuleRow[]>(
                `SELECT m.*, u.original_name, u.size, u.md5, u.sha256
                 FROM modules m LEFT JOIN uploads u ON u.id = m.upload_id
                 WHERE m.id = ? AND m.server_id = ? AND m.project_id = ? FOR UPDATE`,
                [moduleRecordId, serverId, projectId]
            )
            const before = rows[0]
            if (!before) {
                throw new HttpError(404, 'Module not found')
            }
            const [uploads] = await connection.query<(RowDataPacket & {
                id: string
                original_name: string
                size: number
                md5: string
                sha256: string
            })[]>(
                `SELECT id, original_name, size, md5, sha256 FROM uploads
                 WHERE id = ? AND project_id = ? AND status = 'READY'`,
                [parsed.data.uploadId, projectId]
            )
            const upload = uploads[0]
            if (!upload) {
                throw new HttpError(404, 'Upload not found')
            }
            let fileName = before.file_name
            if (!fileName) {
                fileName = before.type === 'File' && before.relative_path
                    ? fileNameFromPath(before.relative_path)
                    : normalizeManagedFileName(upload.original_name)
            }
            if (before.type !== 'File') {
                await assertFixedDestinationAvailable(
                    connection,
                    serverId,
                    before.type,
                    before.optional_mode,
                    fileName,
                    moduleRecordId
                )
            }
            await connection.execute(
                `UPDATE modules SET upload_id = ?, file_name = ?, needs_manual_file = FALSE,
                 manual_url = NULL, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
                [upload.id, fileName, moduleRecordId]
            )
            await bumpProject(connection, projectId)
            await writeAudit(connection, auditContextFromRequest(request), {
                action: 'module.file_replaced',
                entityType: 'module',
                entityId: moduleRecordId,
                projectId,
                before: mapModule(before),
                after: {
                    uploadId: upload.id,
                    fileName,
                    size: Number(upload.size),
                    md5: upload.md5,
                    sha256: upload.sha256
                }
            })
        })
        return { updated: true, draftRevision: expectedRevision + 1 }
    })
}
