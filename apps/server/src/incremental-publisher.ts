import { mkdir, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join, resolve, sep } from 'path'
import { minimatch } from 'minimatch'
import { Type, type Module } from 'helios-distribution-types'
import {
    DistributionStructure, FabricModStructure, LibraryStructure, MinecraftVersion, VersionSegmentedRegistry, type LauncherServer
} from '../../../dist/core.js'
import { getConfig } from './config.js'
import { PermanentJobError } from './job-errors.js'
import { PublishCache, fingerprint } from './publish-cache.js'
import {
    contentType, effectiveVersionId, getModuleRelativePath, mapWithConcurrency, materializeSnapshot, snapshotAssetError,
    type ProjectSnapshot, type SnapshotModule, type SnapshotServer, type SnapshotUpload
} from './publisher.js'
import { downloadToFile, verifyStoredUpload } from './storage.js'

// Bump when generator or Claritas semantics change, independently of draft revisions.
export const PUBLISH_GENERATOR_VERSION = 1
const PARSE_BASE_URL = 'https://nebula.invalid/'
const IO_CONCURRENCY = 8

export function moduleParseKey(server: SnapshotServer, module: SnapshotModule): string {
    return fingerprint([
        PUBLISH_GENERATOR_VERSION, module.upload?.sha256,
        module.fileName ?? module.upload?.originalName, module.type,
        server.minecraftVersion, server.forgeVersion, server.fabricVersion
    ])
}

export function loaderCacheKey(server: SnapshotServer): string {
    // Current resolvers depend only on Minecraft + loader versions, not uploaded
    // mods. OptiFine's filename-specific parsing is covered by moduleParseKey.
    return fingerprint([PUBLISH_GENERATOR_VERSION, server.minecraftVersion, server.forgeVersion, server.fabricVersion])
}

export function applyModuleSettings(template: Module, source: SnapshotModule, url: string, server: SnapshotServer): Module {
    const module = structuredClone(template)
    module.artifact.url = url
    module.artifact.size = source.upload!.size
    module.artifact.MD5 = source.upload!.md5
    delete module.required
    if (source.optionalMode === 'OPTIONAL_ON') module.required = { value: false }
    if (source.optionalMode === 'OPTIONAL_OFF') module.required = { value: false, def: false }
    const logicalPath = getModuleRelativePath(source).split(sep).join('/')
    const [category, ...segments] = logicalPath.split('/')
    const untracked = server.untrackedRules.some(rule =>
        rule.appliesTo === category && minimatch(segments.join('/'), rule.pattern))
    if (untracked || (source.type === 'File' && !source.validateChecksum)) delete module.artifact.MD5
    if (source.type === 'File') module.artifact.path = (source.relativePath ?? source.fileName ?? source.upload!.originalName).replaceAll('\\', '/')
    return module
}

function publicUrl(key: string): string {
    return `${getConfig().rustfs.publicBaseUrl}/${key}`
}

async function publishSource(cache: PublishCache, server: SnapshotServer, label: string, upload: SnapshotUpload, mime: string): Promise<string> {
    try {
        const object = await cache.source(upload, mime)
        return publicUrl(object.objectKey)
    } catch (error) {
        throw snapshotAssetError(server.name, label, upload.id, error)
    }
}

