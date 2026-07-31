import { describe, expect, it } from 'vitest'
import {
    VersionCatalogService,
    VersionCatalogUnavailableError,
    type CatalogFetch
} from './version-catalog.js'

function jsonResponse(value: unknown): Response {
    return new Response(JSON.stringify(value), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    })
}

describe('version catalog', () => {
    it('keeps only Minecraft releases in upstream order', async () => {
        const fetcher: CatalogFetch = async () => jsonResponse({
            versions: [
                { id: '1.21.5', type: 'release', releaseTime: '2025-03-25T12:00:00Z' },
                { id: '25w10a', type: 'snapshot', releaseTime: '2025-03-05T12:00:00Z' },
                { id: '1.21.4', type: 'release', releaseTime: '2024-12-03T12:00:00Z' }
            ]
        })
        const catalog = await new VersionCatalogService(fetcher).getMinecraftVersions()

        expect(catalog).toEqual({
            versions: [
                { value: '1.21.5', type: 'release', releaseTime: '2025-03-25T12:00:00Z' },
                { value: '1.21.4', type: 'release', releaseTime: '2024-12-03T12:00:00Z' }
            ],
            stale: false
        })
    })

    it('normalizes Forge artifacts and identifies promoted versions', async () => {
        const fetcher: CatalogFetch = async url => {
            if (url.includes('maven-metadata.xml')) {
                return new Response(`
                    <metadata><versioning><versions>
                        <version>1.7.10-10.13.4.1614-1.7.10</version>
                        <version>1.7.10-10.13.4.1558</version>
                        <version>1.8.9-11.15.1.2318-1.8.9</version>
                    </versions></versioning></metadata>
                `)
            }
            return jsonResponse({
                promos: {
                    '1.7.10-recommended': '10.13.4.1558',
                    '1.7.10-latest': '10.13.4.1614'
                }
            })
        }
        const catalog = await new VersionCatalogService(fetcher).getLoaderVersions('forge', '1.7.10')

        expect(catalog.versions).toEqual([
            {
                value: '10.13.4.1614',
                recommended: false,
                latest: true,
                stable: false
            },
            {
                value: '10.13.4.1558',
                recommended: true,
                latest: false,
                stable: false
            }
        ])
    })

    it('sorts stable Fabric loaders first while retaining latest markers', async () => {
        const fetcher: CatalogFetch = async () => jsonResponse([
            { loader: { version: '0.17.0', stable: false } },
            { loader: { version: '0.16.14', stable: true } },
            { loader: { version: '0.16.13', stable: true } }
        ])
        const catalog = await new VersionCatalogService(fetcher).getLoaderVersions('fabric', '1.21.1')

        expect(catalog.versions.map(version => version.value)).toEqual(['0.16.14', '0.16.13', '0.17.0'])
        expect(catalog.versions[0]).toMatchObject({ recommended: true, stable: true })
        expect(catalog.versions[2]).toMatchObject({ latest: true, stable: false })
    })

    it('falls back to a recent stale value but rejects expired cache', async () => {
        let now = 0
        let available = true
        const fetcher: CatalogFetch = async () => {
            if (!available) {
                throw new Error('offline')
            }
            return jsonResponse({
                versions: [{ id: '1.21.5', type: 'release', releaseTime: '2025-03-25T12:00:00Z' }]
            })
        }
        const service = new VersionCatalogService(fetcher, () => now)

        await expect(service.getMinecraftVersions()).resolves.toMatchObject({ stale: false })
        available = false
        now = 16 * 60 * 1_000
        await expect(service.getMinecraftVersions()).resolves.toMatchObject({ stale: true })
        now = 24 * 60 * 60 * 1_000 + 1
        await expect(service.getMinecraftVersions()).rejects.toBeInstanceOf(VersionCatalogUnavailableError)
    })

    it('aborts an upstream request after the configured timeout', async () => {
        const fetcher: CatalogFetch = async (_url, init) => {
            const signal = init?.signal
            if (!signal) {
                throw new Error('Expected an abort signal')
            }
            return new Promise<Response>((_resolve, reject) => {
                if (signal.aborted) {
                    reject(new Error('aborted'))
                    return
                }
                signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
            })
        }
        const service = new VersionCatalogService(fetcher, Date.now, 1)

        await expect(service.getMinecraftVersions()).rejects.toBeInstanceOf(VersionCatalogUnavailableError)
    })

    it('shares an in-flight upstream request for the same cache key', async () => {
        let requests = 0
        let releaseRequest = (): void => undefined
        const requestGate = new Promise<void>(resolve => {
            releaseRequest = resolve
        })
        const fetcher: CatalogFetch = async url => {
            requests += 1
            await requestGate
            if (url.includes('maven-metadata.xml')) {
                return new Response('<metadata><versioning><versions><version>1.20.1-47.4.0</version></versions></versioning></metadata>')
            }
            return jsonResponse({
                promos: {
                    '1.20.1-recommended': '47.4.0',
                    '1.20.1-latest': '47.4.0'
                }
            })
        }
        const service = new VersionCatalogService(fetcher)
        const first = service.getLoaderVersions('forge', '1.20.1')
        const second = service.getLoaderVersions('forge', '1.20.1')

        await Promise.resolve()
        expect(requests).toBe(2)
        releaseRequest()
        await expect(Promise.all([first, second])).resolves.toHaveLength(2)
        expect(requests).toBe(2)
    })
})
