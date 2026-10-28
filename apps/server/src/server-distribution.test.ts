import { createHash } from 'crypto'
import { Type, type Server } from 'helios-distribution-types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ put: vi.fn() }))
vi.mock('./config.js', () => ({ getConfig: (): unknown => ({ rustfs: { publicBaseUrl: 'https://cdn.test/' } }) }))
vi.mock('./storage.js', () => ({ putImmutableJson: mocks.put }))

import { encodeServerDistribution, publishServerDistribution } from './server-distribution.js'

const server: Server = {
    id: 'survival-1.20.1', name: '生存服', description: '', icon: '', version: '1',
    address: 'localhost:25565', minecraftVersion: '1.20.1', mainServer: true, autoconnect: false,
    modules: [{
        id: 'test:example:1.0', name: 'Example', type: Type.ForgeMod, required: { value: false, def: false },
        artifact: { url: 'https://cdn.test/mod.jar', size: 100 },
        subModules: [{ id: 'config', name: '設定', type: Type.File, artifact: { path: 'config/a.json', url: 'https://cdn.test/a.json', size: 10 } }]
    }]
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.put.mockResolvedValue(undefined)
})

describe('one manifest per server', () => {
    it('uses compact UTF-8 bytes, preserves all server data and hashes the exact payload', () => {
        const result = encodeServerDistribution('test', 'https://cdn.test/', server)
        expect(result.body.toString()).toBe(JSON.stringify(server))
        expect(JSON.parse(result.body.toString())).toEqual(server)
        expect(result.reference.size).toBe(Buffer.byteLength(JSON.stringify(server)))
        expect(result.reference.sha256).toBe(createHash('sha256').update(result.body).digest('hex'))
        expect(result.objectKey).toBe(`public/test/server-distributions/${result.reference.sha256}.json`)
        expect(result.reference.url).toBe(`https://cdn.test/${result.objectKey}`)
        expect(result.reference.id).toBe(server.id)
    })

    it('keeps unchanged server URLs stable and changes only the edited server', () => {
        const other = { ...server, id: 'other' }
        const before = [server, other].map(value => encodeServerDistribution('test', 'https://cdn.test', value).reference)
        const after = [server, { ...other, name: 'Updated' }].map(value => encodeServerDistribution('test', 'https://cdn.test', value).reference)
        expect(after[0]).toEqual(before[0])
        expect(after[1].url).not.toBe(before[1].url)
    })

    it('returns a reference only after immutable storage completes verification', async () => {
        const encoded = encodeServerDistribution('test', 'https://cdn.test', server)
        expect(await publishServerDistribution('test', server)).toEqual(encoded.reference)
        expect(mocks.put).toHaveBeenCalledWith(encoded.objectKey, encoded.body)
        mocks.put.mockRejectedValue(new Error('Verification failed'))
        await expect(publishServerDistribution('test', server)).rejects.toThrow('Verification failed')
    })
})
