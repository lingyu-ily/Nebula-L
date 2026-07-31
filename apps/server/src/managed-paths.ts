import { createHash, randomUUID } from 'crypto'
import { isSafeFileName, isSafeRelativePath } from '@nebula/shared'
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import { HttpError } from './http.js'

export function normalizeManagedPath(candidate: string): string {
    const normalized = candidate.normalize('NFC')
    if (!isSafeRelativePath(normalized)) {
        throw new HttpError(400, 'Invalid path', 'A safe relative POSIX path is required')
    }
    return normalized
}

export function normalizeManagedFileName(candidate: string): string {
    const normalized = candidate.normalize('NFC')
    if (!isSafeFileName(normalized)) {
        throw new HttpError(400, 'Invalid file name', 'File names cannot contain path separators or control characters')
    }
    return normalized
}

export function managedPathHash(path: string): string {
    return createHash('sha256').update(path.toLowerCase()).digest('hex')
}

export function managedPathKey(path: string): string {
    return path.normalize('NFC').toLowerCase()
}

export function parentDirectoryPaths(filePath: string): string[] {
    const segments = normalizeManagedPath(filePath).split('/').slice(0, -1)
    return segments.map((_segment, index) => segments.slice(0, index + 1).join('/'))
}

export function isPathWithin(candidate: string, parent: string): boolean {
    const candidateKey = managedPathKey(candidate)
    const parentKey = managedPathKey(parent)
    return candidateKey === parentKey || candidateKey.startsWith(`${parentKey}/`)
}

export function replacePathPrefix(candidate: string, source: string, target: string): string {
    if (!isPathWithin(candidate, source)) {
        return candidate
    }
    return `${target}${candidate.slice(source.length)}`.normalize('NFC')
}

export async function ensureFileParentDirectories(
    connection: PoolConnection,
    projectId: string,
    serverId: string,
    filePath: string
): Promise<void> {
    for (const path of parentDirectoryPaths(filePath)) {
        const [fileRows] = await connection.query<RowDataPacket[]>(
            `SELECT id FROM modules
             WHERE server_id = ? AND type = 'File' AND LOWER(relative_path) = LOWER(?) LIMIT 1`,
            [serverId, path]
        )
        if (fileRows[0]) {
            throw new HttpError(409, 'Path conflict', `A file already exists at ${path}`)
        }
        await connection.execute(
            `INSERT IGNORE INTO server_directories
                (id, project_id, server_id, path, path_hash, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
            [randomUUID(), projectId, serverId, path, managedPathHash(path)]
        )
    }
}

export async function assertFileDestinationAvailable(
    connection: PoolConnection,
    serverId: string,
    filePath: string,
    excludeModuleId?: string
): Promise<void> {
    const normalized = normalizeManagedPath(filePath)
    const [moduleRows] = await connection.query<RowDataPacket[]>(
        `SELECT id FROM modules
         WHERE server_id = ? AND type = 'File' AND LOWER(relative_path) = LOWER(?)
         ${excludeModuleId ? 'AND id <> ?' : ''} LIMIT 1`,
        excludeModuleId ? [serverId, normalized, excludeModuleId] : [serverId, normalized]
    )
    if (moduleRows[0]) {
        throw new HttpError(409, 'Path conflict', `A file already exists at ${normalized}`)
    }
    const [directoryRows] = await connection.query<RowDataPacket[]>(
        'SELECT id FROM server_directories WHERE server_id = ? AND path_hash = ? LIMIT 1',
        [serverId, managedPathHash(normalized)]
    )
    if (directoryRows[0]) {
        throw new HttpError(409, 'Path conflict', `A directory already exists at ${normalized}`)
    }
}
