import { createHash } from 'crypto'
import type { RowDataPacket } from 'mysql2/promise'
import { getPool } from './db/index.js'

export class ProjectStorageBusyError extends Error {
    constructor() {
        super('Project storage is busy; retry this job')
        this.name = 'ProjectStorageBusyError'
    }
}

// A dedicated connection owns the advisory lock across S3 operations. Route-level
// transactions may continue editing drafts; publishing always uses its frozen snapshot.
export async function withProjectStorageLock<T>(projectId: string, work: () => Promise<T>): Promise<T> {
    const connection = await getPool().getConnection()
    const name = `nebula:${createHash('sha256').update(projectId).digest('hex').slice(0, 48)}`
    let acquired = false
    try {
        const [rows] = await connection.query<(RowDataPacket & { acquired: number })[]>(
            'SELECT GET_LOCK(?, 0) AS acquired', [name]
        )
        acquired = rows[0]?.acquired === 1
        if (!acquired) throw new ProjectStorageBusyError()
        return await work()
    } finally {
        if (acquired) await connection.query('SELECT RELEASE_LOCK(?)', [name]).catch(() => undefined)
        connection.release()
    }
}
