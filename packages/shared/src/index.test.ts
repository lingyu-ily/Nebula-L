import { describe, expect, it } from 'vitest'
import {
    directoryInputSchema,
    isSafeFileName,
    isSafeRelativePath,
    modulePatchSchema,
    serverInputSchema
} from './index.js'

describe('shared validation', () => {
    it('rejects path traversal and Windows paths', () => {
        expect(isSafeRelativePath('../secret')).toBe(false)
        expect(isSafeRelativePath('C:\\secret')).toBe(false)
        expect(isSafeRelativePath('config//options.txt')).toBe(false)
        expect(isSafeRelativePath('config/\u0000options.txt')).toBe(false)
        expect(isSafeRelativePath('config/options.txt')).toBe(true)
    })

    it('validates managed directories and file names', () => {
        expect(directoryInputSchema.safeParse({ path: 'config/client' }).success).toBe(true)
        expect(directoryInputSchema.safeParse({ path: 'config/../server' }).success).toBe(false)
        expect(isSafeFileName('mod.jar')).toBe(true)
        expect(isSafeFileName('../mod.jar')).toBe(false)
        expect(modulePatchSchema.safeParse({}).success).toBe(false)
        expect(modulePatchSchema.safeParse({ fileName: 'renamed.jar' }).success).toBe(true)
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
