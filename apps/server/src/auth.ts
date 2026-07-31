import { randomUUID } from 'crypto'
import type { ApiUser, Role } from '@nebula/shared'
import { loginSchema, passwordSchema } from '@nebula/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { RowDataPacket } from 'mysql2/promise'
import { writeAudit } from './audit.js'
import { getConfig } from './config.js'
import { getPool, queryOne, withTransaction } from './db/index.js'
import { HttpError, requireAuth, requireCsrf } from './http.js'
import { hashPassword, hashToken, randomToken, verifyPassword } from './security.js'
import { auditContextFromRequest } from './types.js'

interface SessionRow extends RowDataPacket {
    token_hash: string
    csrf_token: string
    user_id: string
    username: string
    role: Role
    must_change_password: number
}

interface LoginUserRow extends RowDataPacket {
    id: string
    username: string
    password_hash: string
    role: Role
    status: 'ACTIVE' | 'DISABLED'
    must_change_password: number
    failed_login_count: number
    locked_until: Date | null
}

function toApiUser(row: Pick<LoginUserRow, 'id' | 'username' | 'role' | 'status' | 'must_change_password'>): ApiUser {
    return {
        id: row.id,
        username: row.username,
        role: row.role,
        status: row.status,
        mustChangePassword: Boolean(row.must_change_password)
    }
}

