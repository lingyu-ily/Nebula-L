import { randomUUID } from 'crypto'
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, extname, join, relative, sep } from 'path'
import { Type, type Distribution, type Module } from 'helios-distribution-types'
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import {
    CurseForgeParser,
    MinecraftVersion,
    ServerStructure
} from '../../../dist/core.js'
import { writeAudit } from './audit.js'
import { getConfig } from './config.js'
import { getPool, withTransaction } from './db/index.js'
import { PermanentJobError, shouldRetryJob } from './job-errors.js'
import { LAUNCHER_USAGE_TIME_ZONE } from './launcher-usage.js'
import { buildIncrementalServer } from './incremental-publisher.js'
import { PublishCache } from './publish-cache.js'
import { publishServerDistribution, type ServerDistributionReference } from './server-distribution.js'
import { cleanupProjectStorage, commitManifest, reconcileManifest } from './publish-cleanup.js'
import { createPublishMetrics, withPublishMetrics, type PublishMetrics } from './publish-metrics.js'
import { ProjectStorageBusyError, withProjectStorageLock } from './project-storage-lock.js'
import {
    normalizeYouTubeVideoId
} from './launcher-video.js'
import {
    downloadToFile,
    isStorageObjectIntegrityError,
    isStorageObjectMissingError,
    putJson,
    verifyStoredUpload,
    uploadFile,
    type StoredObject
} from './storage.js'
import {
    assertStableDistribution,
    getStableDistributionKey,
    STABLE_CACHE_CONTROL
} from './stable-distribution.js'

export interface SnapshotUpload {
    id: string
    objectKey: string
    originalName: string
    mimeType: string
    size: number
    md5: string
    sha256: string
}

export interface SnapshotModule {
    id: string
    type: 'ForgeMod' | 'FabricMod' | 'Library' | 'File'
    displayName: string
    fileName: string | null
    moduleId: string | null
    relativePath: string | null
    optionalMode: 'REQUIRED' | 'OPTIONAL_ON' | 'OPTIONAL_OFF'
    sortOrder: number
    validateChecksum: boolean
    needsManualFile: boolean
    upload: SnapshotUpload | null
}

export interface SnapshotServer {
    id: string
    revision: number
    serverKey: string
    name: string
    description: string
    minecraftVersion: string
    serverVersion: string
    address: string
    discord: unknown
    forgeVersion: string | null
    fabricVersion: string | null
    mainServer: boolean
    autoconnect: boolean
    sortOrder: number
    javaOptions: unknown
    icon: SnapshotUpload | null
    launcherUi: {
        background: SnapshotUpload | null
        logo: SnapshotUpload | null
        video:
            | { source: 'upload', upload: SnapshotUpload }
            | { source: 'external', url: string }
            | { source: 'youtube', url: string, videoId: string }
            | null
        eyebrow: string
        title: string
        tagline: string
        rss: string
    }
    untrackedRules: { appliesTo: string, pattern: string }[]
    modules: SnapshotModule[]
}

export interface ProjectSnapshot {
    id: string
    slug: string
    name: string
    description: string
    rss: string
    discord: unknown
    sourceDraftVersion: number
    servers: SnapshotServer[]
}

export interface JobRow extends RowDataPacket {
    id: string
    project_id: string
    kind: 'PUBLISH' | 'CURSEFORGE_IMPORT'
    status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
    snapshot: ProjectSnapshot | string | Record<string, unknown>
    attempts: number
    max_attempts: number
    created_by: string
}

interface ActorRow extends RowDataPacket {
    id: string
    username: string
    role: 'ADMIN' | 'EDITOR' | 'AUDITOR'
}

interface ProjectSnapshotRow extends RowDataPacket {
    id: string
    slug: string
    name: string
    description: string
    rss: string
    discord: unknown
    draft_revision: number
    disabled: number
}

interface ServerSnapshotRow extends RowDataPacket {
    id: string
    revision: number
    server_key: string
    name: string
    description: string
    minecraft_version: string
    server_version: string
    address: string
    discord: unknown
    forge_version: string | null
    fabric_version: string | null
    main_server: number
    autoconnect: number
    sort_order: number
    java_options: unknown
    icon_upload_id: string | null
    icon_object_key: string | null
    icon_original_name: string | null
    icon_mime_type: string | null
    icon_size: number | null
    icon_md5: string | null
    icon_sha256: string | null
    hero_background_upload_id: string | null
    hero_background_object_key: string | null
    hero_background_original_name: string | null
    hero_background_mime_type: string | null
    hero_background_size: number | null
    hero_background_md5: string | null
    hero_background_sha256: string | null
    hero_logo_upload_id: string | null
    hero_logo_object_key: string | null
    hero_logo_original_name: string | null
    hero_logo_mime_type: string | null
    hero_logo_size: number | null
    hero_logo_md5: string | null
    hero_logo_sha256: string | null
    hero_video_source: 'upload' | 'external' | 'youtube' | null
    hero_video_upload_id: string | null
    hero_video_url: string | null
    hero_video_object_key: string | null
    hero_video_original_name: string | null
    hero_video_mime_type: string | null
    hero_video_size: number | null
    hero_video_md5: string | null
    hero_video_sha256: string | null
    hero_eyebrow: string | null
    hero_title: string | null
    hero_tagline: string | null
    news_rss: string | null
}

interface ModuleSnapshotRow extends RowDataPacket {
    id: string
    server_id: string
    upload_id: string | null
    type: SnapshotModule['type']
    display_name: string
    file_name: string | null
    module_id: string | null
    relative_path: string | null
    optional_mode: SnapshotModule['optionalMode']
    sort_order: number
    validate_checksum: number
    needs_manual_file: number
    object_key: string | null
    original_name: string | null
    mime_type: string | null
    size: number | null
    md5: string | null
    sha256: string | null
}

interface RuleSnapshotRow extends RowDataPacket {
    server_id: string
    applies_to: string
    pattern: string
}

function parseJson<T>(value: T | string | null): T | null {
    if (value == null || typeof value !== 'string') {
        return value
    }
    return JSON.parse(value) as T
}

