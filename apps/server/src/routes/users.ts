import { randomUUID } from 'crypto'
import { createUserSchema, passwordSchema, updateUserSchema } from '@nebula/shared'
import type { FastifyInstance } from 'fastify'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { writeAudit } from '../audit.js'
import { getPool, queryOne, withTransaction } from '../db/index.js'
import { HttpError, requireCsrf, requireRole } from '../http.js'
import { hashPassword } from '../security.js'
import { auditContextFromRequest } from '../types.js'

interface UserRow extends RowDataPacket {
    id: string
    username: string
    role: 'ADMIN' | 'EDITOR' | 'AUDITOR'
    status: 'ACTIVE' | 'DISABLED'
    must_change_password: number
    last_login_at: Date | null
    created_at: Date
}

function publicUser(user: UserRow): Record<string, unknown> {
    return {
        id: user.id,
        username: user.username,
        role: user.role,
        status: user.status,
        mustChangePassword: Boolean(user.must_change_password),
        lastLoginAt: user.last_login_at,
        createdAt: user.created_at
    }
}

async function protectLastAdmin(userId: string, nextRole?: string, nextStatus?: string): Promise<void> {
    const user = await queryOne<UserRow>('SELECT * FROM users WHERE id = ?', [userId])
    if (!user) {
        throw new HttpError(404, 'User not found')
    }
    const removesAdmin = user.role === 'ADMIN' && user.status === 'ACTIVE'
        && (nextRole && nextRole !== 'ADMIN' || nextStatus === 'DISABLED')
    if (!removesAdmin) {
        return
    }
    const count = await queryOne<RowDataPacket & { total: number }>(
        'SELECT COUNT(*) AS total FROM users WHERE role = \'ADMIN\' AND status = \'ACTIVE\''
    )
    if ((count?.total ?? 0) <= 1) {
        throw new HttpError(409, 'Last administrator', 'The last active administrator cannot be disabled or demoted')
    }
}

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/v1/users', { preHandler: requireRole('ADMIN') }, async () => {
        const [rows] = await getPool().query<UserRow[]>(
            'SELECT id, username, role, status, must_change_password, last_login_at, created_at FROM users ORDER BY username'
        )
        return { items: rows.map(publicUser) }
    })

    app.post('/api/v1/users', { preHandler: requireRole('ADMIN') }, async (request, reply) => {
        requireCsrf(request)
        const parsed = createUserSchema.safeParse(request.body)
        if (!parsed.success) {
            throw new HttpError(400, 'Invalid user', 'User data is invalid', parsed.error.flatten())
        }
        const id = randomUUID()
        const passwordHash = await hashPassword(parsed.data.password)
        try {
            await withTransaction(async connection => {
                await connection.execute(
                    `INSERT INTO users (id, username, password_hash, role, status, must_change_password, created_at, updated_at)
                     VALUES (?, ?, ?, ?, 'ACTIVE', TRUE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
                    [id, parsed.data.username, passwordHash, parsed.data.role]
                )
                await writeAudit(connection, auditContextFromRequest(request), {
                    action: 'user.created',
                    entityType: 'user',
                    entityId: id,
                    after: { username: parsed.data.username, role: parsed.data.role, status: 'ACTIVE' }
                })
            })
        } catch (error) {
            if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
                throw new HttpError(409, 'Username already exists')
            }
            throw error
        }
        return reply.status(201).send({ id })
    })

    app.patch('/api/v1/users/:userId', { preHandler: requireRole('ADMIN') }, async request => {
        requireCsrf(request)
        const { userId } = request.params as { userId: string }
        const parsed = updateUserSchema.safeParse(request.body)
        if (!parsed.success) {
            throw new HttpError(400, 'Invalid user update', undefined, parsed.error.flatten())
        }
        if (request.auth.id === userId && parsed.data.status === 'DISABLED') {
            throw new HttpError(409, 'Cannot disable current account')
        }
        await protectLastAdmin(userId, parsed.data.role, parsed.data.status)
        await withTransaction(async connection => {
            const [beforeRows] = await connection.query<UserRow[]>('SELECT * FROM users WHERE id = ? FOR UPDATE', [userId])
            const before = beforeRows[0]
            if (!before) {
                throw new HttpError(404, 'User not found')
            }
            await connection.execute(
                'UPDATE users SET role = COALESCE(?, role), status = COALESCE(?, status) WHERE id = ?',
                [parsed.data.role ?? null, parsed.data.status ?? null, userId]
            )
            if (parsed.data.status === 'DISABLED') {
                await connection.execute('DELETE FROM sessions WHERE user_id = ?', [userId])
            }
            await writeAudit(connection, auditContextFromRequest(request), {
                action: 'user.updated',
                entityType: 'user',
                entityId: userId,
                before: publicUser(before),
                after: { ...publicUser(before), ...parsed.data }
            })
        })
        return { updated: true }
    })

    app.post('/api/v1/users/:userId/reset-password', { preHandler: requireRole('ADMIN') }, async request => {
        requireCsrf(request)
        const { userId } = request.params as { userId: string }
        const parsed = passwordSchema.safeParse((request.body as { password?: unknown })?.password)
        if (!parsed.success) {
            throw new HttpError(400, 'Invalid password', 'Password must contain at least 12 characters')
        }
        const passwordHash = await hashPassword(parsed.data)
        await withTransaction(async connection => {
            const [result] = await connection.execute<ResultSetHeader>(
                'UPDATE users SET password_hash = ?, must_change_password = TRUE, failed_login_count = 0, locked_until = NULL WHERE id = ?',
                [passwordHash, userId]
            )
            if (result.affectedRows === 0) {
                throw new HttpError(404, 'User not found')
            }
            await connection.execute('DELETE FROM sessions WHERE user_id = ?', [userId])
            await writeAudit(connection, auditContextFromRequest(request), {
                action: 'user.password_reset',
                entityType: 'user',
                entityId: userId
            })
        })
        return { reset: true }
    })
}
