import type { FastifyInstance } from 'fastify'
import type { RowDataPacket } from 'mysql2/promise'
import { getPool } from '../db/index.js'
import { parsePagination, requireRole } from '../http.js'

interface AuditRow extends RowDataPacket {
    id: number
    actor_username: string | null
    actor_role: string | null
    action: string
    entity_type: string
    entity_id: string | null
    project_id: string | null
    request_id: string | null
    ip: string | null
    user_agent: string | null
    before_data: unknown
    after_data: unknown
    result: string
    error_message: string | null
    created_at: Date
}

function mapAudit(row: AuditRow): Record<string, unknown> {
    return {
        id: Number(row.id),
        actorUsername: row.actor_username,
        actorRole: row.actor_role,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        projectId: row.project_id,
        requestId: row.request_id,
        ip: row.ip,
        userAgent: row.user_agent,
        before: row.before_data,
        after: row.after_data,
        result: row.result,
        errorMessage: row.error_message,
        createdAt: row.created_at
    }
}

function csvCell(value: unknown): string {
    let text = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value)
    if (/^[=+\-@]/.test(text)) {
        text = `'${text}`
    }
    return `"${text.replace(/"/g, '""')}"`
}

export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/v1/audit-logs', { preHandler: requireRole('ADMIN', 'EDITOR', 'AUDITOR') }, async (request, reply) => {
        const query = request.query as Record<string, unknown>
        const { limit, offset } = parsePagination(query)
        const clauses: string[] = []
        const values: (string | number)[] = []
        if (typeof query.projectId === 'string' && query.projectId) {
            clauses.push('project_id = ?')
            values.push(query.projectId)
        }
        if (typeof query.action === 'string' && query.action) {
            clauses.push('action = ?')
            values.push(query.action)
        }
        if (typeof query.actor === 'string' && query.actor) {
            clauses.push('actor_username = ?')
            values.push(query.actor)
        }
        const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
        const exportFormat = query.format === 'csv' || query.format === 'json' ? query.format : null
        const effectiveLimit = exportFormat ? 10000 : limit
        const [rows] = await getPool().execute<AuditRow[]>(
            `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            [...values, effectiveLimit, exportFormat ? 0 : offset]
        )
        const items = rows.map(mapAudit)
        if (exportFormat === 'json') {
            return reply.header('Content-Disposition', 'attachment; filename="nebula-audit.json"').send(items)
        }
        if (exportFormat === 'csv') {
            const headers = ['id', 'createdAt', 'actorUsername', 'actorRole', 'action', 'entityType', 'entityId', 'projectId', 'result', 'ip', 'requestId', 'before', 'after', 'errorMessage']
            const csv = [
                headers.map(csvCell).join(','),
                ...items.map(item => headers.map(header => csvCell(item[header])).join(','))
            ].join('\r\n')
            return reply
                .type('text/csv; charset=utf-8')
                .header('Content-Disposition', 'attachment; filename="nebula-audit.csv"')
                .send(`\uFEFF${csv}`)
        }
        return { items, limit, offset }
    })
}
