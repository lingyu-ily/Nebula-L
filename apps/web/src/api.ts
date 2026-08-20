import type { ApiUser } from '@nebula/shared'

export interface AuthResponse {
    user: ApiUser
    csrfToken: string
}

export interface Project {
    id: string
    slug: string
    name: string
    description: string
    rss: string
    discord: null | { clientId: string, smallImageText: string, smallImageKey: string }
    draftRevision: number
    activeReleaseId: string | null
    launcherUrl: string
    stableDistributionReady?: boolean
    disabled: boolean
}

export interface Upload {
    id: string
    originalName: string
    mimeType: string
    size: number
    md5: string
    sha256: string
}

export interface ManagedModule {
    id: string
    uploadId: string | null
    type: 'ForgeMod' | 'FabricMod' | 'Library' | 'File'
    displayName: string
    fileName: string | null
    moduleId: string | null
    relativePath: string | null
    optionalMode: 'REQUIRED' | 'OPTIONAL_ON' | 'OPTIONAL_OFF'
    sortOrder: number
    needsManualFile: boolean
    manualUrl: string | null
    originalName: string | null
    size: number | null
    md5: string | null
    sha256: string | null
    createdAt: string
    updatedAt: string
}

export interface ManagedServer {
    id: string
    serverKey: string
    name: string
    description: string
    minecraftVersion: string
    serverVersion: string
    address: string
    discord: null | { shortId: string, largeImageText: string, largeImageKey: string }
    iconUploadId: string | null
    launcherUi: {
        backgroundUploadId: string | null
        logoUploadId: string | null
        video:
            | null
            | { source: 'upload', uploadId: string }
            | { source: 'external', url: string }
            | { source: 'youtube', url: string }
        eyebrow: string
        title: string
        tagline: string
        rss: string
    }
    forgeVersion: string | null
    fabricVersion: string | null
    mainServer: boolean
    autoconnect: boolean
    sortOrder: number
    javaOptions: unknown
    revision: number
    publishedOnce: boolean
    createdAt: string
    updatedAt: string
    modules: ManagedModule[]
    untrackedRules: { id: string, appliesTo: string, pattern: string }[]
}

export interface ProjectDetail {
    project: Project
    servers: ManagedServer[]
}

export interface ServerDirectory {
    id: string
    path: string
    createdAt: string
    updatedAt: string
}

export interface ServerDetail {
    project: Project
    server: ManagedServer
    directories: ServerDirectory[]
}

export interface Job {
    id: string
    kind: 'PUBLISH' | 'CURSEFORGE_IMPORT'
    status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
    attempts: number
    maxAttempts: number
    progress: number
    result: unknown
    error: string | null
    createdAt: string
}

export interface Release {
    id: string
    draftRevision: number
    status: 'ACTIVE' | 'AVAILABLE' | 'DELETED'
    retained: boolean
    createdBy: string
    createdAt: string
    activatedAt: string
}

export interface AuditLog {
    id: number
    actorUsername: string | null
    actorRole: string | null
    action: string
    entityType: string
    entityId: string | null
    projectId: string | null
    result: string
    ip: string | null
    before: unknown
    after: unknown
    errorMessage: string | null
    createdAt: string
}

export class ApiError extends Error {
    constructor(public status: number, message: string) {
        super(message)
    }
}

let csrfToken = ''

export function setCsrfToken(token: string): void {
    csrfToken = token
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    if (init.body && !(init.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json')
    }
    const method = (init.method ?? 'GET').toUpperCase()
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) {
        headers.set('X-CSRF-Token', csrfToken)
    }
    const response = await fetch(path, {
        ...init,
        headers,
        credentials: 'same-origin'
    })
    if (!response.ok) {
        const problem = await response.json().catch(() => ({ title: response.statusText })) as { title?: string, detail?: string }
        throw new ApiError(response.status, problem.detail || problem.title || response.statusText)
    }
    if (response.status === 204) {
        return undefined as T
    }
    return response.json() as Promise<T>
}

export function jsonBody(value: unknown): Pick<RequestInit, 'body'> {
    return { body: JSON.stringify(value) }
}
