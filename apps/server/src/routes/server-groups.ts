import { randomUUID } from 'crypto'
import {
    serverGroupUpdateSchema, serverInputSchema, serverOrderInputSchema,
    serverVersionCreateSchema, serverVersionPatchSchema, versionDeleteSchema
} from '@nebula/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import { getPool, withTransaction } from '../db/index.js'
import { writeAudit } from '../audit.js'
import { HttpError, requireCsrf, requireRole } from '../http.js'
import { auditContextFromRequest } from '../types.js'
import { createServerGroup, mapVersion, sharedServerColumns, syncServerGroup, type VersionRow } from '../server-groups.js'

interface GroupRow extends RowDataPacket {
    id: string
    project_id: string
    name: string
    description: string
    main_server: number
    sort_order: number
    default_version_id: string
}

function mapGroup(group: GroupRow, versions: VersionRow[]): Record<string, unknown> {
    return {
        id: group.id, name: group.name, description: group.description,
        mainServer: Boolean(group.main_server), sortOrder: group.sort_order,
        defaultVersionId: group.default_version_id, versions: versions.map(mapVersion)
    }
}

async function lockProject(connection: PoolConnection, projectId: string, draftVersion: unknown): Promise<void> {
    if (!Number.isSafeInteger(draftVersion) || Number(draftVersion) < 0) throw new HttpError(400, 'Invalid draft version')
    const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT id, draft_revision FROM projects WHERE id = ? AND disabled = FALSE FOR UPDATE', [projectId]
    )
    if (!rows[0]) throw new HttpError(404, 'Project not found')
    if (Number(rows[0].draft_revision) !== draftVersion) throw new HttpError(409, 'Draft changed', 'Reload before saving')
}

async function lockGroup(connection: PoolConnection, projectId: string, groupId: string): Promise<GroupRow> {
    const [rows] = await connection.query<GroupRow[]>(
        'SELECT * FROM server_groups WHERE id = ? AND project_id = ? FOR UPDATE', [groupId, projectId]
    )
    if (!rows[0]) throw new HttpError(404, 'Server group not found')
    return rows[0]
}

async function finish(connection: PoolConnection, request: FastifyRequest, projectId: string, entityId: string, action: string, before: unknown, after?: unknown): Promise<void> {
    await connection.execute('UPDATE projects SET draft_revision = draft_revision + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?', [projectId])
    await writeAudit(connection, auditContextFromRequest(request), { projectId, entityId, entityType: 'server-version', action, before, after })
}

async function insertVersion(connection: PoolConnection, projectId: string, id: string, settings: Record<string, unknown>): Promise<void> {
    const columns = Object.keys(settings)
    try {
        await connection.execute(
            `INSERT INTO servers (id, project_id, ${columns.join(', ')}) VALUES (?, ?, ${columns.map(() => '?').join(', ')})`,
            [id, projectId, ...columns.map(column => {
                const value = settings[column]
                return value == null ? null : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : JSON.stringify(value)
            })]
        )
    } catch (error) {
        if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw new HttpError(409, 'Server ID already exists')
        throw error
    }
}

function versionSettings(server: ReturnType<typeof serverInputSchema.parse>): Record<string, unknown> {
    return {
        server_key: server.serverKey, name: server.name, description: server.description,
        minecraft_version: server.minecraftVersion, server_version: server.serverVersion,
        address: server.address, discord: JSON.stringify(server.discord ?? null), icon_upload_id: server.iconUploadId ?? null,
        forge_version: server.forgeVersion || null, fabric_version: server.fabricVersion || null,
        main_server: false, autoconnect: server.autoconnect, java_options: JSON.stringify(server.javaOptions ?? null),
        revision: 0, published_once: false
    }
}

