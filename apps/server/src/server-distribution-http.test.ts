import { createServer } from 'http'
import type { Server } from 'helios-distribution-types'
import { expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => ({ endpoint: '' }))
vi.mock('./config.js', () => ({ getConfig: (): unknown => ({ rustfs: {
    endpoint: settings.endpoint, publicBaseUrl: `${settings.endpoint}/test-bucket`,
    region: 'us-east-1', bucket: 'test-bucket', accessKeyId: 'test', secretAccessKey: 'test-secret'
} }) }))

import { destroyStorage } from './storage.js'
import { publishServerDistribution } from './server-distribution.js'

it('publishes and reuses per-server JSON through the real S3 HTTP transport', async () => {
    const objects = new Map<string, { body: Buffer, metadata: Record<string, string>, cacheControl: string }>()
    const requests: { method: string, key: string }[] = []
    const http = createServer((request, response) => {
        void (async (): Promise<void> => {
            const key = new URL(request.url!, 'http://localhost').pathname
            requests.push({ method: request.method!, key })
            if (request.method === 'PUT') {
                const chunks: Buffer[] = []
                for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array))
                objects.set(key, {
                    body: Buffer.concat(chunks),
                    metadata: Object.fromEntries(Object.entries(request.headers)
                        .filter(([name]) => name.startsWith('x-amz-meta-'))
                        .map(([name, value]) => [name.slice(11), String(value)])),
                    cacheControl: String(request.headers['cache-control'])
                })
                response.setHeader('etag', '"uploaded"')
                response.end()
                return
            }
            const object = objects.get(key)
            if (!object) { response.writeHead(404); response.end(); return }
            response.setHeader('content-length', object.body.length)
            response.setHeader('cache-control', object.cacheControl)
            for (const [name, value] of Object.entries(object.metadata)) response.setHeader(`x-amz-meta-${name}`, value)
            response.end(request.method === 'HEAD' ? undefined : object.body)
        })().catch(() => { response.writeHead(500); response.end() })
    })
    try {
        await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
        const address = http.address()
        if (!address || typeof address === 'string') throw new Error('Missing test address')
        settings.endpoint = `http://127.0.0.1:${address.port}`
        const first: Server = {
            id: 'first', name: '第一台', description: '', icon: '', version: '1', address: 'localhost',
            minecraftVersion: '1.20.1', mainServer: true, autoconnect: false, modules: []
        }
        const second = { ...first, id: 'second', mainServer: false }
        const before = await Promise.all([first, second].map(server => publishServerDistribution('test', server)))
        expect(requests.filter(request => request.method === 'PUT')).toHaveLength(2)
        for (const reference of before) {
            const object = objects.get(new URL(reference.url).pathname)!
            expect(object.body.length).toBe(reference.size)
            expect(object.metadata.sha256).toBe(reference.sha256)
            expect(object.cacheControl).toBe('public, max-age=31536000, immutable')
            expect(JSON.parse(object.body.toString())).toEqual(reference.id === 'first' ? first : second)
        }
        requests.length = 0
        expect(await Promise.all([first, second].map(server => publishServerDistribution('test', server)))).toEqual(before)
        expect(requests.map(request => request.method)).toEqual(['HEAD', 'HEAD'])

        requests.length = 0
        const after = await Promise.all([first, { ...second, name: 'Updated' }].map(server => publishServerDistribution('test', server)))
        expect(after[0]).toEqual(before[0])
        expect(after[1].url).not.toBe(before[1].url)
        expect(requests.filter(request => request.method === 'PUT')).toHaveLength(1)
        expect(objects.size).toBe(3) // Historical server manifests are retained.
    } finally {
        await destroyStorage()
        http.closeAllConnections()
        await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()))
    }
})
