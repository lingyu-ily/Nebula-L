import { createHash, randomBytes } from 'crypto'
import { Algorithm, hash, verify } from '@node-rs/argon2'

export function randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('hex')
}

export function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
}

export async function hashPassword(password: string): Promise<string> {
    return hash(password, {
        algorithm: Algorithm.Argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 1,
        outputLen: 32
    })
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
        return await verify(hash, password)
    } catch {
        return false
    }
}
