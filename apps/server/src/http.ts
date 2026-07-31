import type { Role } from '@nebula/shared'
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify'
import { getConfig } from './config.js'
import type { AuthUser } from './types.js'

export class HttpError extends Error {
    constructor(
        public status: number,
        public title: string,
        message?: string,
        public errors?: unknown
    ) {
        super(message ?? title)
    }
}

export function requireAuth(request: FastifyRequest): asserts request is FastifyRequest & { auth: NonNullable<FastifyRequest['auth']> } {
    if (!request.auth) {
        throw new HttpError(401, 'Unauthorized', 'Authentication is required')
    }
}

export function requireRole(...roles: Role[]): preHandlerAsyncHookHandler {
    return async (request): Promise<void> => {
        requireAuth(request)
        if (!roles.includes(request.auth.role)) {
            throw new HttpError(403, 'Forbidden', 'Your role cannot perform this action')
        }
        if (request.auth.mustChangePassword && request.url !== '/api/v1/auth/change-password') {
            throw new HttpError(403, 'Password change required', 'Change the temporary password before continuing')
        }
    }
}

export function requireCsrf(request: FastifyRequest): asserts request is FastifyRequest & { auth: AuthUser } {
    requireAuth(request)
    const token = request.headers['x-csrf-token']
    if (typeof token !== 'string' || token !== request.auth.csrfToken) {
        throw new HttpError(403, 'Invalid CSRF token')
    }
    const origin = request.headers.origin
    if (origin && origin.replace(/\/$/, '') !== getConfig().appBaseUrl) {
        throw new HttpError(403, 'Invalid request origin')
    }
}

export function sendProblem(error: unknown, request: FastifyRequest, reply: FastifyReply): void {
    if (error instanceof HttpError) {
        void reply.status(error.status).type('application/problem+json').send({
            type: 'about:blank',
            title: error.title,
            status: error.status,
            detail: error.message,
            requestId: request.id,
            ...(error.errors == null ? {} : { errors: error.errors })
        })
        return
    }
    const statusCode = typeof error === 'object' && error != null && 'statusCode' in error
        ? Number((error as { statusCode?: unknown }).statusCode)
        : 500
    if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 500) {
        const message = error instanceof Error ? error.message : 'The request is invalid'
        void reply.status(statusCode).type('application/problem+json').send({
            type: 'about:blank',
            title: statusCode === 404 ? 'Not Found' : 'Bad Request',
            status: statusCode,
            detail: message,
            requestId: request.id
        })
        return
    }
    request.log.error(error)
    void reply.status(500).type('application/problem+json').send({
        type: 'about:blank',
        title: 'Internal Server Error',
        status: 500,
        detail: 'The request could not be completed',
        requestId: request.id
    })
}

export function parsePagination(query: Record<string, unknown>): { limit: number, offset: number } {
    const requestedLimit = Number(query.limit ?? 50)
    const requestedOffset = Number(query.offset ?? 0)
    return {
        limit: Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 200) : 50,
        offset: Number.isInteger(requestedOffset) ? Math.max(requestedOffset, 0) : 0
    }
}
