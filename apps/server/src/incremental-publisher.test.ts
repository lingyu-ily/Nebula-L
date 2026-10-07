import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
import { ZipArchive } from 'archiver'
import { Type, type Module } from 'helios-distribution-types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), download: vi.fn(), verify: vi.fn(), copy: vi.fn(), upload: vi.fn() }))
vi.mock('./db/index.js', () => ({ getPool: (): unknown => ({ execute: mocks.execute }) }))
vi.mock('./config.js', () => ({ getConfig: (): unknown => ({
    rustfs: { publicBaseUrl: 'https://cdn.test/bucket' }, javaExecutable: 'java'
}) }))
vi.mock('./storage.js', async () => ({
    ...await vi.importActual<typeof import('./storage.js')>('./storage.js'),
    downloadToFile: mocks.download, verifyStoredUpload: mocks.verify, copyStoredUpload: mocks.copy, uploadFile: mocks.upload
}))

import { applyModuleSettings, buildIncrementalServer, loaderCacheKey, moduleParseKey, rewriteGeneratedModules } from './incremental-publisher.js'
import { PublishCache, publishedObjectIdentity, publishedObjectKey } from './publish-cache.js'
import { createPublishMetrics } from './publish-metrics.js'
import type { ProjectSnapshot, SnapshotModule, SnapshotServer, SnapshotUpload } from './publisher.js'
import { contentChanged } from './save-change.js'

function source(index: number, type: SnapshotModule['type'] = 'FabricMod'): SnapshotModule {
    const name = `mod-${index}.jar`
    return {
        id: `module-${index}`, type, displayName: name, fileName: name, moduleId: null,
        relativePath: type === 'File' ? `config/${name}` : null, optionalMode: 'REQUIRED',
        sortOrder: index, validateChecksum: true, needsManualFile: false,
        upload: { id: `upload-${index}`, objectKey: `private/${index}`, originalName: name, mimeType: 'application/java-archive',
            size: 10, md5: String(index).padStart(32, '0'), sha256: String(index).padStart(64, '0') }
    }
}

function server(modules: SnapshotModule[] = []): SnapshotServer {
    return {
        id: 'server-1', revision: 1, serverKey: 'survival', name: 'Survival', description: '', minecraftVersion: '1.20.1',
        serverVersion: '1', address: 'localhost:25565', discord: null, forgeVersion: null, fabricVersion: null,
        mainServer: true, autoconnect: false, sortOrder: 0, javaOptions: null, icon: null,
        launcherUi: { background: null, logo: null, video: null, eyebrow: '', title: '', tagline: '', rss: '' },
        untrackedRules: [], modules
    }
}

function snapshot(value: SnapshotServer): ProjectSnapshot {
    return { id: 'project', slug: 'test', name: 'Test', description: '', rss: '', discord: null, sourceDraftVersion: 1, servers: [value] }
}

function template(module: SnapshotModule): Module {
    return { id: `test:${module.id}:1`, name: module.displayName, type: module.type as Type,
        artifact: { url: `https://nebula.invalid/${module.fileName}`, size: 10, MD5: module.upload!.md5 } }
}

function seedObject(cache: PublishCache, upload: SnapshotUpload, mime = 'application/java-archive'): string {
    const id = publishedObjectIdentity(upload.sha256, mime)
    const key = publishedObjectKey(cache.slug, upload.sha256, mime)
    cache.objects.set(id, { ...upload, id, objectKey: key, contentType: mime, verified: true })
    return key
}

async function fabricJar(): Promise<Buffer> {
    const archive = new ZipArchive()
    archive.append(JSON.stringify({ schemaVersion: 1, id: 'example', version: '2.0', name: 'Example' }), { name: 'fabric.mod.json' })
    const done = archive.finalize()
    const chunks: Buffer[] = []
    for await (const chunk of archive) chunks.push(Buffer.from(chunk as Uint8Array))
    await done
    return Buffer.concat(chunks)
}

