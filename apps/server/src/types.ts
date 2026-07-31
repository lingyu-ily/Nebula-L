import type { Role } from '@nebula/shared'
import type { FastifyRequest } from 'fastify'

export interface AuthUser {
    id: string
    username: string
    role: Role
    mustChangePassword: boolean
    sessionTokenHash: string
    csrfToken: string
}

export interface AuditContext {
    user?: Pick<AuthUser, 'id' | 'username' | 'role'>
    requestId?: string
    ip?: string
    userAgent?: string
}

export function auditContextFromRequest(request: FastifyRequest): AuditContext {
    return {
        user: request.auth,
        requestId: request.id,
        ip: request.ip,
        userAgent: request.headers['user-agent']?.slice(0, 512)
    }
}

declare module 'fastify' {
    interface FastifyRequest {
        auth?: AuthUser
    }
}
