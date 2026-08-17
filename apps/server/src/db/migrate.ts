import { createHash, randomUUID } from 'crypto'
import { readFile } from 'fs/promises'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { isSafeRelativePath } from '@nebula/shared'
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import { getPool } from './index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface ExistingFileRow extends RowDataPacket {
    project_id: string
    server_id: string
    relative_path: string
}

function pathHash(path: string): string {
    return createHash('sha256').update(path.toLowerCase()).digest('hex')
}

async function backfillServerDirectories(connection: PoolConnection): Promise<void> {
    const [files] = await connection.query<ExistingFileRow[]>(
        `SELECT project_id, server_id, relative_path
         FROM modules WHERE type = 'File' AND relative_path IS NOT NULL`
    )
    const seen = new Set<string>()
    for (const file of files) {
        const normalized = file.relative_path.normalize('NFC')
        if (!isSafeRelativePath(normalized)) {
            continue
        }
        const segments = normalized.split('/').slice(0, -1)
        for (let length = 1; length <= segments.length; length++) {
            const path = segments.slice(0, length).join('/')
            const key = `${file.server_id}:${path.toLowerCase()}`
            if (seen.has(key)) {
                continue
            }
            seen.add(key)
            await connection.execute(
                `INSERT IGNORE INTO server_directories
                    (id, project_id, server_id, path, path_hash, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
                [randomUUID(), file.project_id, file.server_id, path, pathHash(path)]
            )
        }
    }
}

export async function migrateDatabase(): Promise<void> {
    const connection = await getPool().getConnection()
    try {
        const [lockRows] = await connection.query('SELECT GET_LOCK(?, 30) AS acquired', ['nebula_schema_migration'])
        const acquired = (lockRows as { acquired: number }[])[0]?.acquired
        if (acquired !== 1) {
            throw new Error('Could not acquire MariaDB migration lock')
        }
        await connection.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version VARCHAR(64) PRIMARY KEY,
                applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
            ) ENGINE=InnoDB
        `)
        const migrations = ['0001_initial.sql', '0002_server_file_manager.sql', '0003_launcher_ui.sql']
        for (const migration of migrations) {
            const [existing] = await connection.execute(
                'SELECT version FROM schema_migrations WHERE version = ?',
                [migration]
            )
            if ((existing as unknown[]).length > 0) {
                continue
            }
            const sql = await readFile(resolve(__dirname, '..', '..', 'migrations', migration), 'utf8')
            await connection.beginTransaction()
            try {
                for (const statement of sql.split('-- statement-breakpoint').map(value => value.trim()).filter(Boolean)) {
                    await connection.query(statement)
                }
                if (migration === '0002_server_file_manager.sql') {
                    await backfillServerDirectories(connection)
                }
                await connection.execute('INSERT INTO schema_migrations (version) VALUES (?)', [migration])
                await connection.commit()
            } catch (error) {
                await connection.rollback()
                throw error
            }
        }
    } finally {
        await connection.query('SELECT RELEASE_LOCK(?)', ['nebula_schema_migration']).catch(() => undefined)
        connection.release()
    }
}