function parseProjectSnapshot(value: JobRow['snapshot']): ProjectSnapshot {
    const snapshot = parseJson(value) as (ProjectSnapshot & { draftRevision?: number }) | null
    const sourceDraftVersion = snapshot?.sourceDraftVersion ?? snapshot?.draftRevision
    if (!snapshot || typeof sourceDraftVersion !== 'number' || !Number.isInteger(sourceDraftVersion) || sourceDraftVersion < 0) {
        throw new Error('Publish snapshot does not contain a valid draft version')
    }
    return {
        ...snapshot,
        sourceDraftVersion,
        servers: snapshot.servers.map(server => ({ ...server, revision: server.revision ?? 0 }))
    }
}

const PUBLISH_IO_CONCURRENCY = 8

export async function mapWithConcurrency<T, R>(
    values: readonly T[],
    concurrency: number,
    operation: (value: T, index: number) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(values.length)
    let nextIndex = 0
    async function worker(): Promise<void> {
        while (nextIndex < values.length) {
            const index = nextIndex++
            results[index] = await operation(values[index], index)
        }
    }
    const completed = await Promise.allSettled(Array.from(
        { length: Math.min(concurrency, values.length) },
        () => worker()
    ))
    const failure = completed.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw failure.reason
    return results
}

const LAUNCHER_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const LAUNCHER_VIDEO_TYPES = new Set(['video/mp4', 'video/webm'])

function snapshotUpload(
    serverKey: string,
    label: string,
    values: {
        id: string | null
        objectKey: string | null
        originalName: string | null
        mimeType: string | null
        size: number | null
        md5: string | null
        sha256: string | null
    },
    allowedTypes?: Set<string>
): SnapshotUpload | null {
    if (!values.id) {
        return null
    }
    if (!values.objectKey || !values.originalName || !values.mimeType || values.size == null || !values.md5 || !values.sha256) {
        throw new Error(`${label} for server ${serverKey} is unavailable`)
    }
    if (allowedTypes && !allowedTypes.has(values.mimeType.toLowerCase())) {
        throw new Error(`${label} for server ${serverKey} has an unsupported media type`)
    }
    return {
        id: values.id,
        objectKey: values.objectKey,
        originalName: values.originalName,
        mimeType: values.mimeType,
        size: Number(values.size),
        md5: values.md5,
        sha256: values.sha256
    }
}

function requiredSnapshotUpload(
    serverKey: string,
    label: string,
    values: Parameters<typeof snapshotUpload>[2],
    allowedTypes: Set<string>
): SnapshotUpload {
    const upload = snapshotUpload(serverKey, label, values, allowedTypes)
    if (!upload) {
        throw new Error(`${label} for server ${serverKey} is unavailable`)
    }
    return upload
}

export async function buildProjectSnapshot(connection: PoolConnection, projectId: string): Promise<ProjectSnapshot> {
    const [projectRows] = await connection.query<ProjectSnapshotRow[]>('SELECT * FROM projects WHERE id = ? FOR UPDATE', [projectId])
    const project = projectRows[0]
    if (!project || project.disabled) {
        throw new Error('Project not found')
    }
    const [serverRows] = await connection.query<ServerSnapshotRow[]>(
        `SELECT s.*, u.object_key AS icon_object_key, u.original_name AS icon_original_name,
                u.mime_type AS icon_mime_type, u.size AS icon_size, u.md5 AS icon_md5, u.sha256 AS icon_sha256,
                bg.object_key AS hero_background_object_key, bg.original_name AS hero_background_original_name,
                bg.mime_type AS hero_background_mime_type, bg.size AS hero_background_size,
                bg.md5 AS hero_background_md5, bg.sha256 AS hero_background_sha256,
                logo.object_key AS hero_logo_object_key, logo.original_name AS hero_logo_original_name,
                logo.mime_type AS hero_logo_mime_type, logo.size AS hero_logo_size,
                logo.md5 AS hero_logo_md5, logo.sha256 AS hero_logo_sha256,
                video.object_key AS hero_video_object_key, video.original_name AS hero_video_original_name,
                video.mime_type AS hero_video_mime_type, video.size AS hero_video_size,
                video.md5 AS hero_video_md5, video.sha256 AS hero_video_sha256
         FROM servers s
         LEFT JOIN uploads u ON u.id = s.icon_upload_id AND u.status = 'READY'
         LEFT JOIN uploads bg ON bg.id = s.hero_background_upload_id AND bg.status = 'READY'
         LEFT JOIN uploads logo ON logo.id = s.hero_logo_upload_id AND logo.status = 'READY'
         LEFT JOIN uploads video ON video.id = s.hero_video_upload_id AND video.status = 'READY'
         WHERE s.project_id = ? ORDER BY s.sort_order, s.name, s.id`,
        [projectId]
    )
    const [moduleRows] = await connection.query<ModuleSnapshotRow[]>(
        `SELECT m.*, u.object_key, u.original_name, u.mime_type, u.size, u.md5, u.sha256
         FROM modules m LEFT JOIN uploads u ON u.id = m.upload_id AND u.status = 'READY'
         WHERE m.project_id = ? ORDER BY m.server_id, m.sort_order, m.display_name`,
        [projectId]
    )
    const [rules] = await connection.query<RuleSnapshotRow[]>(
        `SELECT r.server_id, r.applies_to, r.pattern FROM untracked_rules r
         INNER JOIN servers s ON s.id = r.server_id WHERE s.project_id = ?`,
        [projectId]
    )
    return {
        id: project.id,
        slug: project.slug,
        name: project.name,
        description: project.description,
        rss: project.rss,
        discord: parseJson(project.discord),
        sourceDraftVersion: Number(project.draft_revision),
        servers: serverRows.map(server => ({
            id: server.id,
            revision: Number(server.revision),
            serverKey: server.server_key,
            name: server.name,
            description: server.description,
            minecraftVersion: server.minecraft_version,
            serverVersion: server.server_version,
            address: server.address,
            discord: parseJson(server.discord),
            forgeVersion: server.forge_version,
            fabricVersion: server.fabric_version,
            mainServer: Boolean(server.main_server),
            autoconnect: Boolean(server.autoconnect),
            sortOrder: server.sort_order,
            javaOptions: parseJson(server.java_options),
            icon: snapshotUpload(server.server_key, 'Icon', {
                id: server.icon_upload_id,
                objectKey: server.icon_object_key,
                originalName: server.icon_original_name,
                mimeType: server.icon_mime_type,
                size: server.icon_size,
                md5: server.icon_md5,
                sha256: server.icon_sha256
            }),
            launcherUi: {
                background: snapshotUpload(server.server_key, 'Background', {
                    id: server.hero_background_upload_id,
                    objectKey: server.hero_background_object_key,
                    originalName: server.hero_background_original_name,
                    mimeType: server.hero_background_mime_type,
                    size: server.hero_background_size,
                    md5: server.hero_background_md5,
                    sha256: server.hero_background_sha256
                }, LAUNCHER_IMAGE_TYPES),
                logo: snapshotUpload(server.server_key, 'Logo', {
                    id: server.hero_logo_upload_id,
                    objectKey: server.hero_logo_object_key,
                    originalName: server.hero_logo_original_name,
                    mimeType: server.hero_logo_mime_type,
                    size: server.hero_logo_size,
                    md5: server.hero_logo_md5,
                    sha256: server.hero_logo_sha256
                }, LAUNCHER_IMAGE_TYPES),
                video: server.hero_video_source === 'upload'
                    ? {
                        source: 'upload',
                        upload: requiredSnapshotUpload(server.server_key, 'Launcher video', {
                            id: server.hero_video_upload_id,
                            objectKey: server.hero_video_object_key,
                            originalName: server.hero_video_original_name,
                            mimeType: server.hero_video_mime_type,
                            size: server.hero_video_size,
                            md5: server.hero_video_md5,
                            sha256: server.hero_video_sha256
                        }, LAUNCHER_VIDEO_TYPES)
                    }
                    : server.hero_video_source === 'external' && server.hero_video_url
                        ? { source: 'external', url: server.hero_video_url }
                        : server.hero_video_source === 'youtube' && server.hero_video_url
                            ? {
                                source: 'youtube',
                                url: server.hero_video_url,
                                videoId: normalizeYouTubeVideoId(server.hero_video_url)
                            }
                            : null,
                eyebrow: server.hero_eyebrow ?? '',
                title: server.hero_title ?? '',
                tagline: server.hero_tagline ?? '',
                rss: server.news_rss ?? ''
            },
            untrackedRules: rules.filter(rule => rule.server_id === server.id).map(rule => ({
                appliesTo: rule.applies_to,
                pattern: rule.pattern
            })),
            modules: moduleRows.filter(module => module.server_id === server.id).map(module => ({
                id: module.id,
                type: module.type,
                displayName: module.display_name,
                fileName: module.file_name,
                moduleId: module.module_id,
                relativePath: module.relative_path,
                optionalMode: module.optional_mode,
                sortOrder: module.sort_order,
                validateChecksum: Boolean(module.validate_checksum),
                needsManualFile: Boolean(module.needs_manual_file),
                upload: module.upload_id && module.object_key ? {
                    id: module.upload_id,
                    objectKey: module.object_key,
                    originalName: module.original_name!,
                    mimeType: module.mime_type!,
                    size: Number(module.size),
                    md5: module.md5!,
                    sha256: module.sha256!
                } : null
            }))
        }))
    }
}