const directories: string[] = []
beforeEach(() => {
    vi.clearAllMocks()
    mocks.execute.mockResolvedValue([[]])
    mocks.verify.mockResolvedValue(undefined)
    mocks.copy.mockImplementation(async (_source: string, key: string, _mime: string, upload: SnapshotUpload) => ({ ...upload, objectKey: key }))
})
afterEach(async () => {
    for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

describe('incremental server publishing', () => {
    it('applies current text, ordering, paths and optional settings without any file transfer', async () => {
        const first = source(1)
        const second = source(2, 'File')
        const value = server([second, first])
        value.name = 'Renamed'
        value.address = 'new.example:25565'
        value.launcherUi.title = 'New title'
        value.revision = 99
        first.optionalMode = 'OPTIONAL_OFF'
        first.sortOrder = 10
        second.relativePath = 'config/new.cfg'
        second.validateChecksum = false
        const cache = new PublishCache('project', 'test', 'job', createPublishMetrics())
        cache.parsed.set(moduleParseKey(value, first), template(first))
        const oldUrl = `https://cdn.test/bucket/${seedObject(cache, first.upload!)}`
        seedObject(cache, second.upload!)

        const result = await buildIncrementalServer(cache, snapshot(value), value)

        expect(result).toMatchObject({ name: 'Renamed', address: 'new.example:25565', ui: { hero: { title: 'New title' } } })
        expect(result.modules.map(module => module.type)).toEqual([Type.File, Type.FabricMod])
        expect(result.modules[0].artifact).toMatchObject({ path: 'config/new.cfg' })
        expect(result.modules[0].artifact.MD5).toBeUndefined()
        expect(result.modules[1]).toMatchObject({ required: { value: false, def: false }, artifact: { url: oldUrl } })
        expect(mocks.download).not.toHaveBeenCalled()
        expect(mocks.copy).not.toHaveBeenCalled()
        expect(mocks.upload).not.toHaveBeenCalled()
        expect(mocks.verify).not.toHaveBeenCalled()
    })

    it('downloads and parses just one changed JAR among one hundred, reusing loader dependencies', async () => {
        const values = Array.from({ length: 100 }, (_, index) => source(index))
        const value = server(values)
        value.fabricVersion = '0.16.0'
        const cache = new PublishCache('project', 'test', 'job', createPublishMetrics())
        for (const entry of values) {
            cache.parsed.set(moduleParseKey(value, entry), template(entry))
            seedObject(cache, entry.upload!)
        }
        cache.loaders.set(loaderCacheKey(value), { modules: [{
            id: 'net.fabricmc:fabric-loader:0.16.0', name: 'Fabric Loader', type: Type.Fabric,
            artifact: { url: 'https://vendor.test/fabric-loader.jar', size: 10 },
            subModules: [{ id: 'fabric-profile', name: 'Fabric profile', type: Type.VersionManifest,
                artifact: { url: 'https://vendor.test/profile.json', size: 10 } }]
        }], objectIds: [] })
        const bytes = await fabricJar()
        values[57] = { ...values[57], upload: { ...values[57].upload!, size: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'), md5: createHash('md5').update(bytes).digest('hex') } }
        mocks.download.mockImplementation(async (_key: string, path: string) => writeFile(path, bytes))

        const result = await buildIncrementalServer(cache, snapshot(value), value)

        expect(result.modules).toHaveLength(101)
        expect(result.modules[0]).toMatchObject({ type: Type.Fabric, subModules: [{ type: Type.VersionManifest }] })
        expect(result.modules[58]).toMatchObject({ name: 'Example', id: 'generated.fabricmod:example:2.0@jar' })
        expect(mocks.download).toHaveBeenCalledTimes(1)
        expect(mocks.copy).toHaveBeenCalledTimes(1)
        expect(mocks.upload).not.toHaveBeenCalled()
        expect(cache.metrics).toMatchObject({ parseCacheHits: 99, loaderCacheHits: 1, objectCacheHits: 99 })
    })

    it('deduplicates identical content from different upload IDs and servers', async () => {
        const first = source(1, 'File')
        const cache = new PublishCache('project', 'test', 'job', createPublishMetrics())
        await buildIncrementalServer(cache, snapshot(server([first])), server([first]))
        const second = { ...first, upload: { ...first.upload!, id: 'another-upload', objectKey: 'private/another' } }
        await buildIncrementalServer(cache, snapshot(server([second])), { ...server([second]), id: 'server-2' })
        expect(mocks.copy).toHaveBeenCalledTimes(1)
        expect(mocks.download).not.toHaveBeenCalled()
        expect(cache.objects.size).toBe(1)
    })

    it('publishes only a changed image without downloading source files', async () => {
        const value = server()
        value.launcherUi.background = { ...source(1).upload!, mimeType: 'image/png' }
        const cache = new PublishCache('project', 'test', 'job', createPublishMetrics())
        const result = await buildIncrementalServer(cache, snapshot(value), value)
        expect(result.ui?.hero?.background).toContain('/objects/')
        expect(mocks.copy).toHaveBeenCalledTimes(1)
        expect(mocks.download).not.toHaveBeenCalled()
    })

    it('invalidates parsing for filenames/types/environment, but not text or installation settings', () => {
        const module = source(1)
        const value = server([module])
        const key = moduleParseKey(value, module)
        expect(moduleParseKey({ ...value, name: 'Other', revision: 2 }, { ...module, optionalMode: 'OPTIONAL_OFF', sortOrder: 20 })).toBe(key)
        expect(moduleParseKey(value, { ...module, fileName: 'renamed.jar' })).not.toBe(key)
        expect(moduleParseKey(value, { ...module, type: 'Library' })).not.toBe(key)
        expect(moduleParseKey({ ...value, minecraftVersion: '1.21.1' }, module)).not.toBe(key)
        expect(loaderCacheKey({ ...value, fabricVersion: '0.16.0' })).not.toBe(loaderCacheKey(value))
    })

    it('tracks and rewrites nested generated artifacts while preserving third-party URLs', async () => {
        const root = await mkdtemp(join(tmpdir(), 'nebula-generated-test-'))
        directories.push(root)
        await writeFile(join(root, 'library.jar'), 'library')
        const cache = new PublishCache('project', 'test', 'job', createPublishMetrics())
        mocks.upload.mockImplementation(async (_path: string, key: string) => ({ objectKey: key }))
        const child: Module = { id: 'child', name: 'Child', type: Type.Library, artifact: { url: 'https://nebula.invalid/library.jar', size: 7 } }
        const modules: Module[] = [{ id: 'loader', name: 'Loader', type: Type.Fabric, artifact: { url: 'https://vendor.test/profile.json', size: 1 }, subModules: [child] }]
        const refs = await rewriteGeneratedModules(modules, root, cache)
        expect(refs).toHaveLength(1)
        expect(child.artifact.url).toContain('/objects/')
        expect(modules[0].artifact.url).toBe('https://vendor.test/profile.json')
    })

    it('applies untracked patterns and checksum changes without mutating cached templates', () => {
        const entry = source(1, 'File')
        const value = server([entry])
        value.untrackedRules = [{ appliesTo: 'files', pattern: 'config/**' }]
        const parsed = template(entry)
        expect(applyModuleSettings(parsed, entry, 'https://cdn.test/object', value).artifact.MD5).toBeUndefined()
        expect(parsed.artifact.MD5).toBe(entry.upload!.md5)
        expect(contentChanged({ options: { a: 1, b: 2 } }, { options: { b: 2, a: 1 } })).toBe(false)
    })
})
