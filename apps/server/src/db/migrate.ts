import { readFile } from 'fs/promises'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { getPool } from './index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

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
        const migrations = ['0001_initial.sql']
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
