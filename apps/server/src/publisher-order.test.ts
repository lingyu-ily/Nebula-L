import { describe, expect, it } from 'vitest'
import type { Distribution } from 'helios-distribution-types'
import { PermanentJobError } from './job-errors.js'
import { orderDistribution, type ProjectSnapshot } from './publisher.js'

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
