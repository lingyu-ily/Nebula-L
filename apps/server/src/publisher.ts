import { randomUUID } from 'crypto'
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, extname, join, relative, sep } from 'path'
import type { Distribution, Module } from 'helios-distribution-types'
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import {
    CurseForgeParser,
    DistributionStructure,
    MinecraftVersion,
    ServerStructure
} from '../../../dist/core.js'
import { writeAudit } from './audit.js'
import { getConfig } from './config.js'
import { getPool, withTransaction } from './db/index.js'
import {
    copyJson,
    deleteObjects,
    downloadToFile,
    uploadFile
} from './storage.js'

interface SnapshotUpload {
    id: string
    objectKey: string
    originalName: string
    mimeType: string
    size: number
    md5: string
    sha256: string
}

interface SnapshotModule {
    id: string
    type: 'ForgeMod' | 'FabricMod' | 'Library' | 'File'
    displayName: string
    moduleId: string | null
    relativePath: string | null
    optionalMode: 'REQUIRED' | 'OPTIONAL_ON' | 'OPTIONAL_OFF'
    sortOrder: number
    needsManualFile: boolean
    upload: SnapshotUpload | null
}

interface SnapshotServer {
    id: string
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
    draftRevision: number
    servers: SnapshotServer[]
}

interface JobRow extends RowDataPacket {
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
}