export async function registerServerGroupRoutes(app: FastifyInstance): Promise<void> {
    const base = '/api/v1/projects/:projectId/server-groups'
    app.get(base, { preHandler: requireRole('ADMIN', 'EDITOR', 'AUDITOR') }, async request => {
        const { projectId } = request.params as { projectId: string }
        const [projects] = await getPool().execute<RowDataPacket[]>('SELECT id FROM projects WHERE id = ? AND disabled = FALSE', [projectId])
        if (!projects[0]) throw new HttpError(404, 'Project not found')
        const [groups] = await getPool().execute<GroupRow[]>('SELECT * FROM server_groups WHERE project_id = ? ORDER BY sort_order, id', [projectId])
        const [versions] = await getPool().execute<VersionRow[]>('SELECT * FROM servers WHERE project_id = ? ORDER BY sort_order, id', [projectId])
        return groups.map(group => mapGroup(group, versions.filter(version => version.group_id === group.id)))
    })

    app.post(base, { preHandler: requireRole('ADMIN', 'EDITOR') }, async (request, reply) => {
        requireCsrf(request)
        const { projectId } = request.params as { projectId: string }
        const body = (request.body ?? {}) as { draftVersion?: number }
        const parsed = serverInputSchema.safeParse(body)
        if (!parsed.success) throw new HttpError(400, 'Invalid server', undefined, parsed.error.flatten())
        const id = randomUUID()
        await withTransaction(async connection => {
            await lockProject(connection, projectId, body.draftVersion)
            if (parsed.data.iconUploadId) {
                const [uploads] = await connection.query<RowDataPacket[]>(
                    `SELECT id FROM uploads WHERE id = ? AND project_id = ? AND status = 'READY'
                     AND mime_type IN ('image/png', 'image/jpeg', 'image/webp') FOR UPDATE`, [parsed.data.iconUploadId, projectId]
                )
                if (!uploads[0]) throw new HttpError(400, 'Invalid server icon')
            }
            if (parsed.data.mainServer) {
                await connection.execute('UPDATE server_groups SET main_server = FALSE WHERE project_id = ?', [projectId])
                await connection.execute('UPDATE servers SET main_server = FALSE WHERE project_id = ?', [projectId])
            }
            await insertVersion(connection, projectId, id, { ...versionSettings(parsed.data), main_server: parsed.data.mainServer, sort_order: parsed.data.sortOrder })
            await createServerGroup(connection, id)
            for (const rule of parsed.data.untrackedRules) {
                await connection.execute('INSERT INTO untracked_rules (id, server_id, applies_to, pattern) VALUES (?, ?, ?, ?)', [randomUUID(), id, rule.appliesTo, rule.pattern])
            }
            await finish(connection, request, projectId, id, 'server-group.created', null, parsed.data)
        })
        return reply.status(201).send({ id, versionId: id, draftVersion: Number(body.draftVersion) + 1 })
    })

    app.put(`${base}/order`, { preHandler: requireRole('ADMIN', 'EDITOR') }, async request => {
        requireCsrf(request)
        const { projectId } = request.params as { projectId: string }
        const parsed = serverOrderInputSchema.safeParse(request.body)
        const draftVersion = (request.body as { draftVersion?: number } | undefined)?.draftVersion
        if (!parsed.success) throw new HttpError(400, 'Invalid group order')
        await withTransaction(async connection => {
            await lockProject(connection, projectId, draftVersion)
            const [groups] = await connection.query<GroupRow[]>('SELECT * FROM server_groups WHERE project_id = ? FOR UPDATE', [projectId])
            if (groups.length !== parsed.data.serverIds.length || groups.some(group => !parsed.data.serverIds.includes(group.id))) throw new HttpError(400, 'Order must contain every group')
            for (const [position, id] of parsed.data.serverIds.entries()) {
                await connection.execute('UPDATE server_groups SET sort_order = ? WHERE id = ? AND project_id = ?', [position, id, projectId])
            }
            await finish(connection, request, projectId, projectId, 'server-groups.reordered', groups.map(group => group.id), parsed.data.serverIds)
        })
        return { updated: true, draftVersion: Number(draftVersion) + 1 }
    })

    app.put(`${base}/:groupId`, { preHandler: requireRole('ADMIN', 'EDITOR') }, async request => {
        requireCsrf(request)
        const { projectId, groupId } = request.params as { projectId: string, groupId: string }
        const parsed = serverGroupUpdateSchema.safeParse(request.body)
        if (!parsed.success) throw new HttpError(400, 'Invalid group', undefined, parsed.error.flatten())
        await withTransaction(async connection => {
            await lockProject(connection, projectId, parsed.data.draftVersion)
            const group = await lockGroup(connection, projectId, groupId)
            const [versions] = await connection.query<VersionRow[]>('SELECT * FROM servers WHERE group_id = ? AND project_id = ? FOR UPDATE', [groupId, projectId])
            if (!versions.some(version => version.id === parsed.data.defaultVersionId && version.enabled)) throw new HttpError(409, 'Default version must be enabled and belong to this server')
            if (parsed.data.mainServer) {
                await connection.execute('UPDATE server_groups SET main_server = FALSE WHERE project_id = ?', [projectId])
                await connection.execute('UPDATE servers SET main_server = FALSE WHERE project_id = ?', [projectId])
            }
            await connection.execute('UPDATE server_groups SET name = ?, description = ?, main_server = ?, default_version_id = ? WHERE id = ? AND project_id = ?',
                [parsed.data.name, parsed.data.description, parsed.data.mainServer, parsed.data.defaultVersionId, groupId, projectId])
            await syncServerGroup(connection, groupId)
            await finish(connection, request, projectId, groupId, 'server-group.updated', group, parsed.data)
        })
        return { updated: true, draftVersion: parsed.data.draftVersion + 1 }
    })

    app.delete(`${base}/:groupId`, { preHandler: requireRole('ADMIN', 'EDITOR') }, async request => {
        requireCsrf(request)
        const { projectId, groupId } = request.params as { projectId: string, groupId: string }
        const parsed = versionDeleteSchema.safeParse(request.body)
        if (!parsed.success) throw new HttpError(400, 'Invalid deletion request')
        await withTransaction(async connection => {
            await lockProject(connection, projectId, parsed.data.draftVersion)
            const group = await lockGroup(connection, projectId, groupId)
            if (parsed.data.confirmName !== group.name) throw new HttpError(400, 'Server name does not match')
            await connection.execute('DELETE FROM servers WHERE group_id = ? AND project_id = ?', [groupId, projectId])
            await connection.execute('DELETE FROM server_groups WHERE id = ? AND project_id = ?', [groupId, projectId])
            await finish(connection, request, projectId, groupId, 'server-group.deleted', group)
        })
        return { deleted: true, draftVersion: parsed.data.draftVersion + 1 }
    })

    app.post(`${base}/:groupId/versions`, { preHandler: requireRole('ADMIN', 'EDITOR') }, async (request, reply) => {
        requireCsrf(request)
        const { projectId, groupId } = request.params as { projectId: string, groupId: string }
        const parsed = serverVersionCreateSchema.safeParse(request.body)
        if (!parsed.success) throw new HttpError(400, 'Invalid version', undefined, parsed.error.flatten())
        const id = randomUUID()
        await withTransaction(async connection => {
            await lockProject(connection, projectId, parsed.data.draftVersion)
            const group = await lockGroup(connection, projectId, groupId)
            const [versions] = await connection.query<VersionRow[]>('SELECT * FROM servers WHERE group_id = ? AND project_id = ? FOR UPDATE', [groupId, projectId])
            const source = versions.find(version => version.id === parsed.data.sourceVersionId)
            if (parsed.data.sourceVersionId && !source) throw new HttpError(404, 'Source version not found')
            const sourceFields: Record<string, unknown> = source ? Object.fromEntries([
                ...sharedServerColumns, 'minecraft_version', 'server_version', 'address', 'discord',
                'forge_version', 'fabric_version', 'autoconnect', 'java_options'
            ].map(column => [column, ['discord', 'java_options'].includes(column) && typeof source[column] !== 'string' ? JSON.stringify(source[column]) : source[column]])) : versionSettings(parsed.data.server!)
            for (const column of sharedServerColumns) sourceFields[column] = group[column]
            await insertVersion(connection, projectId, id, {
                ...sourceFields, server_key: `v-${id}`, group_id: groupId, distribution_id: `version-${id}`,
                version_name: parsed.data.versionName, enabled: true, main_server: false,
                sort_order: Math.max(-1, ...versions.map(version => version.sort_order)) + 1, revision: 0, published_once: false
            })
            if (source) {
                await connection.execute(`INSERT INTO modules (id, project_id, server_id, upload_id, type, display_name, file_name, module_id, relative_path, optional_mode, sort_order, validate_checksum, needs_manual_file, manual_url)
                    SELECT UUID(), project_id, ?, upload_id, type, display_name, file_name, module_id, relative_path, optional_mode, sort_order, validate_checksum, needs_manual_file, manual_url FROM modules WHERE server_id = ? AND project_id = ?`, [id, source.id, projectId])
                await connection.execute(`INSERT INTO server_directories (id, project_id, server_id, path, path_hash)
                    SELECT UUID(), project_id, ?, path, path_hash FROM server_directories WHERE server_id = ? AND project_id = ?`, [id, source.id, projectId])
                await connection.execute(`INSERT INTO untracked_rules (id, server_id, applies_to, pattern)
                    SELECT UUID(), ?, applies_to, pattern FROM untracked_rules WHERE server_id = ?`, [id, source.id])
            } else {
                for (const rule of parsed.data.server!.untrackedRules) {
                    await connection.execute('INSERT INTO untracked_rules (id, server_id, applies_to, pattern) VALUES (?, ?, ?, ?)', [randomUUID(), id, rule.appliesTo, rule.pattern])
                }
            }
            await syncServerGroup(connection, group.id)
            await finish(connection, request, projectId, id, source ? 'server-version.cloned' : 'server-version.created', null, { groupId, ...parsed.data })
        })
        return reply.status(201).send({ id, draftVersion: parsed.data.draftVersion + 1 })
    })

    app.put(`${base}/:groupId/versions/order`, { preHandler: requireRole('ADMIN', 'EDITOR') }, async request => {
        requireCsrf(request)
        const { projectId, groupId } = request.params as { projectId: string, groupId: string }
        const parsed = serverOrderInputSchema.safeParse(request.body)
        const draftVersion = (request.body as { draftVersion?: number } | undefined)?.draftVersion
        if (!parsed.success) throw new HttpError(400, 'Invalid version order')
        await withTransaction(async connection => {
            await lockProject(connection, projectId, draftVersion)
            await lockGroup(connection, projectId, groupId)
            const [versions] = await connection.query<VersionRow[]>('SELECT * FROM servers WHERE group_id = ? AND project_id = ? FOR UPDATE', [groupId, projectId])
            if (versions.length !== parsed.data.serverIds.length || versions.some(version => !parsed.data.serverIds.includes(version.id))) throw new HttpError(400, 'Order must contain every version')
            for (const [position, id] of parsed.data.serverIds.entries()) {
                await connection.execute('UPDATE servers SET sort_order = ? WHERE id = ? AND group_id = ? AND project_id = ?', [position, id, groupId, projectId])
            }
            await finish(connection, request, projectId, groupId, 'server-versions.reordered', versions.map(version => version.id), parsed.data.serverIds)
        })
        return { updated: true, draftVersion: Number(draftVersion) + 1 }
    })

    for (const method of ['PATCH', 'DELETE'] as const) {
        app.route({ method, url: `${base}/:groupId/versions/:versionId`, preHandler: requireRole('ADMIN', 'EDITOR'), handler: async request => {
            requireCsrf(request)
            const { projectId, groupId, versionId } = request.params as { projectId: string, groupId: string, versionId: string }
            const patch = serverVersionPatchSchema.safeParse(request.body)
            const deletion = versionDeleteSchema.safeParse(request.body)
            if (method === 'PATCH' ? !patch.success : !deletion.success) throw new HttpError(400, 'Invalid version request')
            const draftVersion = (request.body as { draftVersion: number }).draftVersion
            await withTransaction(async connection => {
                await lockProject(connection, projectId, draftVersion)
                const group = await lockGroup(connection, projectId, groupId)
                const [versions] = await connection.query<VersionRow[]>('SELECT * FROM servers WHERE group_id = ? AND project_id = ? FOR UPDATE', [groupId, projectId])
                const version = versions.find(candidate => candidate.id === versionId)
                if (!version) throw new HttpError(404, 'Version not found')
                if (method === 'DELETE') {
                    if (versions.length === 1) throw new HttpError(409, 'Cannot delete the last version')
                    if (versionId === group.default_version_id) throw new HttpError(409, 'Choose another default version first')
                    if (deletion.data!.confirmName !== version.version_name) throw new HttpError(400, 'Version name does not match')
                    await connection.execute('DELETE FROM servers WHERE id = ? AND group_id = ? AND project_id = ?', [versionId, groupId, projectId])
                } else {
                    if (patch.data!.enabled === false && group.default_version_id === versionId) throw new HttpError(409, 'Choose another default version first')
                    await connection.execute('UPDATE servers SET version_name = ?, enabled = ?, revision = revision + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ? AND group_id = ? AND project_id = ?',
                        [patch.data!.versionName ?? version.version_name, patch.data!.enabled ?? Boolean(version.enabled), versionId, groupId, projectId])
                }
                await finish(connection, request, projectId, versionId, method === 'DELETE' ? 'server-version.deleted' : 'server-version.updated', mapVersion(version), method === 'PATCH' ? patch.data : null)
            })
            return { updated: true, draftVersion: draftVersion + 1 }
        } })
    }
}
