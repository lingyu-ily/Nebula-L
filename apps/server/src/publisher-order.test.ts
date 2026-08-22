import { describe, expect, it } from 'vitest'
import type { Distribution } from 'helios-distribution-types'
import { orderDistribution, type ProjectSnapshot } from './publisher.js'

describe('published server ordering', () => {
    it('keeps the saved snapshot order without forcing the main server first', () => {
        const distribution = {
            servers: [
                { id: 'main', modules: [] },
                { id: 'last', modules: [] },
                { id: 'first', modules: [] }
            ]
        } as unknown as Distribution
        const snapshot = {
            servers: [
                { serverKey: 'first', mainServer: false, modules: [] },
                { serverKey: 'main', mainServer: true, modules: [] },
                { serverKey: 'last', mainServer: false, modules: [] }
            ]
        } as unknown as ProjectSnapshot

        orderDistribution(distribution, snapshot)

        expect(distribution.servers.map(server => server.id)).toEqual(['first', 'main', 'last'])
    })
})
