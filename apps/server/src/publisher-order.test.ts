import { describe, expect, it } from 'vitest'
import type { Distribution } from 'helios-distribution-types'
import { PermanentJobError } from './job-errors.js'
import { applyChecksumValidation, orderDistribution, type ProjectSnapshot } from './publisher.js'

describe('published server ordering', () => {
    it('keeps the saved snapshot order without forcing the main server first', () => {
        const distribution = {
            servers: [
                { id: 'main-1.21.1', modules: [] },
                { id: 'last-1.19.4', modules: [] },
                { id: 'first-1.20.1', modules: [] }
            ]
        } as unknown as Distribution
        const snapshot = {
            servers: [
                { serverKey: 'first', minecraftVersion: '1.20.1', mainServer: false, modules: [] },
                { serverKey: 'main', minecraftVersion: '1.21.1', mainServer: true, modules: [] },
                { serverKey: 'last', minecraftVersion: '1.19.4', mainServer: false, modules: [] }
            ]
        } as unknown as ProjectSnapshot

        orderDistribution(distribution, snapshot)

        expect(distribution.servers.map(server => server.id)).toEqual([
            'first-1.20.1',
            'main-1.21.1',
            'last-1.19.4'
        ])
    })

    it('uses the effective server ID when applying module order', () => {
        const distribution = {
            servers: [{
                id: 'flyfish-1.20.1',
                modules: [
                    { artifact: { url: 'https://cdn.example.com/second.jar' } },
                    { artifact: { url: 'https://cdn.example.com/first.jar' } }
                ]
            }]
        } as unknown as Distribution
        const snapshot = {
            servers: [{
                serverKey: 'flyfish',
                minecraftVersion: '1.20.1',
                modules: [
                    { upload: { originalName: 'first.jar' }, sortOrder: 0 },
                    { upload: { originalName: 'second.jar' }, sortOrder: 1 }
                ]
            }]
        } as unknown as ProjectSnapshot

        orderDistribution(distribution, snapshot)

        expect(distribution.servers[0].modules.map(module => module.artifact.url)).toEqual([
            'https://cdn.example.com/first.jar',
            'https://cdn.example.com/second.jar'
        ])
    })

    it('rejects missing and unexpected generated server IDs', () => {
        const distribution = {
            servers: [
                { id: 'first-1.20.1', modules: [] },
                { id: 'external-1.21.1', modules: [] }
            ]
        } as unknown as Distribution
        const snapshot = {
            servers: [
                { serverKey: 'first', minecraftVersion: '1.20.1', modules: [] },
                { serverKey: 'missing', minecraftVersion: '1.19.4', modules: [] }
            ]
        } as unknown as ProjectSnapshot

        expect(() => orderDistribution(distribution, snapshot)).toThrow(PermanentJobError)
        expect(() => orderDistribution(distribution, snapshot)).toThrow(
            'missing generated IDs: missing-1.19.4; unexpected generated IDs: external-1.21.1'
        )
    })

    it('rejects duplicate snapshot and generated server IDs', () => {
        const distribution = {
            servers: [
                { id: 'first-1.20.1', modules: [] },
                { id: 'first-1.20.1', modules: [] }
            ]
        } as unknown as Distribution
        const snapshot = {
            servers: [
                { serverKey: 'first', minecraftVersion: '1.20.1', modules: [] },
                { serverKey: 'first', minecraftVersion: '1.20.1', modules: [] }
            ]
        } as unknown as ProjectSnapshot

        expect(() => orderDistribution(distribution, snapshot)).toThrow(PermanentJobError)
        expect(() => orderDistribution(distribution, snapshot)).toThrow(
            'duplicate snapshot IDs: first-1.20.1; duplicate generated IDs: first-1.20.1'
        )
    })
})

describe('published checksum validation', () => {
    it('omits MD5 only for File modules with validation disabled', () => {
        const distribution = {
            servers: [{
                id: 'main-1.20.1',
                modules: [
                    { type: 'File', artifact: { path: 'config/options.txt', MD5: 'options-md5' } },
                    { type: 'File', artifact: { path: 'config/servers.dat', MD5: 'servers-md5' } },
                    { type: 'File', artifact: { path: 'config/legacy.txt', MD5: 'legacy-md5' } },
                    { type: 'ForgeMod', artifact: { path: 'config/options.txt', MD5: 'mod-md5' } }
                ]
            }]
        } as unknown as Distribution
        const snapshot = {
            servers: [{
                serverKey: 'main',
                minecraftVersion: '1.20.1',
                modules: [
                    {
                        type: 'File',
                        relativePath: 'config/options.txt',
                        validateChecksum: false,
                        upload: { md5: 'stored-options-md5' }
                    },
                    {
                        type: 'File',
                        relativePath: 'config/servers.dat',
                        validateChecksum: true,
                        upload: { md5: 'stored-servers-md5' }
                    },
                    {
                        type: 'File',
                        relativePath: 'config/legacy.txt',
                        upload: { md5: 'stored-legacy-md5' }
                    }
                ]
            }]
        } as unknown as ProjectSnapshot

        applyChecksumValidation(distribution, snapshot)

        expect(distribution.servers[0].modules[0].artifact.MD5).toBeUndefined()
        expect(distribution.servers[0].modules[1].artifact.MD5).toBe('servers-md5')
        expect(distribution.servers[0].modules[2].artifact.MD5).toBe('legacy-md5')
        expect(distribution.servers[0].modules[3].artifact.MD5).toBe('mod-md5')
        expect(snapshot.servers[0].modules[0].upload?.md5).toBe('stored-options-md5')
    })
})