export async function parseMissingModules(cache: PublishCache, server: SnapshotServer, workspace: string): Promise<void> {
    const missing = new Map<string, SnapshotModule>()
    for (const module of server.modules) {
        if (module.type === 'File') continue
        const key = moduleParseKey(server, module)
        if (!cache.parsed.has(key)) missing.set(key, module)
        else cache.metrics.parseCacheHits++
    }
    for (const type of ['ForgeMod', 'FabricMod', 'Library'] as const) {
        const remaining = [...missing.entries()].filter(([, module]) => module.type === type)
        let batchId = 0
        while (remaining.length > 0) {
            // A single Claritas invocation handles all unique filenames in a batch.
            const names = new Set<string>()
            const batch: [string, SnapshotModule][] = []
            for (let index = 0; index < remaining.length;) {
                const entry = remaining[index]
                const name = (entry[1].fileName ?? entry[1].upload!.originalName).toLowerCase()
                if (names.has(name)) { index++; continue }
                names.add(name)
                batch.push(entry)
                remaining.splice(index, 1)
            }
            const root = join(workspace, 'parse', type, String(batchId++))
            const category = type === 'ForgeMod' ? 'forgemods' : type === 'FabricMod' ? 'fabricmods' : 'libraries'
            const directory = join(root, category, ...(type === 'Library' ? [] : ['required']))
            await mkdir(directory, { recursive: true })
            if (type !== 'Library') {
                await Promise.all(['optionalon', 'optionaloff'].map(namespace => mkdir(join(root, category, namespace), { recursive: true })))
            }
            await mapWithConcurrency(batch, IO_CONCURRENCY, async ([, module]) => {
                const upload = module.upload!
                try {
                    await verifyStoredUpload(upload.objectKey, upload)
                    await downloadToFile(upload.objectKey, join(directory, module.fileName ?? upload.originalName))
                } catch (error) {
                    throw snapshotAssetError(server.name, `module "${module.displayName}"`, upload.id, error)
                }
            })
            const minecraft = new MinecraftVersion(server.minecraftVersion)
            const parser = type === 'ForgeMod'
                ? VersionSegmentedRegistry.getForgeModStruct(minecraft, server.forgeVersion ?? '', root, '', PARSE_BASE_URL, [])
                : type === 'FabricMod'
                    ? new FabricModStructure(root, '', PARSE_BASE_URL, minecraft, [])
                    : new LibraryStructure(root, '', PARSE_BASE_URL, minecraft, [])
            const parsed = await parser.getSpecModel()
            const byName = new Map(parsed.map(module => [basename(decodeURIComponent(new URL(module.artifact.url).pathname)).toLowerCase(), module]))
            for (const [key, module] of batch) {
                const template = byName.get((module.fileName ?? module.upload!.originalName).toLowerCase())
                if (!template) throw new PermanentJobError(`Module ${module.displayName} did not produce a module spec`)
                await cache.saveParsed(key, template)
            }
        }
    }
}

export async function rewriteGeneratedModules(modules: Module[], root: string, cache: PublishCache): Promise<string[]> {
    const references = new Set<string>()
    async function visit(module: Module): Promise<void> {
        if (module.artifact.url.startsWith(PARSE_BASE_URL)) {
            const relativePath = decodeURIComponent(new URL(module.artifact.url).pathname).slice(1)
            const path = resolve(root, relativePath)
            if (!path.startsWith(`${resolve(root)}${sep}`)) throw new PermanentJobError('Generated artifact escapes its workspace')
            const object = await cache.generated(path, contentType(path))
            references.add(object.id)
            module.artifact.url = publicUrl(object.objectKey)
        }
        for (const child of module.subModules ?? []) await visit(child)
    }
    for (const module of modules) await visit(module)
    return [...references]
}

async function loaderModules(cache: PublishCache, snapshot: ProjectSnapshot, server: SnapshotServer, workspace: string): Promise<Module[]> {
    if (!server.forgeVersion && !server.fabricVersion) return []
    const key = loaderCacheKey(server)
    const existing = cache.loaders.get(key)
    if (existing?.objectIds.every(id => cache.objects.get(id)?.verified)) {
        cache.metrics.loaderCacheHits++
        for (const id of existing.objectIds) await cache.reference(cache.objects.get(id)!)
        return structuredClone(existing.modules)
    }
    const root = join(workspace, 'loader')
    const emptyServer: SnapshotServer = {
        ...server, modules: [], icon: null, untrackedRules: [],
        launcherUi: { background: null, logo: null, video: null, eyebrow: '', title: '', tagline: '', rss: '' }
    }
    await materializeSnapshot({ ...snapshot, servers: [emptyServer] }, root)
    const previousRoot = process.env.ROOT
    process.env.ROOT = root
    let modules: Module[]
    try {
        const generated = await new DistributionStructure(root, PARSE_BASE_URL, false, false).getSpecModel()
        modules = generated.servers[0]?.modules ?? []
        if (modules.length === 0) throw new PermanentJobError(`Server ${server.name} did not produce loader modules`)
    } finally {
        if (previousRoot == null) delete process.env.ROOT
        else process.env.ROOT = previousRoot
    }
    const objectIds = await rewriteGeneratedModules(modules, root, cache)
    await cache.saveLoader(key, { modules, objectIds })
    return modules
}

