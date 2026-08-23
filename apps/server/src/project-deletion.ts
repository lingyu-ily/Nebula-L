import { randomUUID } from 'crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { writeAudit } from './audit.js'
import { getConfig } from './config.js'
import { getPool, withTransaction } from './db/index.js'
import { deleteObjectPrefix } from './storage.js'

export interface ProjectDeletionTaskRow extends RowDataPacket {
    id: string
    project_id: string
    project_slug: string
    project_name: string
    status: 'QUEUED' | 'RUNNING' | 'FAILED'
    attempts: number
    max_attempts: number
    requested_by: string
}

interface DeletionContextRow extends ProjectDeletionTaskRow {
    disabled: number
    username: string
    role: 'ADMIN' | 'EDITOR' | 'AUDITOR'
}

const RETRY_DELAYS = [30, 120, 600]

export function projectDeletionPrefixes(projectId: string, slug: string): [string, string] {
    return [`public/${slug}/`, `private/uploads/${projectId}/`]
}

export function projectDeletionRetryDelay(attempts: number): number {
    return RETRY_DELAYS[Math.min(Math.max(attempts - 1, 0), RETRY_DELAYS.length - 1)]
}

async function heartbeat(taskId: string): Promise<void> {
    await getPool().execute(
        'UPDATE project_deletion_tasks SET heartbeat_at = UTC_TIMESTAMP(3) WHERE id = ? AND status = \'RUNNING\'',
        [taskId]
    )
}

export async function claimProjectDeletion(workerId: string): Promise<ProjectDeletionTaskRow | undefined> {
    return withTransaction(async connection => {
        const [rows] = await connection.query<ProjectDeletionTaskRow[]>(
            `SELECT d.* FROM project_deletion_tasks d
             INNER JOIN projects p ON p.id = d.project_id AND p.disabled = TRUE
             WHERE d.status = 'QUEUED' AND d.available_at <= UTC_TIMESTAMP(3)
               AND NOT EXISTS (
                   SELECT 1 FROM jobs WHERE project_id = d.project_id AND status = 'RUNNING'
               )
             ORDER BY d.created_at, d.id LIMIT 1 FOR UPDATE SKIP LOCKED`
        )
        const task = rows[0]
        if (!task) return undefined
        await connection.execute(
            `UPDATE project_deletion_tasks
             SET status = 'RUNNING', attempts = attempts + 1, locked_by = ?,
                 locked_at = UTC_TIMESTAMP(3), heartbeat_at = UTC_TIMESTAMP(3), error_text = NULL
             WHERE id = ?`,
            [workerId, task.id]
        )
        task.attempts += 1
        return task
    })
}

async function deleteProjectDatabaseRecords(task: ProjectDeletionTaskRow): Promise<void> {
    await withTransaction(async connection => {
        const [rows] = await connection.query<DeletionContextRow[]>(
            `SELECT d.*, p.disabled, u.username, u.role
             FROM project_deletion_tasks d
             INNER JOIN projects p ON p.id = d.project_id
             INNER JOIN users u ON u.id = d.requested_by
             WHERE d.id = ? FOR UPDATE`,
            [task.id]
        )
        const current = rows[0]
        if (!current?.disabled || current.status !== 'RUNNING') {
            throw new Error('Distribution deletion is no longer runnable')
        }
        const [runningJobs] = await connection.query<(RowDataPacket & { id: string })[]>(
            'SELECT id FROM jobs WHERE project_id = ? AND status = \'RUNNING\' LIMIT 1 FOR UPDATE',
            [task.project_id]
        )
        if (runningJobs[0]) {
            throw new Error('Distribution still has a running background job')
        }

        await connection.execute(
            `DELETE release_file FROM release_files release_file
             INNER JOIN releases release_record ON release_record.id = release_file.release_id
             WHERE release_record.project_id = ?`,
            [task.project_id]
        )
        await connection.execute('DELETE FROM releases WHERE project_id = ?', [task.project_id])
        await connection.execute('DELETE FROM jobs WHERE project_id = ?', [task.project_id])
        await connection.execute('DELETE FROM modules WHERE project_id = ?', [task.project_id])
        await connection.execute('DELETE FROM server_directories WHERE project_id = ?', [task.project_id])
        await connection.execute('DELETE FROM servers WHERE project_id = ?', [task.project_id])
        await connection.execute('DELETE FROM uploads WHERE project_id = ?', [task.project_id])
        await connection.execute('DELETE FROM audit_logs WHERE project_id = ?', [task.project_id])
        const [deleted] = await connection.execute<ResultSetHeader>(
            'DELETE FROM projects WHERE id = ? AND disabled = TRUE',
            [task.project_id]
        )
        if (deleted.affectedRows !== 1) {
            throw new Error('Disabled distribution no longer exists')
        }
        await writeAudit(connection, {
            user: {
                id: current.requested_by,
                username: current.username,
                role: current.role
            },
            requestId: `deletion:${current.id}`
        }, {
            action: 'project.purged',
            entityType: 'project',
            entityId: current.project_id,
            projectId: current.project_id,
            after: { name: current.project_name }
        })
    })
}

export async function purgeProject(task: ProjectDeletionTaskRow): Promise<void> {
    for (const prefix of projectDeletionPrefixes(task.project_id, task.project_slug)) {
        await deleteObjectPrefix(prefix, () => heartbeat(task.id))
    }
    await deleteProjectDatabaseRecords(task)
}

export async function failProjectDeletion(task: ProjectDeletionTaskRow, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)
    const retry = task.attempts < task.max_attempts
    await getPool().execute(
        `UPDATE project_deletion_tasks
         SET status = ?, available_at = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)),
             locked_by = NULL, locked_at = NULL, heartbeat_at = UTC_TIMESTAMP(3), error_text = ?
         WHERE id = ?`,
        [retry ? 'QUEUED' : 'FAILED', projectDeletionRetryDelay(task.attempts), message.slice(0, 60000), task.id]
    )
}

export class ProjectDeletionWorker {
    private stopped = false
    private timer?: ReturnType<typeof setTimeout>
    private readonly workerId = `project-deletion-${process.pid}-${randomUUID()}`

    public start(): void {
        void recoverStaleProjectDeletions().then(() => this.tick())
    }

    public stop(): void {
        this.stopped = true
        if (this.timer) clearTimeout(this.timer)
    }

    private async tick(): Promise<void> {
        if (this.stopped) return
        try {
            const task = await claimProjectDeletion(this.workerId)
            if (task) {
                try {
                    await purgeProject(task)
                } catch (error) {
                    await failProjectDeletion(task, error)
                }
            }
        } finally {
            if (!this.stopped) {
                this.timer = setTimeout(() => void this.tick(), getConfig().workerPollMs)
            }
        }
    }
}

export async function recoverStaleProjectDeletions(): Promise<void> {
    await getPool().execute(
        `UPDATE project_deletion_tasks
         SET status = 'QUEUED', locked_by = NULL, locked_at = NULL, available_at = UTC_TIMESTAMP(3)
         WHERE status = 'RUNNING' AND heartbeat_at < TIMESTAMPADD(MINUTE, -5, UTC_TIMESTAMP(3))`
    )
}
