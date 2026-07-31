import mysql, { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import { getConfig } from '../config.js'

let pool: Pool | undefined

export function getPool(): Pool {
    if (!pool) {
        pool = mysql.createPool({
            uri: getConfig().databaseUrl,
            connectionLimit: 10,
            timezone: 'Z',
            decimalNumbers: true,
            enableKeepAlive: true
        })
    }
    return pool
}

export async function withTransaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await getPool().getConnection()
    try {
        await connection.beginTransaction()
        const result = await work(connection)
        await connection.commit()
        return result
    } catch (error) {
        await connection.rollback()
        throw error
    } finally {
        connection.release()
    }
}

type SqlValue = string | number | boolean | Date | Buffer | null

export async function queryOne<T extends RowDataPacket>(sql: string, values: SqlValue[] = []): Promise<T | undefined> {
    const [rows] = await getPool().execute<T[]>(sql, values)
    return rows[0]
}

export async function closeDatabase(): Promise<void> {
    if (pool) {
        await pool.end()
        pool = undefined
    }
}
