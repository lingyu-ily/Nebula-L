import type { Pool, PoolConnection } from 'mysql2/promise'
import type { AuditContext } from './types.js'

interface AuditEvent {
    action: string
    entityType: string
    entityId?: string
    projectId?: string
    before?: unknown
    after?: unknown
    result?: 'SUCCESS' | 'FAILURE'
    errorMessage?: string
}

function safeJson(value: unknown): string | null {
    if (value == null) {
        return null
    }
    return JSON.stringify(value, (key, nestedValue: unknown) => {
        if (/password|secret|token|credential/i.test(key)) {
            return '[REDACTED]'
        }
        return nestedValue
    })
}

export async function writeAudit(
    connection: Pool | PoolConnection,
    context: AuditContext,
    event: AuditEvent
): Promise<void> {
    await connection.execute(
        `INSERT INTO audit_logs (
            actor_user_id, actor_username, actor_role, action, entity_type, entity_id,
            project_id, request_id, ip, user_agent, before_data, after_data,
            result, error_message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
        [
            context.user?.id ?? null,
            context.user?.username ?? null,
            context.user?.role ?? null,
            event.action,
            event.entityType,
            event.entityId ?? null,
            event.projectId ?? null,
            context.requestId ?? null,
            context.ip ?? null,
            context.userAgent ?? null,
            safeJson(event.before),
            safeJson(event.after),
            event.result ?? 'SUCCESS',
            event.errorMessage?.slice(0, 4000) ?? null
        ]
    )
}
