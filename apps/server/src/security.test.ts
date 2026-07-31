import { describe, expect, it } from 'vitest'
import { hashPassword, hashToken, verifyPassword } from './security.js'

describe('security primitives', () => {
    it('uses Argon2id password hashes', async () => {
        const password = 'correct horse battery staple'
        const hash = await hashPassword(password)
        expect(hash).toContain('argon2id')
        await expect(verifyPassword(hash, password)).resolves.toBe(true)
        await expect(verifyPassword(hash, 'incorrect password')).resolves.toBe(false)
    })

    it('does not store an opaque session token directly', () => {
        const token = 'session-token'
        expect(hashToken(token)).not.toBe(token)
        expect(hashToken(token)).toHaveLength(64)
    })
})
