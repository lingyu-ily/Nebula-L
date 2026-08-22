import { describe, expect, it } from 'vitest'
import {
    directoryInputSchema,
    isSafeFileName,
    isSafeRelativePath,
    launcherUiInputSchema,
    modulePatchSchema,
    serverOrderInputSchema,
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

    it('requires unique server IDs when saving server order', () => {
        const first = '9fb8ad8a-4d47-4dd8-85f7-07059f4ef4c8'
        const second = '0d4b42c8-45ec-4bbc-9ca1-80901de7b38d'
        expect(serverOrderInputSchema.safeParse({ serverIds: [first, second] }).success).toBe(true)
        expect(serverOrderInputSchema.safeParse({ serverIds: [first, first] }).success).toBe(false)
        expect(serverOrderInputSchema.safeParse({ serverIds: [] }).success).toBe(true)
    })

    it('validates per-server launcher content', () => {
        expect(launcherUiInputSchema.safeParse({
            backgroundUploadId: '9fb8ad8a-4d47-4dd8-85f7-07059f4ef4c8',
            logoUploadId: null,
            video: { source: 'external', url: 'https://cdn.example.com/hero.webm' },
            eyebrow: 'MAPLECRAFT SERVER',
            title: 'Adventure World',
            tagline: 'Build your own empire.',
            rss: 'https://example.com/adventure/rss'
        }).success).toBe(true)
        expect(launcherUiInputSchema.safeParse({ rss: 'not-a-url' }).success).toBe(false)
        expect(launcherUiInputSchema.safeParse({ eyebrow: 'x'.repeat(129) }).success).toBe(false)
        expect(launcherUiInputSchema.safeParse({ video: { source: 'upload', uploadId: 'not-a-uuid' } }).success).toBe(false)
        expect(launcherUiInputSchema.safeParse({ video: { source: 'youtube', url: 'not-a-url' } }).success).toBe(false)
    })
})