export function validateSnapshot(snapshot: ProjectSnapshot): void {
    if (snapshot.servers.length === 0) {
        throw new Error('A distribution must contain at least one server')
    }
    if (snapshot.servers.filter(server => server.mainServer).length !== 1) {
        throw new Error('A distribution must contain exactly one main server')
    }
    for (const server of snapshot.servers) {
        if (!Number.isInteger(server.revision) || server.revision < 0) {
            throw new PermanentJobError(`Server ${server.name} has an invalid revision`)
        }
        if (server.launcherUi.video?.source === 'external') {
            throw new PermanentJobError(
                `Server ${server.name} uses an external launcher video; remove it or replace it with an upload or YouTube video before publishing.`
            )
        }
        const destinations = new Set<string>()
        for (const module of server.modules) {
            if (module.needsManualFile || !module.upload) {
                throw new Error(`Module ${module.displayName} is waiting for a file`)
            }
            const destination = getModuleRelativePath(module).toLowerCase()
            if (destinations.has(destination)) {
                throw new Error(`Duplicate module path ${destination}`)
            }
            destinations.add(destination)
        }
    }
}

function namespace(mode: SnapshotModule['optionalMode']): string {
    if (mode === 'OPTIONAL_ON') {
        return 'optionalon'
    }
    if (mode === 'OPTIONAL_OFF') {
        return 'optionaloff'
    }
    return 'required'
}

export function getModuleRelativePath(module: SnapshotModule): string {
    const name = module.fileName ?? module.upload?.originalName ?? `${module.id}.missing`
    if (module.type === 'File') {
        return join('files', ...(module.relativePath ?? name).split('/'))
    }
    if (module.type === 'Library') {
        return join('libraries', name)
    }
    const root = module.type === 'ForgeMod' ? 'forgemods' : 'fabricmods'
    return join(root, namespace(module.optionalMode), name)
}

function launcherImageExtension(upload: SnapshotUpload): string {
    switch (upload.mimeType.toLowerCase()) {
        case 'image/jpeg': return '.jpg'
        case 'image/webp': return '.webp'
        default: return '.png'
    }
}

async function verifySnapshotAsset(
    server: SnapshotServer,
    label: string,
    upload: SnapshotUpload
): Promise<void> {
    try {
        await verifyStoredUpload(upload.objectKey, upload)
    } catch (error) {
        throw snapshotAssetError(server.name, label, upload.id, error)
    }
}

export function snapshotAssetError(
    serverName: string,
    label: string,
    uploadId: string,
    error: unknown
): unknown {
    if (isStorageObjectMissingError(error)) {
        return new PermanentJobError(
            `Server ${serverName} ${label} is missing (upload ${uploadId}); re-upload it before publishing.`
        )
    }
    if (isStorageObjectIntegrityError(error)) {
        return new PermanentJobError(
            `Server ${serverName} ${label} does not match upload ${uploadId}; re-upload it before publishing.`
        )
    }
    return error
}

