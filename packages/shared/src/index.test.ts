import { describe, expect, it } from 'vitest'
import { isSafeRelativePath, serverInputSchema } from './index.js'

describe('shared validation', () => {
    it('rejects path traversal and Windows paths', () => {
        expect(isSafeRelativePath('../secret')).toBe(false)
        expect(isSafeRelativePath('C:\\secret')).toBe(false)
        expect(isSafeRelativePath('config/options.txt')).toBe(true)
    })

    it('rejects mixed Forge and Fabric loaders', () => {
        const result = serverInputSchema.safeParse({
            serverKey: 'main',
            name: 'Main',
            minecraftVersion: '1.20.1',
            serverVersion: '1.0.0',
            address: 'localhost:25565',
            forgeVersion: '47.4.0',
            fabricVersion: '0.16.0'
        })
        expect(result.success).toBe(false)
    })
})
