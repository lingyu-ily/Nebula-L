import type { PoolConnection, RowDataPacket } from 'mysql2/promise'

export const sharedServerColumns = [
    'name', 'description', 'icon_upload_id', 'hero_background_upload_id', 'hero_logo_upload_id',
    'hero_video_source', 'hero_video_upload_id', 'hero_video_url', 'hero_eyebrow', 'hero_title', 'hero_tagline', 'news_rss'
] as const

// Retain denormalized columns for the existing editing and upload APIs. The
// group is authoritative; every change is propagated under the project lock.
export async function createServerGroup(connection: PoolConnection, serverId: string): Promise<void> {
    await connection.execute(
        `INSERT INTO server_groups (id, project_id, default_version_id, sort_order, main_server, ${sharedServerColumns.join(', ')})
         SELECT id, project_id, id, sort_order, main_server, ${sharedServerColumns.join(', ')} FROM servers WHERE id = ?`, [serverId]
    )
    await connection.execute(
        `UPDATE servers SET group_id = id, version_name = server_version,
         distribution_id = CONCAT('version-', id) WHERE id = ?`, [serverId]
    )
    await connection.execute(
        `UPDATE server_groups g INNER JOIN servers s ON s.id = g.default_version_id
         SET g.main_server = s.main_server WHERE g.project_id = (SELECT project_id FROM servers WHERE id = ?)`, [serverId]
    )
}

export async function syncServerGroup(connection: PoolConnection, groupId: string | undefined): Promise<void> {
    if (!groupId) return // Old queued snapshots and pre-migration test fixtures.
    await connection.execute(
        `UPDATE servers s INNER JOIN server_groups g ON g.id = s.group_id AND g.project_id = s.project_id
         SET ${sharedServerColumns.map(column => `s.${column} = g.${column}`).join(', ')},
             s.main_server = (g.main_server AND s.id = g.default_version_id),
             s.revision = s.revision + 1, s.updated_at = UTC_TIMESTAMP(3)
         WHERE g.id = ? AND (${sharedServerColumns.map(column => `NOT (s.${column} <=> g.${column})`).join(' OR ')}
             OR s.main_server <> (g.main_server AND s.id = g.default_version_id))`, [groupId]
    )
}

export async function saveSharedVersionFields(connection: PoolConnection, serverId: string, groupId: string | undefined): Promise<void> {
    if (!groupId) return
    await connection.execute(
        `UPDATE server_groups g INNER JOIN servers s ON s.id = ? AND s.group_id = g.id
         SET ${sharedServerColumns.map(column => `g.${column} = s.${column}`).join(', ')}`, [serverId]
    )
    await connection.execute(
        `UPDATE server_groups g INNER JOIN servers s ON s.id = g.default_version_id
         SET g.main_server = s.main_server WHERE g.project_id = (SELECT project_id FROM servers WHERE id = ?)`, [serverId]
    )
    await syncServerGroup(connection, groupId)
}

export interface VersionRow extends RowDataPacket {
    id: string
    project_id: string
    group_id: string
    version_name: string
    enabled: number
    distribution_id: string
    server_key: string
    minecraft_version: string
    server_version: string
    forge_version: string | null
    fabric_version: string | null
    sort_order: number
}

export function mapVersion(row: VersionRow): Record<string, unknown> {
    return {
        id: row.id, groupId: row.group_id, versionName: row.version_name, enabled: Boolean(row.enabled),
        distributionId: row.distribution_id, minecraftVersion: row.minecraft_version,
        serverVersion: row.server_version, forgeVersion: row.forge_version, fabricVersion: row.fabric_version,
        sortOrder: row.sort_order
    }
}