export async function preflightSnapshotUploads(snapshot: ProjectSnapshot): Promise<void> {
    const assets = snapshot.servers.flatMap(server => [
        ...(server.icon ? [{ server, label: 'icon', upload: server.icon }] : []),
        ...(server.launcherUi.background
            ? [{ server, label: 'launcher background', upload: server.launcherUi.background }]
            : []),
        ...(server.launcherUi.logo
            ? [{ server, label: 'launcher logo', upload: server.launcherUi.logo }]
            : []),
        ...(server.launcherUi.video?.source === 'upload'
            ? [{ server, label: 'launcher video', upload: server.launcherUi.video.upload }]
            : []),
        ...server.modules.flatMap(module => module.upload
            ? [{ server, label: `module "${module.displayName}"`, upload: module.upload }]
            : [])
    ])
    await mapWithConcurrency(assets, PUBLISH_IO_CONCURRENCY, asset =>
        verifySnapshotAsset(asset.server, asset.label, asset.upload))
}

interface MaterializedLauncherVideo {
    relativePath?: string
    descriptor: {
        type: 'file'
        url: string
        sha256: string
        size: number
        contentType: 'video/mp4' | 'video/webm'
    } | {
        type: 'youtube'
        videoId: string
    }
    upload?: SnapshotUpload
}

function launcherVideoExtension(mimeType: string): '.mp4' | '.webm' {
    return mimeType.toLowerCase() === 'video/webm' ? '.webm' : '.mp4'
}

function prepareLauncherVideo(server: SnapshotServer): MaterializedLauncherVideo | null {
    const video = server.launcherUi.video
    if (!video) {
        return null
    }
    if (video.source === 'youtube') {
        return { descriptor: { type: 'youtube', videoId: video.videoId } }
    }
    if (video.source === 'upload') {
        const relativePath = `launcher/video${launcherVideoExtension(video.upload.mimeType)}`
        return {
            relativePath,
            upload: video.upload,
            descriptor: {
                type: 'file',
                url: relativePath,
                sha256: video.upload.sha256,
                size: video.upload.size,
                contentType: video.upload.mimeType.toLowerCase() as 'video/mp4' | 'video/webm'
            }
        }
    }
    throw new PermanentJobError(
        `Server ${server.name} uses an external launcher video; replace it with an upload or YouTube video.`
    )
}

export async function materializeSnapshot(snapshot: ProjectSnapshot, root: string): Promise<void> {
    await mkdir(join(root, 'meta'), { recursive: true })
    await writeFile(join(root, 'meta', 'distrometa.json'), JSON.stringify({
        meta: {
            rss: snapshot.rss,
            ...(snapshot.discord ? { discord: snapshot.discord } : {})
        }
    }, null, 2))
    for (const server of snapshot.servers) {
        const serverRoot = join(root, 'servers', `${server.serverKey}-${server.minecraftVersion}`)
        const video = prepareLauncherVideo(server)
        const backgroundPath = server.launcherUi.background
            ? `launcher/background${launcherImageExtension(server.launcherUi.background)}`
            : undefined
        const logoPath = server.launcherUi.logo
            ? `launcher/logo${launcherImageExtension(server.launcherUi.logo)}`
            : undefined
        const hero = {
            ...(backgroundPath ? { background: backgroundPath } : {}),
            ...(logoPath ? { logo: logoPath } : {}),
            ...(video ? { video: video.descriptor } : {}),
            ...(server.launcherUi.eyebrow ? { eyebrow: server.launcherUi.eyebrow } : {}),
            ...(server.launcherUi.title ? { title: server.launcherUi.title } : {}),
            ...(server.launcherUi.tagline ? { tagline: server.launcherUi.tagline } : {})
        }
        const launcherUi = {
            ...(Object.keys(hero).length > 0 ? { hero } : {}),
            ...(server.launcherUi.rss ? { news: { rss: server.launcherUi.rss } } : {})
        }
        await Promise.all([
            mkdir(join(serverRoot, 'files'), { recursive: true }),
            mkdir(join(serverRoot, 'libraries'), { recursive: true }),
            ...(backgroundPath || logoPath || video?.relativePath ? [mkdir(join(serverRoot, 'launcher'), { recursive: true })] : [])
        ])
        if (server.forgeVersion) {
            for (const value of ['required', 'optionalon', 'optionaloff']) {
                await mkdir(join(serverRoot, 'forgemods', value), { recursive: true })
            }
        }
        if (server.fabricVersion) {
            for (const value of ['required', 'optionalon', 'optionaloff']) {
                await mkdir(join(serverRoot, 'fabricmods', value), { recursive: true })
            }
        }
        const untrackedFiles = Object.entries(Object.groupBy(server.untrackedRules, rule => rule.appliesTo))
            .map(([appliesTo, values]) => ({ appliesTo: [appliesTo], patterns: values!.map(value => value.pattern) }))
        await writeFile(join(serverRoot, 'servermeta.json'), JSON.stringify({
            meta: {
                version: server.serverVersion,
                name: server.name,
                description: server.description,
                icon: '',
                address: server.address,
                ...(server.discord ? { discord: server.discord } : {}),
                mainServer: server.mainServer,
                autoconnect: server.autoconnect,
                ...(server.javaOptions ? { javaOptions: server.javaOptions } : {}),
                ...(Object.keys(launcherUi).length > 0 ? { ui: launcherUi } : {})
            },
            ...(server.forgeVersion ? { forge: { version: server.forgeVersion } } : {}),
            ...(server.fabricVersion ? { fabric: { version: server.fabricVersion } } : {}),
            untrackedFiles
        }, null, 2))
        const downloads: (() => Promise<void>)[] = []
        if (server.icon) {
            const iconExtension = ['.png', '.jpg', '.jpeg'].includes(extname(server.icon.originalName).toLowerCase())
                ? extname(server.icon.originalName).toLowerCase()
                : '.png'
            downloads.push(() => downloadToFile(server.icon!.objectKey, join(serverRoot, `icon${iconExtension}`)))
        }
        if (server.launcherUi.background && backgroundPath) {
            downloads.push(() => downloadToFile(
                server.launcherUi.background!.objectKey,
                join(serverRoot, ...backgroundPath.split('/'))
            ))
        }
        if (server.launcherUi.logo && logoPath) {
            downloads.push(() => downloadToFile(
                server.launcherUi.logo!.objectKey,
                join(serverRoot, ...logoPath.split('/'))
            ))
        }
        if (video?.relativePath && video.upload) {
            downloads.push(() => downloadToFile(
                video.upload!.objectKey,
                join(serverRoot, ...video.relativePath!.split('/'))
            ))
        }
        for (const module of server.modules) {
            const destination = join(serverRoot, getModuleRelativePath(module))
            downloads.push(async () => {
                await mkdir(dirname(destination), { recursive: true })
                await downloadToFile(module.upload!.objectKey, destination)
            })
        }
        await mapWithConcurrency(downloads, PUBLISH_IO_CONCURRENCY, download => download())
    }
}