interface ModuleSnapshotRow extends RowDataPacket {
    id: string
    server_id: string
    upload_id: string | null
    type: SnapshotModule['type']
    display_name: string
    module_id: string | null
    relative_path: string | null
    optional_mode: SnapshotModule['optionalMode']
    sort_order: number
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

export async function buildProjectSnapshot(connection: PoolConnection, projectId: string): Promise<ProjectSnapshot> {
    const [projectRows] = await connection.query<ProjectSnapshotRow[]>('SELECT * FROM projects WHERE id = ? FOR UPDATE', [projectId])
    const project = projectRows[0]
    if (!project || project.disabled) {
        throw new Error('Project not found')
    }
    const [serverRows] = await connection.query<ServerSnapshotRow[]>(
        `SELECT s.*, u.object_key AS icon_object_key, u.original_name AS icon_original_name,
                u.mime_type AS icon_mime_type, u.size AS icon_size, u.md5 AS icon_md5, u.sha256 AS icon_sha256
         FROM servers s LEFT JOIN uploads u ON u.id = s.icon_upload_id AND u.status = 'READY'
         WHERE s.project_id = ? ORDER BY s.sort_order, s.name`,
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
        draftRevision: Number(project.draft_revision),
        servers: serverRows.map(server => ({
            id: server.id,
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
            icon: server.icon_upload_id && server.icon_object_key ? {
                id: server.icon_upload_id,
                objectKey: server.icon_object_key,
                originalName: server.icon_original_name!,
                mimeType: server.icon_mime_type!,
                size: Number(server.icon_size),
                md5: server.icon_md5!,
                sha256: server.icon_sha256!
            } : null,
            untrackedRules: rules.filter(rule => rule.server_id === server.id).map(rule => ({
                appliesTo: rule.applies_to,
                pattern: rule.pattern
            })),
            modules: moduleRows.filter(module => module.server_id === server.id).map(module => ({
                id: module.id,
                type: module.type,
                displayName: module.display_name,
                moduleId: module.module_id,
                relativePath: module.relative_path,
                optionalMode: module.optional_mode,
                sortOrder: module.sort_order,
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

function validateSnapshot(snapshot: ProjectSnapshot): void {
    if (snapshot.servers.length === 0) {
        throw new Error('A distribution must contain at least one server')
    }
    if (snapshot.servers.filter(server => server.mainServer).length !== 1) {
        throw new Error('A distribution must contain exactly one main server')
    }
    for (const server of snapshot.servers) {
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

function getModuleRelativePath(module: SnapshotModule): string {
    const name = module.upload?.originalName ?? `${module.id}.missing`
    if (module.type === 'File') {
        return join('files', ...(module.relativePath ?? name).split('/'))
    }
    if (module.type === 'Library') {
        return join('libraries', name)
    }
    const root = module.type === 'ForgeMod' ? 'forgemods' : 'fabricmods'
    return join(root, namespace(module.optionalMode), name)
}

async function materializeSnapshot(snapshot: ProjectSnapshot, root: string): Promise<void> {
    await mkdir(join(root, 'meta'), { recursive: true })
    await writeFile(join(root, 'meta', 'distrometa.json'), JSON.stringify({
        meta: {
            rss: snapshot.rss,
            ...(snapshot.discord ? { discord: snapshot.discord } : {})
        }
    }, null, 2))
    for (const server of snapshot.servers) {
        const serverRoot = join(root, 'servers', `${server.serverKey}-${server.minecraftVersion}`)
        await Promise.all([
            mkdir(join(serverRoot, 'files'), { recursive: true }),
            mkdir(join(serverRoot, 'libraries'), { recursive: true })
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
                ...(server.javaOptions ? { javaOptions: server.javaOptions } : {})
            },
            ...(server.forgeVersion ? { forge: { version: server.forgeVersion } } : {}),
            ...(server.fabricVersion ? { fabric: { version: server.fabricVersion } } : {}),
            untrackedFiles
        }, null, 2))
        if (server.icon) {
            const iconExtension = ['.png', '.jpg', '.jpeg'].includes(extname(server.icon.originalName).toLowerCase())
                ? extname(server.icon.originalName).toLowerCase()
                : '.png'
            await downloadToFile(server.icon.objectKey, join(serverRoot, `icon${iconExtension}`))
        }
        for (const module of server.modules) {
            const destination = join(serverRoot, getModuleRelativePath(module))
            await mkdir(dirname(destination), { recursive: true })
            await downloadToFile(module.upload!.objectKey, destination)
        }
    }
}

function orderDistribution(distribution: Distribution, snapshot: ProjectSnapshot): void {
    const serverOrder = new Map(snapshot.servers.map((server, index) => [server.serverKey, index]))
    distribution.servers.sort((left, right) => (serverOrder.get(left.id) ?? 9999) - (serverOrder.get(right.id) ?? 9999))
    for (const server of distribution.servers) {
        const source = snapshot.servers.find(value => value.serverKey === server.id)
        if (!source) {
            continue
        }
        const moduleOrder = new Map(source.modules.map(module => [module.upload?.originalName.toLowerCase(), module.sortOrder]))
        server.modules.sort((left: Module, right: Module) => {
            const leftName = basename(left.artifact.url).toLowerCase()
            const rightName = basename(right.artifact.url).toLowerCase()
            return (moduleOrder.get(leftName) ?? -1000) - (moduleOrder.get(rightName) ?? -1000)
        })
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

function contentType(path: string): string {
    switch (extname(path).toLowerCase()) {
        case '.json': return 'application/json; charset=utf-8'
        case '.png': return 'image/png'
        case '.jpg':
        case '.jpeg': return 'image/jpeg'
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

async function persistRelease(
    job: JobRow,
    snapshot: ProjectSnapshot,
    distributionKey: string,
    files: { logicalPath: string, objectKey: string, size: number, md5: string, sha256: string }[]
): Promise<void> {
    await withTransaction(async connection => {
        await connection.execute(
            `INSERT INTO releases (
                id, project_id, job_id, draft_revision, status, snapshot, distribution_key,
                created_by, created_at, activated_at
             ) VALUES (?, ?, ?, ?, 'AVAILABLE', ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
             ON DUPLICATE KEY UPDATE snapshot = VALUES(snapshot), distribution_key = VALUES(distribution_key)`,
            [job.id, job.project_id, job.id, snapshot.draftRevision, JSON.stringify(snapshot), distributionKey, job.created_by]
        )
        await connection.execute('DELETE FROM release_files WHERE release_id = ?', [job.id])
        for (const file of files) {
            await connection.execute(
                `INSERT INTO release_files (release_id, logical_path, object_key, size, md5, sha256)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [job.id, file.logicalPath, file.objectKey, file.size, file.md5, file.sha256]
            )
        }
    })
}

async function activateRelease(job: JobRow, snapshot: ProjectSnapshot): Promise<void> {
    await withTransaction(async connection => {
        const [actors] = await connection.query<ActorRow[]>('SELECT id, username, role FROM users WHERE id = ?', [job.created_by])
        const actor = actors[0]
        await connection.execute(
            'UPDATE releases SET status = \'AVAILABLE\' WHERE project_id = ? AND status = \'ACTIVE\' AND id <> ?',
            [job.project_id, job.id]
        )
        await connection.execute(
            'UPDATE releases SET status = \'ACTIVE\', activated_at = UTC_TIMESTAMP(3) WHERE id = ?',
            [job.id]
        )
        await connection.execute(
            'UPDATE projects SET active_release_id = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?',
            [job.id, job.project_id]
        )
        await connection.execute('UPDATE servers SET published_once = TRUE WHERE project_id = ?', [job.project_id])
        await connection.execute(
            `UPDATE jobs SET status = 'SUCCEEDED', progress = 100, completed_at = UTC_TIMESTAMP(3),
             heartbeat_at = UTC_TIMESTAMP(3), error_text = NULL WHERE id = ?`,
            [job.id]
        )
        await writeAudit(connection, {
            user: actor,
            requestId: `job:${job.id}`
        }, {
            action: 'release.published',
            entityType: 'release',
            entityId: job.id,
            projectId: job.project_id,
            after: { draftRevision: snapshot.draftRevision }
        })
    })
}

async function enforceRetention(projectId: string, activeReleaseId: string): Promise<void> {
    const [oldReleases] = await getPool().execute<(RowDataPacket & { id: string, distribution_key: string })[]>(
        `SELECT id, distribution_key FROM releases
         WHERE project_id = ? AND status IN ('ACTIVE','AVAILABLE') AND id <> ?
         ORDER BY activated_at DESC LIMIT 18446744073709551615 OFFSET 9`,
        [projectId, activeReleaseId]
    )
    for (const release of oldReleases) {
        const [fileRows] = await getPool().execute<(RowDataPacket & { object_key: string })[]>(
            'SELECT object_key FROM release_files WHERE release_id = ?',
            [release.id]
        )
        await deleteObjects([...fileRows.map(row => row.object_key), release.distribution_key])
        await getPool().execute(
            'UPDATE releases SET status = \'DELETED\', deleted_at = UTC_TIMESTAMP(3) WHERE id = ? AND id <> ?',
            [release.id, activeReleaseId]
        )
    }
}

export async function publishJob(job: JobRow): Promise<void> {
    const snapshot = parseJson(job.snapshot) as ProjectSnapshot
    validateSnapshot(snapshot)
    const workspace = await mkdtemp(join(tmpdir(), 'nebula-publish-'))
    const releasePrefix = `public/${snapshot.slug}/releases/${job.id}`
    const releasePublicBase = `${getConfig().rustfs.publicBaseUrl}/${releasePrefix}/`
    try {
        await heartbeat(job.id, 10)
        await materializeSnapshot(snapshot, workspace)
        await heartbeat(job.id, 35)
        process.env.ROOT = workspace
        process.env.BASE_URL = releasePublicBase
        process.env.JAVA_EXECUTABLE = getConfig().javaExecutable
        const distribution = await new DistributionStructure(workspace, releasePublicBase, false, false).getSpecModel()
        orderDistribution(distribution, snapshot)
        const distributionPath = join(workspace, 'distribution.json')
        await writeFile(distributionPath, JSON.stringify(distribution, null, 2))
        await heartbeat(job.id, 60)
        const candidates = [
            distributionPath,
            ...await listFiles(join(workspace, 'servers')),
            ...await listFiles(join(workspace, 'repo'))
        ].filter(path => basename(path) !== 'servermeta.json')
        const releaseFiles: { logicalPath: string, objectKey: string, size: number, md5: string, sha256: string }[] = []
        for (let index = 0; index < candidates.length; index++) {
            const path = candidates[index]
            const logicalPath = relative(workspace, path).split(sep).join('/')
            const objectKey = `${releasePrefix}/${logicalPath}`
            const stored = await uploadFile(path, objectKey, contentType(path))
            releaseFiles.push({ logicalPath, ...stored })
            await heartbeat(job.id, 60 + Math.floor((index + 1) / candidates.length * 25))
        }
        const distributionKey = `${releasePrefix}/distribution.json`
        await persistRelease(job, snapshot, distributionKey, releaseFiles)
        await copyJson(distributionKey, `public/${snapshot.slug}/distribution.json`, 'no-cache, must-revalidate')
        await activateRelease(job, snapshot)
        await enforceRetention(snapshot.id, job.id)
    } finally {
        await rm(workspace, { recursive: true, force: true })
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
            const [serverCount] = await connection.query<(RowDataPacket & { total: number })[]>(
                'SELECT COUNT(*) AS total FROM servers WHERE project_id = ?',
                [job.project_id]
            )
            const serverId = randomUUID()
            await connection.execute(
                `INSERT INTO servers (
                    id, project_id, server_key, name, description, minecraft_version, server_version, address,
                    forge_version, fabric_version, main_server, autoconnect, sort_order, revision, published_once,
                    created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, 'localhost:25565', ?, ?, ?, FALSE, 0, 0, FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
                [
                    serverId, job.project_id, input.serverKey, manifest.name, `Imported from CurseForge by ${manifest.author}`,
                    manifest.minecraft.version, manifest.version, forgeVersion ?? null, fabricVersion ?? null,
                    Number(serverCount[0]?.total ?? 0) === 0
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
                        id, project_id, server_id, upload_id, type, display_name, relative_path, optional_mode,
                        sort_order, needs_manual_file, created_at, updated_at
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
                    [
                        randomUUID(), job.project_id, serverId, artifact.upload.id, artifact.type,
                        artifact.upload.originalName, artifact.relativePath, artifact.optionalMode
                    ]
                )
            }
            for (const manual of manualFiles) {
                await connection.execute(
                    `INSERT INTO modules (
                        id, project_id, server_id, upload_id, type, display_name, optional_mode, sort_order,
                        needs_manual_file, manual_url, created_at, updated_at
                     ) VALUES (?, ?, ?, NULL, ?, ?, 'REQUIRED', 0, TRUE, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
                    [randomUUID(), job.project_id, serverId, forgeVersion ? 'ForgeMod' : 'FabricMod', manual.fileName, manual.url]
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
            `SELECT * FROM jobs WHERE status = 'QUEUED' AND available_at <= UTC_TIMESTAMP(3)
             ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`
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
    const message = error instanceof Error ? error.message : String(error)
    const retry = job.attempts < job.max_attempts
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
            action: job.kind === 'PUBLISH' ? 'release.failed' : 'curseforge.import_failed',
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