export async function loadSession(request: FastifyRequest): Promise<void> {
    const rawToken = request.cookies.nebula_session
    if (!rawToken) {
        return
    }
    const tokenHash = hashToken(rawToken)
    const session = await queryOne<SessionRow>(
        `SELECT s.token_hash, s.csrf_token, u.id AS user_id, u.username, u.role, u.must_change_password
         FROM sessions s
         INNER JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP(3) AND u.status = 'ACTIVE'`,
        [tokenHash]
    )
    if (!session) {
        return
    }
    request.auth = {
        id: session.user_id,
        username: session.username,
        role: session.role,
        mustChangePassword: Boolean(session.must_change_password),
        sessionTokenHash: session.token_hash,
        csrfToken: session.csrf_token
    }
    try {
        await getPool().execute(
            'UPDATE sessions SET last_seen_at = UTC_TIMESTAMP(3) WHERE token_hash = ?',
            [tokenHash]
        )
    } catch (error) {
        request.log.warn(error)
    }
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
    app.post('/api/v1/auth/login', {
        config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        const parsed = loginSchema.safeParse(request.body)
        if (!parsed.success) {
            throw new HttpError(400, 'Invalid login', 'Username and password are required', parsed.error.flatten())
        }
        const username = parsed.data.username
        const user = await queryOne<LoginUserRow>(
            'SELECT * FROM users WHERE username = ? LIMIT 1',
            [username]
        )
        const valid = user?.status === 'ACTIVE' && (!user.locked_until || user.locked_until <= new Date())
            ? await verifyPassword(user.password_hash, parsed.data.password)
            : false
        if (!user || !valid) {
            if (user) {
                const failures = user.failed_login_count + 1
                await getPool().execute(
                    `UPDATE users SET failed_login_count = ?, locked_until = IF(? >= 5, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 15 MINUTE), locked_until)
                     WHERE id = ?`,
                    [failures, failures, user.id]
                )
            }
            await writeAudit(getPool(), {
                requestId: request.id,
                ip: request.ip,
                userAgent: request.headers['user-agent']
            }, {
                action: 'auth.login',
                entityType: 'user',
                entityId: user?.id,
                after: { username },
                result: 'FAILURE',
                errorMessage: 'Invalid credentials or locked account'
            })
            throw new HttpError(401, 'Invalid credentials')
        }
        const rawToken = randomToken()
        const csrfToken = randomToken()
        const tokenHash = hashToken(rawToken)
        await withTransaction(async connection => {
            await connection.execute(
                `INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at, last_seen_at, ip, user_agent, created_at)
                 VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 DAY), UTC_TIMESTAMP(3), ?, ?, UTC_TIMESTAMP(3))`,
                [tokenHash, user.id, csrfToken, request.ip, request.headers['user-agent']?.slice(0, 512) ?? null]
            )
            await connection.execute(
                'UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = UTC_TIMESTAMP(3) WHERE id = ?',
                [user.id]
            )
            await writeAudit(connection, {
                user: { id: user.id, username: user.username, role: user.role },
                requestId: request.id,
                ip: request.ip,
                userAgent: request.headers['user-agent']
            }, {
                action: 'auth.login',
                entityType: 'user',
                entityId: user.id
            })
        })
        reply.setCookie('nebula_session', rawToken, {
            httpOnly: true,
            secure: getConfig().cookieSecure,
            sameSite: 'lax',
            path: '/',
            maxAge: 7 * 24 * 60 * 60
        })
        return { user: toApiUser(user), csrfToken }
    })

    app.get('/api/v1/auth/me', async request => {
        requireAuth(request)
        return {
            user: {
                id: request.auth.id,
                username: request.auth.username,
                role: request.auth.role,
                status: 'ACTIVE',
                mustChangePassword: request.auth.mustChangePassword
            } satisfies ApiUser,
            csrfToken: request.auth.csrfToken
        }
    })

    app.post('/api/v1/auth/logout', async (request, reply) => {
        requireCsrf(request)
        await withTransaction(async connection => {
            await connection.execute('DELETE FROM sessions WHERE token_hash = ?', [request.auth.sessionTokenHash])
            await writeAudit(connection, auditContextFromRequest(request), {
                action: 'auth.logout',
                entityType: 'user',
                entityId: request.auth.id
            })
        })
        reply.clearCookie('nebula_session', { path: '/' })
        return reply.status(204).send()
    })

    app.post('/api/v1/auth/change-password', async request => {
        requireCsrf(request)
        const body = request.body as { currentPassword?: unknown, newPassword?: unknown }
        const newPassword = passwordSchema.safeParse(body.newPassword)
        if (!newPassword.success || typeof body.currentPassword !== 'string') {
            throw new HttpError(400, 'Invalid password', 'Current password and a new password of at least 12 characters are required')
        }
        const user = await queryOne<LoginUserRow>('SELECT * FROM users WHERE id = ?', [request.auth.id])
        if (!user || !(await verifyPassword(user.password_hash, body.currentPassword))) {
            throw new HttpError(401, 'Current password is incorrect')
        }
        const passwordHash = await hashPassword(newPassword.data)
        await withTransaction(async connection => {
            await connection.execute(
                'UPDATE users SET password_hash = ?, must_change_password = FALSE WHERE id = ?',
                [passwordHash, request.auth.id]
            )
            await connection.execute('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [request.auth.id, request.auth.sessionTokenHash])
            await writeAudit(connection, auditContextFromRequest(request), {
                action: 'auth.password_changed',
                entityType: 'user',
                entityId: request.auth.id
            })
        })
        request.auth.mustChangePassword = false
        return { changed: true }
    })
}

export async function createAdmin(username: string, password: string): Promise<string> {
    const validatedPassword = passwordSchema.parse(password)
    const existing = await queryOne<RowDataPacket & { count: number }>('SELECT COUNT(*) AS count FROM users')
    if ((existing?.count ?? 0) > 0) {
        throw new Error('admin:create only works before the first user exists')
    }
    const id = randomUUID()
    const passwordHash = await hashPassword(validatedPassword)
    await withTransaction(async connection => {
        await connection.execute(
            `INSERT INTO users (id, username, password_hash, role, status, must_change_password, created_at, updated_at)
             VALUES (?, ?, ?, 'ADMIN', 'ACTIVE', TRUE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
            [id, username, passwordHash]
        )
        await writeAudit(connection, {}, {
            action: 'user.bootstrap_admin',
            entityType: 'user',
            entityId: id,
            after: { username, role: 'ADMIN' }
        })
    })
    return id
}