function duplicateValues(values: string[]): string[] {
    const seen = new Set<string>()
    const duplicates = new Set<string>()
    for (const value of values) {
        if (seen.has(value)) {
            duplicates.add(value)
        }
        seen.add(value)
    }
    return [...duplicates]
}

export function orderDistribution(distribution: Distribution, snapshot: ProjectSnapshot): void {
    const snapshotServers = snapshot.servers.map(server => ({
        id: ServerStructure.getEffectiveId(server.serverKey, new MinecraftVersion(server.minecraftVersion)),
        server
    }))
    const snapshotIds = snapshotServers.map(value => value.id)
    const generatedIds = distribution.servers.map(server => server.id)
    const snapshotIdSet = new Set(snapshotIds)
    const generatedIdSet = new Set(generatedIds)
    const mismatches = [
        ['duplicate snapshot IDs', duplicateValues(snapshotIds)],
        ['duplicate generated IDs', duplicateValues(generatedIds)],
        ['missing generated IDs', snapshotIds.filter(id => !generatedIdSet.has(id))],
        ['unexpected generated IDs', generatedIds.filter(id => !snapshotIdSet.has(id))]
    ] as const
    const mismatchDetails = mismatches
        .filter(([, ids]) => ids.length > 0)
        .map(([label, ids]) => `${label}: ${ids.join(', ')}`)
    if (mismatchDetails.length > 0) {
        throw new PermanentJobError(`Generated distribution server IDs do not match snapshot (${mismatchDetails.join('; ')})`)
    }

    const serverOrder = new Map(snapshotIds.map((id, index) => [id, index]))
    const sourceById = new Map(snapshotServers.map(value => [value.id, value.server]))
    distribution.servers.sort((left, right) => serverOrder.get(left.id)! - serverOrder.get(right.id)!)
    for (const server of distribution.servers) {
        const source = sourceById.get(server.id)!
        const moduleOrder = new Map(source.modules.map(module => [module.upload?.originalName.toLowerCase(), module.sortOrder]))
        server.modules.sort((left: Module, right: Module) => {
            const leftName = basename(left.artifact.url).toLowerCase()
            const rightName = basename(right.artifact.url).toLowerCase()
            return (moduleOrder.get(leftName) ?? -1000) - (moduleOrder.get(rightName) ?? -1000)
        })
    }
}

function normalizedArtifactPath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

export function applyChecksumValidation(distribution: Distribution, snapshot: ProjectSnapshot): void {
    const sourceById = new Map(snapshot.servers.map(server => [
        ServerStructure.getEffectiveId(server.serverKey, new MinecraftVersion(server.minecraftVersion)),
        server
    ]))
    for (const server of distribution.servers) {
        const source = sourceById.get(server.id)
        if (!source) {
            throw new PermanentJobError(`Generated distribution server ID is missing from snapshot: ${server.id}`)
        }
        const unvalidatedPaths = new Set(source.modules
            .filter(module => module.type === 'File' && module.validateChecksum === false && module.relativePath != null)
            .map(module => normalizedArtifactPath(module.relativePath!)))
        for (const module of server.modules) {
            if (module.type === Type.File
                && module.artifact.path
                && unvalidatedPaths.has(normalizedArtifactPath(module.artifact.path))) {
                delete module.artifact.MD5
            }
        }
    }
}

async function listFiles(root: string): Promise<string[]> {
    const result: string[] = []
    async function walk(directory: string): Promise<void> {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name)
            if (entry.isDirectory()) {
                await walk(path)
            } else {
                result.push(path)
            }
        }
    }
    if ((await stat(root).catch(() => null))?.isDirectory()) {
        await walk(root)
    }
    return result
}

export function contentType(path: string): string {
    switch (extname(path).toLowerCase()) {
        case '.json': return 'application/json; charset=utf-8'
        case '.png': return 'image/png'
        case '.jpg':
        case '.jpeg': return 'image/jpeg'
        case '.webp': return 'image/webp'
        case '.mp4': return 'video/mp4'
        case '.webm': return 'video/webm'
        case '.jar': return 'application/java-archive'
        case '.zip': return 'application/zip'
        default: return 'application/octet-stream'
    }
}

async function heartbeat(jobId: string, progress: number): Promise<void> {
    await getPool().execute(
        'UPDATE jobs SET heartbeat_at = UTC_TIMESTAMP(3), progress = ? WHERE id = ?',
        [progress, jobId]
    )
}

type ServerSpec = Distribution['servers'][number]

export interface SelectedServerBuild {
    id: string
    serverId: string
    sourceRevision: number
    spec: ServerSpec
    objectPrefix: string
}

export interface ServerBuildSelection {
    reused: SelectedServerBuild[]
    dirtyServerIds: string[]
}

export function getServerBuildObjectPrefix(slug: string, serverId: string, publishJobId: string): string {
    return `public/${slug}/server-builds/${serverId}/${publishJobId}`
}

export function selectReusableServerBuilds(
    snapshot: ProjectSnapshot,
    builds: readonly SelectedServerBuild[]
): ServerBuildSelection {
    const cacheByRevision = new Map(builds.map(build => [
        `${build.serverId}:${build.sourceRevision}`,
        build
    ]))
    const reused: SelectedServerBuild[] = []
    const dirtyServerIds: string[] = []
    for (const server of snapshot.servers) {
        const cached = cacheByRevision.get(`${server.id}:${server.revision}`)
        const expectedServerId = ServerStructure.getEffectiveId(
            server.serverKey,
            new MinecraftVersion(server.minecraftVersion)
        )
        if (cached?.spec.id === expectedServerId) {
            reused.push(cached)
        } else {
            dirtyServerIds.push(server.id)
        }
    }
    return { reused, dirtyServerIds }
}

export interface PublishedDistribution extends Omit<Distribution, 'servers'> {
    distributionFormat: 2
    servers: ServerDistributionReference[]
    telemetry: {
        anonymousDailyActive: {
            endpoint: string
            timeZone: typeof LAUNCHER_USAGE_TIME_ZONE
        }
    }
}