export async function buildIncrementalServer(cache: PublishCache, snapshot: ProjectSnapshot, server: SnapshotServer): Promise<ProjectSnapshotServerSpec> {
    const workspace = await mkdtemp(join(tmpdir(), 'nebula-incremental-'))
    const previousJava = process.env.JAVA_EXECUTABLE
    process.env.JAVA_EXECUTABLE = getConfig().javaExecutable
    try {
        await parseMissingModules(cache, server, workspace)
        const modules = await loaderModules(cache, snapshot, server, workspace)
        const typeOrder = { ForgeMod: 0, FabricMod: 1, Library: 2, File: 3 }
        const sources = [...server.modules].sort((left, right) =>
            left.sortOrder - right.sortOrder || typeOrder[left.type] - typeOrder[right.type]
            || getModuleRelativePath(left).localeCompare(getModuleRelativePath(right)))
        for (const source of sources) {
            const fileName = source.fileName ?? source.upload!.originalName
            const template: Module = source.type === 'File'
                ? { id: basename(source.relativePath ?? fileName), name: basename(source.relativePath ?? fileName), type: Type.File, artifact: { url: '', size: source.upload!.size } }
                : cache.parsed.get(moduleParseKey(server, source))!
            const url = await publishSource(cache, server, `module "${source.displayName}"`, source.upload!, contentType(fileName))
            modules.push(applyModuleSettings(template, source, url, server))
        }
        const image = async (label: string, upload: SnapshotUpload | null): Promise<string | undefined> =>
            upload ? publishSource(cache, server, label, upload, upload.mimeType.toLowerCase()) : undefined
        const icon = await image('icon', server.icon)
        const background = await image('launcher background', server.launcherUi.background)
        const logo = await image('launcher logo', server.launcherUi.logo)
        const video = server.launcherUi.video?.source === 'upload'
            ? { type: 'file' as const,
                url: await publishSource(cache, server, 'launcher video', server.launcherUi.video.upload, server.launcherUi.video.upload.mimeType.toLowerCase()),
                sha256: server.launcherUi.video.upload.sha256, size: server.launcherUi.video.upload.size,
                contentType: server.launcherUi.video.upload.mimeType.toLowerCase() as 'video/mp4' | 'video/webm' }
            : server.launcherUi.video?.source === 'youtube'
                ? { type: 'youtube' as const, videoId: server.launcherUi.video.videoId } : undefined
        const hero = {
            ...(background ? { background } : {}), ...(logo ? { logo } : {}), ...(video ? { video } : {}),
            ...(server.launcherUi.eyebrow ? { eyebrow: server.launcherUi.eyebrow } : {}),
            ...(server.launcherUi.title ? { title: server.launcherUi.title } : {}),
            ...(server.launcherUi.tagline ? { tagline: server.launcherUi.tagline } : {})
        }
        const ui = {
            ...(Object.keys(hero).length ? { hero } : {}),
            ...(server.launcherUi.rss ? { news: { rss: server.launcherUi.rss } } : {})
        }
        return {
            id: effectiveVersionId(server),
            ...(server.versionName ? { versionName: server.versionName, loaderLabel: server.forgeVersion ? `Forge ${server.forgeVersion}` : server.fabricVersion ? `Fabric ${server.fabricVersion}` : 'Vanilla' } : {}), name: server.name, description: server.description,
            icon: icon ?? '', version: server.serverVersion, address: server.address, minecraftVersion: server.minecraftVersion,
            ...(server.discord ? { discord: server.discord as ProjectSnapshotServerSpec['discord'] } : {}),
            mainServer: server.mainServer, autoconnect: server.autoconnect,
            ...(server.javaOptions ? { javaOptions: server.javaOptions as ProjectSnapshotServerSpec['javaOptions'] } : {}),
            ...(Object.keys(ui).length ? { ui } : {}), modules
        }
    } finally {
        if (previousJava == null) delete process.env.JAVA_EXECUTABLE
        else process.env.JAVA_EXECUTABLE = previousJava
        await rm(workspace, { recursive: true, force: true })
    }
}

type ProjectSnapshotServerSpec = LauncherServer