export function buildLauncherTelemetry(appBaseUrl: string, slug: string): PublishedDistribution['telemetry'] {
    return {
        anonymousDailyActive: {
            endpoint: `${appBaseUrl.replace(/\/$/, '')}/api/v1/public/launcher-presence/${encodeURIComponent(slug)}`,
            timeZone: LAUNCHER_USAGE_TIME_ZONE
        }
    }
}

export async function activatePublish(
    job: JobRow,
    snapshot: ProjectSnapshot,
    stableObject: StoredObject,
    metrics?: PublishMetrics
): Promise<number> {
    return withTransaction(async connection => {
        const [actors] = await connection.query<ActorRow[]>('SELECT id, username, role FROM users WHERE id = ?', [job.created_by])
        const actor = actors[0]
        const [projects] = await connection.query<(RowDataPacket & { release_revision: number })[]>(
            'SELECT release_revision FROM projects WHERE id = ? AND disabled = FALSE FOR UPDATE',
            [job.project_id]
        )
        if (!projects[0]) {
            throw new Error('Project not found')
        }
        const releaseRevision = Number(projects[0].release_revision) + 1
        await connection.execute(
            `UPDATE projects SET release_revision = ?, active_release_id = ?, stable_distribution_size = ?,
             stable_distribution_sha256 = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
            [releaseRevision, job.id, stableObject.size, stableObject.sha256, job.project_id]
        )
        if (snapshot.servers.length) {
            await connection.execute(
                `UPDATE servers SET published_once = TRUE WHERE project_id = ? AND id IN (${snapshot.servers.map(() => '?').join(', ')})`,
                [job.project_id, ...snapshot.servers.map(server => server.id)]
            )
        }
        const result = {
            releaseRevision,
            currentPublishId: job.id,
            distributionKey: stableObject.objectKey,
            size: stableObject.size,
            sha256: stableObject.sha256,
            ...(metrics ? { metrics } : {})
        }
        await connection.execute(
            `UPDATE jobs SET status = 'SUCCEEDED', progress = 100, result = ?, completed_at = UTC_TIMESTAMP(3),
             heartbeat_at = UTC_TIMESTAMP(3), error_text = NULL WHERE id = ?`,
            [JSON.stringify(result), job.id]
        )
        await writeAudit(connection, {
            user: actor,
            requestId: `job:${job.id}`
        }, {
            action: 'publish.succeeded',
            entityType: 'publish',
            entityId: job.id,
            projectId: job.project_id,
            after: { releaseRevision, sourceDraftVersion: snapshot.sourceDraftVersion }
        })
        return releaseRevision
    })
}

export async function publishJob(job: JobRow): Promise<void> {
    const metrics = createPublishMetrics()
    const started = Date.now()
    const keepAlive = setInterval(() => {
        void getPool().execute('UPDATE jobs SET heartbeat_at = UTC_TIMESTAMP(3) WHERE id = ?', [job.id]).catch(() => undefined)
    }, 30_000)
    try {
        await withPublishMetrics(metrics, () => withProjectStorageLock(job.project_id, async () => {
            const snapshot = parseProjectSnapshot(job.snapshot)
            validateSnapshot(snapshot)
            const [existing] = await getPool().execute<(RowDataPacket & {
                job_id: string
                status: 'PREPARED' | 'WRITING' | 'ACTIVE' | 'RETIRED'
                distribution: unknown
            })[]>(
                'SELECT job_id, status, distribution FROM publish_manifests WHERE project_id = ? AND job_id = ?', [snapshot.id, job.id]
            )
            if (existing[0]?.status === 'WRITING') {
                const [projects] = await getPool().execute<(RowDataPacket & {
                    id: string
                    slug: string
                    active_release_id: string | null
                    stable_distribution_sha256: string | null
                })[]>(
                    'SELECT id, slug, active_release_id, stable_distribution_sha256 FROM projects WHERE id = ?', [snapshot.id]
                )
                if (!projects[0] || !await reconcileManifest(projects[0], existing)) {
                    throw new Error('Previous stable write is unresolved; its objects remain protected')
                }
                const [finished] = await getPool().execute<(RowDataPacket & { status: string })[]>('SELECT status FROM jobs WHERE id = ?', [job.id])
                if (finished[0]?.status === 'SUCCEEDED') return
            }
            await getPool().execute(
                `INSERT INTO publish_manifests (project_id, job_id, status) VALUES (?, ?, 'PREPARED')
                 ON DUPLICATE KEY UPDATE status = 'PREPARED', distribution = NULL`, [snapshot.id, job.id]
            )
            await getPool().execute('DELETE FROM publish_object_refs WHERE project_id = ? AND job_id = ?', [snapshot.id, job.id])
            const cache = new PublishCache(snapshot.id, snapshot.slug, job.id, metrics)
            await cache.load()
            await heartbeat(job.id, 5)
            const servers: ServerDistributionReference[] = []
            for (let index = 0; index < snapshot.servers.length; index++) {
                const server = await buildIncrementalServer(cache, snapshot, snapshot.servers[index])
                servers.push(await publishServerDistribution(snapshot.slug, server))
                await heartbeat(job.id, 10 + Math.floor((index + 1) / snapshot.servers.length * 70))
            }
            const distribution: PublishedDistribution = {
                distributionFormat: 2,
                version: '1.0.0', rss: snapshot.rss,
                ...(snapshot.discord ? { discord: snapshot.discord as Distribution['discord'] } : {}),
                telemetry: buildLauncherTelemetry(getConfig().appBaseUrl, snapshot.slug), servers
            }
            await heartbeat(job.id, 85)
            // Durable candidate refs exist before the fixed key can change.
            await cache.flushReferences()
            await getPool().execute(
                'UPDATE publish_manifests SET status = \'WRITING\', distribution = ? WHERE project_id = ? AND job_id = ?',
                [JSON.stringify(distribution), snapshot.id, job.id]
            )
            const distributionKey = getStableDistributionKey(snapshot.slug)
            let stable: StoredObject
            try {
                stable = await putJson(distributionKey, distribution, STABLE_CACHE_CONTROL, { 'release-id': job.id })
                await assertStableDistribution(snapshot.slug, job.id, {
                    distributionKey, size: stable.size, sha256: stable.sha256,
                    cacheControl: STABLE_CACHE_CONTROL, releaseId: job.id
                })
            } catch (error) {
                if (isStorageObjectMissingError(error) || isStorageObjectIntegrityError(error)) {
                    throw new PermanentJobError(`Stable distribution for ${snapshot.name} failed RustFS verification: ${error.message}`)
                }
                throw error
            }
            metrics.durationMs = Date.now() - started
            await activatePublish(job, snapshot, stable, metrics)
            // State promotion and cleanup are recoverable after activation. A
            // cleanup failure must never turn the succeeded publish into FAILED.
            await commitManifest(snapshot.id, job.id).catch(() => undefined)
            await cleanupProjectStorage(snapshot.id).catch(() => undefined)
        }))
    } finally {
        clearInterval(keepAlive)
        metrics.durationMs = Date.now() - started
        await getPool().execute(
            'UPDATE jobs SET result = JSON_SET(COALESCE(result, JSON_OBJECT()), \'$.metrics\', JSON_EXTRACT(?, \'$\')) WHERE id = ?',
            [JSON.stringify(metrics), job.id]
        ).catch(() => undefined)
    }
}

interface ImportedArtifact {
    localPath: string
    type: SnapshotModule['type']
    relativePath: string | null
    optionalMode: SnapshotModule['optionalMode']
}

async function collectImportedArtifacts(serverRoot: string, hasForge: boolean): Promise<ImportedArtifact[]> {
    const result: ImportedArtifact[] = []
    async function collect(directory: string, mapper: (path: string) => Omit<ImportedArtifact, 'localPath'>): Promise<void> {
        for (const path of await listFiles(directory)) {
            result.push({ localPath: path, ...mapper(path) })
        }
    }
    await collect(join(serverRoot, 'libraries'), () => ({ type: 'Library', relativePath: null, optionalMode: 'REQUIRED' }))
    await collect(join(serverRoot, 'files'), path => ({
        type: 'File',
        relativePath: relative(join(serverRoot, 'files'), path).split(sep).join('/'),
        optionalMode: 'REQUIRED'
    }))
    const modsRoot = join(serverRoot, hasForge ? 'forgemods' : 'fabricmods')
    for (const [folder, optionalMode] of [
        ['required', 'REQUIRED'],
        ['optionalon', 'OPTIONAL_ON'],
        ['optionaloff', 'OPTIONAL_OFF']
    ] as const) {
        await collect(join(modsRoot, folder), () => ({
            type: hasForge ? 'ForgeMod' : 'FabricMod',
            relativePath: null,
            optionalMode
        }))
    }
    return result
}

export async function importCurseForgeJob(job: JobRow): Promise<void> {
    const input = parseJson(job.snapshot) as { uploadId: string, serverKey: string }
    const [uploadRows] = await getPool().execute<(RowDataPacket & { object_key: string, original_name: string })[]>(
        'SELECT object_key, original_name FROM uploads WHERE id = ? AND project_id = ? AND status = \'READY\'',
        [input.uploadId, job.project_id]
    )
    const upload = uploadRows[0]
    if (!upload) {
        throw new Error('CurseForge upload no longer exists')
    }
    const workspace = await mkdtemp(join(tmpdir(), 'nebula-curseforge-'))
    try {
        const modpackDirectory = join(workspace, 'modpacks', 'curseforge')
        await mkdir(modpackDirectory, { recursive: true })
        const zipName = basename(upload.original_name)
        await downloadToFile(upload.object_key, join(modpackDirectory, zipName))
        const parser = new CurseForgeParser(workspace, zipName)
        const manifest = await parser.getModpackManifest()
        const loader = manifest.minecraft.modLoaders.find(value => value.primary) ?? manifest.minecraft.modLoaders[0]
        const forgeVersion = loader?.id.startsWith('forge-') ? loader.id.slice('forge-'.length) : undefined
        const fabricVersion = loader?.id.startsWith('fabric-') ? loader.id.slice('fabric-'.length) : undefined
        if (!forgeVersion && !fabricVersion) {
            throw new Error(`Unsupported CurseForge loader ${loader?.id ?? 'none'}`)
        }
        const structure = new ServerStructure(workspace, '', false, false)
        const created = await structure.createServer(input.serverKey, new MinecraftVersion(manifest.minecraft.version), {
            version: manifest.version,
            forgeVersion,
            fabricVersion
        })
        if (!created) {
            throw new Error('Could not create imported server structure')
        }
        const manualFiles = await parser.enrichServer(created, manifest)
        const serverRoot = join(workspace, 'servers', `${input.serverKey}-${manifest.minecraft.version}`)
        const artifacts = await collectImportedArtifacts(serverRoot, Boolean(forgeVersion))
        const storedArtifacts = [] as (ImportedArtifact & { upload: SnapshotUpload })[]
        for (const artifact of artifacts) {
            const uploadId = randomUUID()
            const objectKey = `private/uploads/${job.project_id}/${uploadId}/${basename(artifact.localPath)}`
            const stored = await uploadFile(artifact.localPath, objectKey, contentType(artifact.localPath), 'private, no-store')
            storedArtifacts.push({
                ...artifact,
                upload: {
                    id: uploadId,
                    originalName: basename(artifact.localPath),
                    mimeType: contentType(artifact.localPath),
                    ...stored
                }
            })
        }
        await withTransaction(async connection => {
            const [projectRows] = await connection.query<(RowDataPacket & { draft_revision: number })[]>(
                'SELECT draft_revision FROM projects WHERE id = ? AND disabled = FALSE FOR UPDATE',
                [job.project_id]
            )
            if (!projectRows[0]) {
                throw new Error('Project not found')
            }
            const [serverOrder] = await connection.query<(RowDataPacket & { next_order: number })[]>(
                'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM servers WHERE project_id = ?',
                [job.project_id]
            )
            const nextSortOrder = Number(serverOrder[0]?.next_order ?? 0)
            const serverId = randomUUID()
            await connection.execute(
                `INSERT INTO servers (
                    id, project_id, server_key, name, description, minecraft_version, server_version, address,
                    forge_version, fabric_version, main_server, autoconnect, sort_order, revision, published_once,
                    created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, 'localhost:25565', ?, ?, ?, FALSE, ?, 0, FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
                [
                    serverId, job.project_id, input.serverKey, manifest.name, `Imported from CurseForge by ${manifest.author}`,
                    manifest.minecraft.version, manifest.version, forgeVersion ?? null, fabricVersion ?? null,
                    nextSortOrder === 0, nextSortOrder
                ]
            )
            for (const artifact of storedArtifacts) {
                await connection.execute(
                    `INSERT INTO uploads (
                        id, project_id, object_key, original_name, mime_type, size, md5, sha256, status, created_by, created_at
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'READY', ?, UTC_TIMESTAMP(3))`,
                    [
                        artifact.upload.id, job.project_id, artifact.upload.objectKey, artifact.upload.originalName,
                        artifact.upload.mimeType, artifact.upload.size, artifact.upload.md5, artifact.upload.sha256, job.created_by
                    ]
                )
                await connection.execute(
                    `INSERT INTO modules (
                        id, project_id, server_id, upload_id, type, display_name, file_name, relative_path, optional_mode,
                        sort_order, needs_manual_file, created_at, updated_at
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
                    [
                        randomUUID(), job.project_id, serverId, artifact.upload.id, artifact.type,
                        artifact.upload.originalName, artifact.upload.originalName, artifact.relativePath, artifact.optionalMode
                    ]
                )
            }
            for (const manual of manualFiles) {
                await connection.execute(
                    `INSERT INTO modules (
                        id, project_id, server_id, upload_id, type, display_name, file_name, optional_mode, sort_order,
                        needs_manual_file, manual_url, created_at, updated_at
                     ) VALUES (?, ?, ?, NULL, ?, ?, ?, 'REQUIRED', 0, TRUE, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
                    [randomUUID(), job.project_id, serverId, forgeVersion ? 'ForgeMod' : 'FabricMod', manual.fileName, manual.fileName, manual.url]
                )
            }
            await connection.execute(
                'UPDATE projects SET draft_revision = draft_revision + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?',
                [job.project_id]
            )
            await connection.execute(
                `UPDATE jobs SET status = 'SUCCEEDED', progress = 100, completed_at = UTC_TIMESTAMP(3),
                 result = ?, error_text = NULL WHERE id = ?`,
                [JSON.stringify({ serverId, manualFiles }), job.id]
            )
            const [actors] = await connection.query<ActorRow[]>('SELECT id, username, role FROM users WHERE id = ?', [job.created_by])
            await writeAudit(connection, { user: actors[0], requestId: `job:${job.id}` }, {
                action: 'curseforge.imported',
                entityType: 'server',
                entityId: serverId,
                projectId: job.project_id,
                after: { serverKey: input.serverKey, files: storedArtifacts.length, manualFiles }
            })
        })
    } finally {
        await rm(workspace, { recursive: true, force: true })
    }
}

async function claimJob(workerId: string): Promise<JobRow | undefined> {
    return withTransaction(async connection => {
        const [rows] = await connection.query<JobRow[]>(
            `SELECT j.* FROM jobs j
             INNER JOIN projects p ON p.id = j.project_id AND p.disabled = FALSE
             WHERE j.status = 'QUEUED' AND j.available_at <= UTC_TIMESTAMP(3)
             ORDER BY j.created_at, j.id LIMIT 1 FOR UPDATE SKIP LOCKED`
        )
        const job = rows[0]
        if (!job) {
            return undefined
        }
        await connection.execute(
            `UPDATE jobs SET status = 'RUNNING', attempts = attempts + 1, locked_by = ?, locked_at = UTC_TIMESTAMP(3),
             heartbeat_at = UTC_TIMESTAMP(3), started_at = COALESCE(started_at, UTC_TIMESTAMP(3)), error_text = NULL
             WHERE id = ?`,
            [workerId, job.id]
        )
        job.attempts += 1
        return job
    })
}

async function failJob(job: JobRow, error: unknown): Promise<void> {
    if (error instanceof ProjectStorageBusyError) {
        await getPool().execute(
            `UPDATE jobs SET status = 'QUEUED', attempts = GREATEST(attempts - 1, 0),
             available_at = TIMESTAMPADD(SECOND, 10, UTC_TIMESTAMP(3)), locked_by = NULL, locked_at = NULL WHERE id = ? AND status = 'RUNNING'`,
            [job.id]
        )
        return
    }
    const message = error instanceof Error ? error.message : String(error)
    const retry = shouldRetryJob(error, job.attempts, job.max_attempts)
    const delays = [30, 120, 600]
    await getPool().execute(
        `UPDATE jobs SET status = ?, available_at = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)),
         error_text = ?, completed_at = ?, heartbeat_at = UTC_TIMESTAMP(3)
         WHERE id = ?`,
        [
            retry ? 'QUEUED' : 'FAILED',
            delays[Math.min(job.attempts - 1, delays.length - 1)],
            message.slice(0, 60000),
            retry ? null : new Date(),
            job.id
        ]
    )
    if (!retry) {
        const [actors] = await getPool().execute<ActorRow[]>('SELECT id, username, role FROM users WHERE id = ?', [job.created_by])
        await writeAudit(getPool(), { user: actors[0], requestId: `job:${job.id}` }, {
            action: job.kind === 'PUBLISH' ? 'publish.failed' : 'curseforge.import_failed',
            entityType: 'job',
            entityId: job.id,
            projectId: job.project_id,
            result: 'FAILURE',
            errorMessage: message
        })
    }
}

export class JobWorker {
    private stopped = false
    private timer?: ReturnType<typeof setTimeout>
    private readonly workerId = `${process.pid}-${randomUUID()}`

    public start(): void {
        void getPool().execute(
            `UPDATE jobs SET status = 'QUEUED', locked_by = NULL, locked_at = NULL,
             available_at = UTC_TIMESTAMP(3)
             WHERE status = 'RUNNING' AND heartbeat_at < TIMESTAMPADD(MINUTE, -5, UTC_TIMESTAMP(3))`
        ).then(() => this.tick())
    }

    public stop(): void {
        this.stopped = true
        if (this.timer) {
            clearTimeout(this.timer)
        }
    }

    private async tick(): Promise<void> {
        if (this.stopped) {
            return
        }
        try {
            const job = await claimJob(this.workerId)
            if (job) {
                try {
                    if (job.kind === 'PUBLISH') {
                        await publishJob(job)
                    } else {
                        await importCurseForgeJob(job)
                    }
                } catch (error) {
                    await failJob(job, error)
                }
            }
        } finally {
            if (!this.stopped) {
                this.timer = setTimeout(() => void this.tick(), getConfig().workerPollMs)
            }
        }
    }
}
