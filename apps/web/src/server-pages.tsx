import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type DragEvent,
    type FormEvent,
    type KeyboardEvent as ReactKeyboardEvent,
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
    type ReactNode
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type {
    ApiUser,
    ExplorerEntryRef,
    LoaderCatalogResponse,
    MinecraftCatalogResponse,
    VersionCatalogLoader
} from '@nebula/shared'
import { isSafeRelativePath } from '@nebula/shared'
import {
    api,
    apiResponse,
    jsonBody,
    type ManagedModule,
    type ManagedServer,
    type Project,
    type ProjectDetail,
    type ServerDetail,
    type ServerDirectory
} from './api.js'
import { collectDroppedTree, hasDroppedDirectory, type UploadBatchFile } from './explorer-drop.js'
import { Link, NavLink, Navigate, useNavigate, useParams } from './router.js'

type OptionalMode = ManagedModule['optionalMode']
type ModuleType = ManagedModule['type']
type ExplorerSort = 'name' | 'type' | 'size' | 'updated'
type ExplorerColumnKey = 'name' | 'type' | 'destination' | 'size' | 'status' | 'validation' | 'updated'
type ExplorerColumnRatios = Record<ExplorerColumnKey, number>

interface ExplorerColumnConfig {
    key: ExplorerColumnKey
    labelKey: string
    defaultWidth: number
    minimumWidth: number
}

const EXPLORER_COLUMN_STORAGE_KEY = 'nebula:explorer-column-widths:v1'
const EXPLORER_SELECTION_WIDTH = 44
const EXPLORER_TABLE_MINIMUM_WIDTH = 1000
const EXPLORER_COLUMN_CONFIGS: ExplorerColumnConfig[] = [
    { key: 'name', labelKey: 'name', defaultWidth: 180, minimumWidth: 120 },
    { key: 'type', labelKey: 'type', defaultWidth: 100, minimumWidth: 80 },
    { key: 'destination', labelKey: 'destination', defaultWidth: 220, minimumWidth: 140 },
    { key: 'size', labelKey: 'size', defaultWidth: 90, minimumWidth: 70 },
    { key: 'status', labelKey: 'status', defaultWidth: 110, minimumWidth: 90 },
    { key: 'validation', labelKey: 'checksumValidation', defaultWidth: 120, minimumWidth: 100 },
    { key: 'updated', labelKey: 'updated', defaultWidth: 136, minimumWidth: 120 }
]
const EXPLORER_COLUMN_CONFIG_BY_KEY = Object.fromEntries(
    EXPLORER_COLUMN_CONFIGS.map(config => [config.key, config])
) as Record<ExplorerColumnKey, ExplorerColumnConfig>
const EXPLORER_DEFAULT_DATA_WIDTH = EXPLORER_COLUMN_CONFIGS.reduce(
    (total, config) => total + config.defaultWidth,
    0
)

function defaultExplorerColumnRatios(): ExplorerColumnRatios {
    return Object.fromEntries(EXPLORER_COLUMN_CONFIGS.map(config => [
        config.key,
        config.defaultWidth / EXPLORER_DEFAULT_DATA_WIDTH
    ])) as ExplorerColumnRatios
}

function parseExplorerColumnRatios(value: unknown): ExplorerColumnRatios {
    const fallback = defaultExplorerColumnRatios()
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
    const record = value as Record<string, unknown>
    const widths = EXPLORER_COLUMN_CONFIGS.map(config => record[config.key])
    if (widths.some(width => typeof width !== 'number' || !Number.isFinite(width) || width < 0.02 || width > 0.8)) {
        return fallback
    }
    const total = widths.reduce<number>((sum, width) => sum + Number(width), 0)
    if (total < 0.98 || total > 1.02) return fallback
    return Object.fromEntries(EXPLORER_COLUMN_CONFIGS.map((config, index) => [
        config.key,
        Number(widths[index]) / total
    ])) as ExplorerColumnRatios
}

function loadExplorerColumnRatios(): ExplorerColumnRatios {
    try {
        const stored = window.localStorage.getItem(EXPLORER_COLUMN_STORAGE_KEY)
        return stored ? parseExplorerColumnRatios(JSON.parse(stored)) : defaultExplorerColumnRatios()
    } catch {
        return defaultExplorerColumnRatios()
    }
}

interface UploadProgress {
    phase: 'folders' | 'files'
    completed: number
    total: number
    currentFile: string
}

interface UploadSuccess {
    files: number
    folders: number
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function ErrorNotice({ error }: { error: unknown }): ReactNode {
    if (!error) return null
    return <div className="notice error" role="alert">{error instanceof Error ? error.message : String(error)}</div>
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
    const [debouncedValue, setDebouncedValue] = useState(value)
    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedValue(value), delayMs)
        return (): void => window.clearTimeout(timer)
    }, [delayMs, value])
    return debouncedValue
}

function useServerDetail(projectId: string, serverId: string): ReturnType<typeof useQuery<ServerDetail, Error>> {
    return useQuery({
        queryKey: ['server', projectId, serverId],
        queryFn: () => api<ServerDetail>(`/api/v1/projects/${projectId}/servers/${serverId}`)
    })
}

function invalidateServer(queryClient: ReturnType<typeof useQueryClient>, projectId: string, serverId: string): void {
    void queryClient.invalidateQueries({ queryKey: ['server', projectId, serverId] })
    void queryClient.invalidateQueries({ queryKey: ['project', projectId] })
}

function loaderLabel(server: ManagedServer, none: string): string {
    if (server.forgeVersion) return `Forge ${server.forgeVersion}`
    if (server.fabricVersion) return `Fabric ${server.fabricVersion}`
    return none
}

function ServerHeader({ detail }: { detail: ServerDetail }): ReactNode {
    const { t } = useTranslation()
    const base = `/projects/${detail.project.id}/servers/${detail.server.id}`
    return <>
        <header className="page-header server-page-header">
            <div>
                <Link to={`/projects/${detail.project.id}`} className="back-link">← {detail.project.name}</Link>
                <h1>{detail.server.name}</h1>
                <p>
                    <code>{detail.server.serverKey}</code>
                    {' · '}MC {detail.server.minecraftVersion}
                    {' · '}{loaderLabel(detail.server, t('loaderNone'))}
                </p>
            </div>
            <div className="server-header-badges">
                {detail.server.mainServer && <span className="pill">{t('mainServer')}</span>}
                {detail.server.autoconnect && <span className="pill">{t('autoconnect')}</span>}
                <span className="pill">{detail.project.releaseRevision == null ? t('notPublished') : `${t('revision')} ${detail.project.releaseRevision}`}</span>
            </div>
        </header>
        <nav className="server-tabs" aria-label={t('serverNavigation')}>
            <NavLink to={`${base}/overview`}>{t('overview')}</NavLink>
            <NavLink to={`${base}/settings`}>{t('settings')}</NavLink>
            <NavLink to={`${base}/launcher`}>{t('launcherPage')}</NavLink>
            <NavLink to={`${base}/files`}>{t('files')}</NavLink>
        </nav>
    </>
}

interface ServerFormProps {
    project: Project
    server?: ManagedServer
    initialSortOrder?: number
    canEdit: boolean
    onDone: (serverId?: string) => void
}

function ServerForm({ project, server, initialSortOrder, canEdit, onDone }: ServerFormProps): ReactNode {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const initialLoader = server?.forgeVersion ? 'forge' : server?.fabricVersion ? 'fabric' : 'none'
    const [minecraftVersion, setMinecraftVersion] = useState(server?.minecraftVersion ?? '')
    const [loader, setLoader] = useState<'none' | VersionCatalogLoader>(initialLoader)
    const [loaderVersion, setLoaderVersion] = useState(server?.forgeVersion ?? server?.fabricVersion ?? '')
    const selectedLoader = loader === 'none' ? null : loader
    const normalizedMinecraftVersion = minecraftVersion.trim()
    const debouncedMinecraftVersion = useDebouncedValue(normalizedMinecraftVersion, 400)
    const canLoadLoaderVersions = canEdit
        && selectedLoader != null
        && normalizedMinecraftVersion.length > 0
        && normalizedMinecraftVersion === debouncedMinecraftVersion
    const minecraftCatalog = useQuery<MinecraftCatalogResponse, Error>({
        queryKey: ['version-catalog', 'minecraft'],
        queryFn: ({ signal }) => api('/api/v1/version-catalog/minecraft', { signal }),
        enabled: canEdit,
        retry: false,
        staleTime: 15 * 60 * 1_000
    })
    const loaderCatalog = useQuery<LoaderCatalogResponse, Error>({
        queryKey: ['version-catalog', 'loader', selectedLoader, normalizedMinecraftVersion],
        queryFn: ({ signal }) => {
            if (!selectedLoader) throw new Error('A loader must be selected')
            const query = new URLSearchParams({
                loader: selectedLoader,
                minecraftVersion: normalizedMinecraftVersion
            })
            return api(`/api/v1/version-catalog/loaders?${query}`, { signal })
        },
        enabled: canLoadLoaderVersions,
        retry: false,
        staleTime: 15 * 60 * 1_000
    })
    const mutation = useMutation({
        mutationFn: async ({ value, icon }: { value: Record<string, unknown>, icon: File | null }) => {
            if (icon) {
                const body = new FormData()
                body.append('file', icon)
                const upload = await api<{ id: string }>(`/api/v1/projects/${project.id}/uploads`, {
                    method: 'POST',
                    body
                })
                value.iconUploadId = upload.id
            }
            return api<{ id?: string }>(
                server
                    ? `/api/v1/projects/${project.id}/servers/${server.id}`
                    : `/api/v1/projects/${project.id}/servers`,
                { method: server ? 'PUT' : 'POST', ...jsonBody(value) }
            )
        },
        onSuccess: response => {
            void queryClient.invalidateQueries({ queryKey: ['project', project.id] })
            if (server) {
                invalidateServer(queryClient, project.id, server.id)
            }
            onDone(response.id ?? server?.id)
        }
    })
    const submit = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault()
        if (!canEdit) return
        const data = new FormData(event.currentTarget)
        const ruleLines = String(data.get('untrackedRules') ?? '')
            .split(/\r?\n/)
            .map(value => value.trim())
            .filter(Boolean)
        const rules = ruleLines.map(line => {
            const separator = line.indexOf(':')
            return { appliesTo: line.slice(0, separator), pattern: line.slice(separator + 1) }
        })
        const supported = String(data.get('javaSupported') ?? '').trim()
        const suggested = Number(data.get('javaSuggested'))
        const ramMinimum = Number(data.get('ramMinimum'))
        const ramRecommended = Number(data.get('ramRecommended'))
        const iconValue = data.get('icon')
        mutation.mutate({
            value: {
                draftVersion: project.draftVersion,
                serverKey: String(data.get('serverKey') ?? server?.serverKey),
                name: String(data.get('name')),
                description: String(data.get('description')),
                minecraftVersion,
                serverVersion: String(data.get('serverVersion')),
                address: String(data.get('address')),
                discord: data.get('discordShort') || data.get('discordLargeText') || data.get('discordLargeKey') ? {
                    shortId: String(data.get('discordShort')),
                    largeImageText: String(data.get('discordLargeText')),
                    largeImageKey: String(data.get('discordLargeKey'))
                } : null,
                iconUploadId: server?.iconUploadId ?? null,
                forgeVersion: loader === 'forge' ? loaderVersion : null,
                fabricVersion: loader === 'fabric' ? loaderVersion : null,
                mainServer: data.get('mainServer') === 'on',
                autoconnect: data.get('autoconnect') === 'on',
                sortOrder: server?.sortOrder ?? initialSortOrder ?? 0,
                javaOptions: supported || suggested || ramMinimum || ramRecommended ? {
                    ...(supported ? { supported } : {}),
                    ...(suggested ? { suggestedMajor: suggested } : {}),
                    ...(ramMinimum && ramRecommended ? {
                        ram: { minimum: ramMinimum, recommended: ramRecommended }
                    } : {})
                } : null,
                untrackedRules: rules
            },
            icon: iconValue instanceof File && iconValue.size > 0 ? iconValue : null
        })
    }
    return <form className="form-grid server-settings-form" onSubmit={submit}>
        <label>{t('serverId')}<input name="serverKey" defaultValue={server?.serverKey} disabled={!canEdit || server?.publishedOnce} required /></label>
        <label>{t('name')}<input name="name" defaultValue={server?.name} disabled={!canEdit} required /></label>
        <label className="wide">{t('description')}<textarea name="description" defaultValue={server?.description} disabled={!canEdit} /></label>
        <label>{t('minecraft')}
            <input
                name="minecraftVersion"
                value={minecraftVersion}
                onChange={event => setMinecraftVersion(event.target.value)}
                list="minecraft-version-options"
                autoComplete="off"
                disabled={!canEdit}
                required
            />
            <datalist id="minecraft-version-options">
                {minecraftCatalog.data?.versions.map(version => <option key={version.value} value={version.value} />)}
            </datalist>
            {canEdit && <small className={minecraftCatalog.isError ? 'field-hint warning' : 'field-hint'}>
                {minecraftCatalog.fetchStatus === 'fetching' && !minecraftCatalog.data
                    ? t('versionsLoading')
                    : minecraftCatalog.isError
                        ? t('versionsUnavailable')
                        : minecraftCatalog.data?.stale
                            ? t('versionsStale')
                            : t('manualVersionHint')}
            </small>}
        </label>
        <label>{t('serverVersion')}<input name="serverVersion" defaultValue={server?.serverVersion ?? '1.0.0'} disabled={!canEdit} required /></label>
        <label>{t('address')}<input name="address" defaultValue={server?.address ?? 'localhost:25565'} disabled={!canEdit} required /></label>
        <label>{t('discordShort')}<input name="discordShort" defaultValue={server?.discord?.shortId} disabled={!canEdit} /></label>
        <label>{t('discordLargeText')}<input name="discordLargeText" defaultValue={server?.discord?.largeImageText} disabled={!canEdit} /></label>
        <label>{t('discordLargeKey')}<input name="discordLargeKey" defaultValue={server?.discord?.largeImageKey} disabled={!canEdit} /></label>
        <label>{t('loader')}<select
            name="loader"
            value={loader}
            disabled={!canEdit}
            onChange={event => {
                setLoader(event.target.value as 'none' | VersionCatalogLoader)
                setLoaderVersion('')
            }}
        >
            <option value="none">{t('loaderNone')}</option>
            <option value="forge">Forge</option>
            <option value="fabric">Fabric</option>
        </select></label>
        <label>{t('loaderVersion')}
            <input
                name="loaderVersion"
                value={loaderVersion}
                onChange={event => setLoaderVersion(event.target.value)}
                list="loader-version-options"
                autoComplete="off"
                disabled={!canEdit || !selectedLoader}
                required={selectedLoader != null}
            />
            <datalist id="loader-version-options">
                {loaderCatalog.data?.versions.map(version => {
                    const flags = [
                        version.recommended ? t('recommendedVersion') : '',
                        version.latest ? t('latestVersion') : '',
                        version.stable ? t('stableVersion') : ''
                    ].filter(Boolean)
                    return <option
                        key={version.value}
                        value={version.value}
                        label={flags.length > 0 ? flags.join(' · ') : undefined}
                    />
                })}
            </datalist>
            {canEdit && selectedLoader && <small className={loaderCatalog.isError ? 'field-hint warning' : 'field-hint'}>
                {normalizedMinecraftVersion.length === 0
                    ? t('selectMinecraftFirst')
                    : loaderCatalog.fetchStatus === 'fetching' && !loaderCatalog.data
                        ? t('versionsLoading')
                        : loaderCatalog.isError
                            ? t('versionsUnavailable')
                            : loaderCatalog.data?.stale
                                ? t('versionsStale')
                                : loaderCatalog.data && loaderCatalog.data.versions.length === 0
                                    ? t('noCompatibleVersions')
                                    : t('manualVersionHint')}
            </small>}
        </label>
        <label>{t('javaSupported')}<input name="javaSupported" defaultValue={(server?.javaOptions as { supported?: string } | null)?.supported} placeholder=">=17" disabled={!canEdit} /></label>
        <label>{t('javaSuggested')}<input name="javaSuggested" type="number" min="8" defaultValue={(server?.javaOptions as { suggestedMajor?: number } | null)?.suggestedMajor} disabled={!canEdit} /></label>
        <label>{t('ramMinimum')}<input name="ramMinimum" type="number" min="512" step="512" defaultValue={(server?.javaOptions as { ram?: { minimum?: number } } | null)?.ram?.minimum} disabled={!canEdit} /></label>
        <label>{t('ramRecommended')}<input name="ramRecommended" type="number" min="512" step="512" defaultValue={(server?.javaOptions as { ram?: { recommended?: number } } | null)?.ram?.recommended} disabled={!canEdit} /></label>
        <label className="wide file-input">{t('serverIcon')}<input name="icon" type="file" accept="image/png,image/jpeg" disabled={!canEdit} /></label>
        <label className="wide">{t('untrackedRules')}<textarea name="untrackedRules" defaultValue={server?.untrackedRules.map(rule => `${rule.appliesTo}:${rule.pattern}`).join('\n')} placeholder={t('untrackedHint')} disabled={!canEdit} /></label>
        <label className="checkbox"><input name="mainServer" type="checkbox" defaultChecked={server?.mainServer} disabled={!canEdit} />{t('mainServer')}</label>
        <label className="checkbox"><input name="autoconnect" type="checkbox" defaultChecked={server?.autoconnect} disabled={!canEdit} />{t('autoconnect')}</label>
        <ErrorNotice error={mutation.error} />
        {canEdit && <div className="actions">
            <button type="button" className="secondary" onClick={() => onDone(server?.id)}>{t('cancel')}</button>
            <button className="primary" disabled={mutation.isPending}>{t('save')}</button>
        </div>}
    </form>
}

function LoadingOrError({ query }: { query: ReturnType<typeof useQuery<ServerDetail, Error>> }): ReactNode {
    if (query.isLoading) return <div className="loading">NEBULA</div>
    if (!query.data) return <ErrorNotice error={query.error} />
    return null
}

export function NewServerPage({ user }: { user: ApiUser }): ReactNode {
    const { projectId = '' } = useParams()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const detail = useQuery({
        queryKey: ['project', projectId],
        queryFn: () => api<ProjectDetail>(`/api/v1/projects/${projectId}`)
    })
    if (detail.isLoading) return <div className="loading">NEBULA</div>
    if (!detail.data) return <ErrorNotice error={detail.error} />
    if (user.role === 'AUDITOR') return <Navigate to={`/projects/${projectId}`} replace />
    return <>
        <header className="page-header">
            <div>
                <Link to={`/projects/${projectId}`} className="back-link">← {detail.data.project.name}</Link>
                <h1>{t('newServer')}</h1>
            </div>
        </header>
        <section className="card">
            <ServerForm
                project={detail.data.project}
                initialSortOrder={Math.max(-1, ...detail.data.servers.map(server => server.sortOrder)) + 1}
                canEdit
                onDone={serverId => {
                    void navigate(serverId
                        ? `/projects/${projectId}/servers/${serverId}/overview`
                        : `/projects/${projectId}`)
                }}
            />
        </section>
    </>
}

export function ServerOverviewPage(): ReactNode {
    const { projectId = '', serverId = '' } = useParams()
    const { t } = useTranslation()
    const detail = useServerDetail(projectId, serverId)
    const fallback = <LoadingOrError query={detail} />
    if (!detail.data) return fallback
    const server = detail.data.server
    const manualFiles = server.modules.filter(module => module.needsManualFile).length
    return <>
        <ServerHeader detail={detail.data} />
        <div className="server-summary-grid">
            <section className="summary-card"><span>{t('minecraft')}</span><strong>{server.minecraftVersion}</strong><small>{loaderLabel(server, t('loaderNone'))}</small></section>
            <section className="summary-card"><span>{t('address')}</span><strong>{server.address}</strong><small>{server.serverVersion}</small></section>
            <section className="summary-card"><span>{t('files')}</span><strong>{server.modules.length}</strong><small>{detail.data.directories.length} {t('folders')}</small></section>
            <section className={`summary-card ${manualFiles > 0 ? 'summary-warning' : ''}`}><span>{t('waitingFile')}</span><strong>{manualFiles}</strong><small>{manualFiles > 0 ? t('publishBlocked') : t('ready')}</small></section>
        </div>
        <section className="card server-description">
            <h2>{t('overview')}</h2>
            <p>{server.description || t('noDescription')}</p>
            <dl>
                <div><dt>{t('serverId')}</dt><dd><code>{server.serverKey}</code></dd></div>
                <div><dt>{t('mainServer')}</dt><dd>{server.mainServer ? t('yes') : t('no')}</dd></div>
                <div><dt>{t('autoconnect')}</dt><dd>{server.autoconnect ? t('yes') : t('no')}</dd></div>
                <div><dt>{t('updated')}</dt><dd>{new Date(server.updatedAt).toLocaleString()}</dd></div>
            </dl>
        </section>
    </>
}

export function ServerSettingsPage({ user }: { user: ApiUser }): ReactNode {
    const { projectId = '', serverId = '' } = useParams()
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const navigate = useNavigate()
    const detail = useServerDetail(projectId, serverId)
    const canEdit = user.role === 'ADMIN' || user.role === 'EDITOR'
    const remove = useMutation({
        mutationFn: () => {
            if (!detail.data) throw new Error('Server is not loaded')
            return api(`/api/v1/projects/${projectId}/servers/${serverId}`, {
                method: 'DELETE',
                ...jsonBody({ draftVersion: detail.data.project.draftVersion })
            })
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['project', projectId] })
            void navigate(`/projects/${projectId}`)
        }
    })
    const fallback = <LoadingOrError query={detail} />
    if (!detail.data) return fallback
    return <>
        <ServerHeader detail={detail.data} />
        <section className="card">
            <div className="section-heading">
                <h2>{t('settings')}</h2>
                {!canEdit && <span className="pill">{t('readOnly')}</span>}
            </div>
            <ServerForm
                project={detail.data.project}
                server={detail.data.server}
                canEdit={canEdit}
                onDone={() => invalidateServer(queryClient, projectId, serverId)}
            />
        </section>
        {canEdit && <section className="card danger-zone">
            <div><h2>{t('deleteServer')}</h2><p>{t('deleteServerHint')}</p></div>
            <button
                className="danger-button"
                disabled={remove.isPending}
                onClick={() => window.confirm(t('confirmDeleteServer')) && remove.mutate()}
            >{t('deleteServer')}</button>
            <ErrorNotice error={remove.error} />
        </section>}
    </>
}

const LAUNCHER_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const LAUNCHER_VIDEO_TYPES = new Set(['video/mp4', 'video/webm'])

type LauncherVideoSource = '' | 'upload' | 'external' | 'youtube'

function youtubeVideoId(value: string): string | null {
    try {
        const url = new URL(value)
        if (url.protocol !== 'https:') return null
        const host = url.hostname.toLowerCase().replace(/^www\./, '')
        const segments = url.pathname.split('/').filter(Boolean)
        const id = host === 'youtu.be'
            ? segments[0]
            : ['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)
                ? url.pathname === '/watch'
                    ? url.searchParams.get('v')
                    : ['shorts', 'embed'].includes(segments[0] ?? '') ? segments[1] : null
                : null
        return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
    } catch {
        return null
    }
}

function useFilePreview(file: File | null): string | null {
    const [preview, setPreview] = useState<string | null>(null)
    useEffect(() => {
        if (!file) {
            setPreview(null)
            return
        }
        const next = URL.createObjectURL(file)
        setPreview(next)
        return (): void => URL.revokeObjectURL(next)
    }, [file])
    return preview
}

function launcherUploadPreview(projectId: string, uploadId: string | null): string | null {
    return uploadId == null ? null : `/api/v1/projects/${projectId}/uploads/${uploadId}/content`
}

type ImageLoadState = 'idle' | 'loading' | 'loaded' | 'error'

function useImageLoadState(source: string | null): ImageLoadState {
    const [result, setResult] = useState<{ source: string | null, state: ImageLoadState }>({
        source: null,
        state: 'idle'
    })
    useEffect(() => {
        if (!source) {
            setResult({ source: null, state: 'idle' })
            return
        }
        let active = true
        const image = new Image()
        image.onload = (): void => {
            if (active) setResult({ source, state: 'loaded' })
        }
        image.onerror = (): void => {
            if (active) setResult({ source, state: 'error' })
        }
        image.src = source
        return (): void => {
            active = false
            image.onload = null
            image.onerror = null
        }
    }, [source])
    if (!source) return 'idle'
    return result.source === source ? result.state : 'loading'
}

export function ServerLauncherPage({ user }: { user: ApiUser }): ReactNode {
    const { projectId = '', serverId = '' } = useParams()
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const detail = useServerDetail(projectId, serverId)
    const canEdit = user.role === 'ADMIN' || user.role === 'EDITOR'
    const server = detail.data?.server
    const [backgroundFile, setBackgroundFile] = useState<File | null>(null)
    const [logoFile, setLogoFile] = useState<File | null>(null)
    const [videoFile, setVideoFile] = useState<File | null>(null)
    const [videoSource, setVideoSource] = useState<LauncherVideoSource>(server?.launcherUi.video?.source ?? '')
    const [videoUrl, setVideoUrl] = useState(server?.launcherUi.video && server.launcherUi.video.source !== 'upload' ? server.launcherUi.video.url : '')
    const [previewPlaying, setPreviewPlaying] = useState(true)
    const [previewMuted, setPreviewMuted] = useState(true)
    const [videoPreviewError, setVideoPreviewError] = useState(false)
    const [backgroundCleared, setBackgroundCleared] = useState(false)
    const [logoCleared, setLogoCleared] = useState(false)
    const [eyebrow, setEyebrow] = useState(server?.launcherUi.eyebrow ?? '')
    const [title, setTitle] = useState(server?.launcherUi.title ?? '')
    const [tagline, setTagline] = useState(server?.launcherUi.tagline ?? '')
    const [rss, setRss] = useState(server?.launcherUi.rss ?? '')
    const backgroundFilePreview = useFilePreview(backgroundFile)
    const logoFilePreview = useFilePreview(logoFile)
    const videoFilePreview = useFilePreview(videoFile)
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const youtubeRef = useRef<HTMLIFrameElement | null>(null)

    useEffect(() => {
        if (!server) return
        setEyebrow(server.launcherUi.eyebrow)
        setTitle(server.launcherUi.title)
        setTagline(server.launcherUi.tagline)
        setRss(server.launcherUi.rss)
        setBackgroundFile(null)
        setLogoFile(null)
        setVideoFile(null)
        setVideoSource(server.launcherUi.video?.source ?? '')
        setVideoUrl(server.launcherUi.video && server.launcherUi.video.source !== 'upload' ? server.launcherUi.video.url : '')
        setPreviewPlaying(true)
        setPreviewMuted(true)
        setVideoPreviewError(false)
        setBackgroundCleared(false)
        setLogoCleared(false)
    }, [server])

    const uploadImage = async (file: File): Promise<string> => {
        if (!LAUNCHER_IMAGE_TYPES.has(file.type)) {
            throw new Error(t('launcherImageTypeError'))
        }
        const body = new FormData()
        body.append('file', file)
        const upload = await api<{ id: string }>(`/api/v1/projects/${projectId}/uploads`, {
            method: 'POST',
            body
        })
        return upload.id
    }
    const uploadVideo = async (file: File): Promise<string> => {
        if (!LAUNCHER_VIDEO_TYPES.has(file.type)) {
            throw new Error(t('launcherVideoTypeError'))
        }
        const body = new FormData()
        body.append('file', file)
        const upload = await api<{ id: string }>(`/api/v1/projects/${projectId}/uploads`, {
            method: 'POST',
            body
        })
        return upload.id
    }
    const mutation = useMutation({
        mutationFn: async () => {
            if (!detail.data) throw new Error('Server is not loaded')
            let backgroundUploadId = backgroundCleared
                ? null
                : detail.data.server.launcherUi.backgroundUploadId
            let logoUploadId = logoCleared
                ? null
                : detail.data.server.launcherUi.logoUploadId
            if (backgroundFile) backgroundUploadId = await uploadImage(backgroundFile)
            if (logoFile) logoUploadId = await uploadImage(logoFile)
            let video: ManagedServer['launcherUi']['video'] = null
            if (videoSource === 'upload') {
                let uploadId = detail.data.server.launcherUi.video?.source === 'upload'
                    ? detail.data.server.launcherUi.video.uploadId
                    : null
                if (videoFile) uploadId = await uploadVideo(videoFile)
                if (!uploadId) throw new Error(t('launcherVideoFileRequired'))
                video = { source: 'upload', uploadId }
            } else if (videoSource === 'external' || videoSource === 'youtube') {
                if (!videoUrl.trim()) throw new Error(t('launcherVideoUrlRequired'))
                video = { source: videoSource, url: videoUrl.trim() }
            }
            return api<{ draftVersion: number }>(
                `/api/v1/projects/${projectId}/servers/${serverId}/launcher-ui`,
                {
                    method: 'PATCH',
                    ...jsonBody({
                        draftVersion: detail.data.project.draftVersion,
                        backgroundUploadId,
                        logoUploadId,
                        video,
                        eyebrow,
                        title,
                        tagline,
                        rss
                    })
                }
            )
        },
        onSuccess: () => invalidateServer(queryClient, projectId, serverId)
    })
    const storedBackground = backgroundCleared || !server
        ? null
        : launcherUploadPreview(projectId, server.launcherUi.backgroundUploadId)
    const storedLogo = logoCleared || !server
        ? null
        : launcherUploadPreview(projectId, server.launcherUi.logoUploadId)
    const storedVideo = !server || videoSource !== 'upload' || server.launcherUi.video?.source !== 'upload'
        ? null
        : launcherUploadPreview(projectId, server.launcherUi.video.uploadId)
    const backgroundPreview = backgroundFilePreview ?? storedBackground
    const logoPreview = logoFilePreview ?? storedLogo
    const videoPreview = videoSource === 'upload'
        ? videoFilePreview ?? storedVideo
        : videoSource === 'external' ? videoUrl.trim() || null : null
    const youtubeId = videoSource === 'youtube' ? youtubeVideoId(videoUrl.trim()) : null
    const backgroundLoadState = useImageLoadState(backgroundPreview)
    const logoLoadState = useImageLoadState(logoPreview)
    const hasMissingImage = backgroundLoadState === 'error' || logoLoadState === 'error'
    const hasVideo = Boolean(videoPreview || youtubeId)
    useEffect(() => {
        setVideoPreviewError(false)
    }, [videoPreview, youtubeId])
    useEffect(() => {
        const video = videoRef.current
        if (video) {
            video.muted = previewMuted
            if (previewPlaying) {
                void video.play().catch(() => setVideoPreviewError(true))
            } else {
                video.pause()
            }
        }
        const frame = youtubeRef.current
        if (frame?.contentWindow) {
            const command = (func: string): void => frame.contentWindow?.postMessage(JSON.stringify({
                event: 'command',
                func,
                args: []
            }), 'https://www.youtube.com')
            command(previewMuted ? 'mute' : 'unMute')
            command(previewPlaying ? 'playVideo' : 'pauseVideo')
        }
    }, [previewMuted, previewPlaying, videoPreview, youtubeId])
    const fallback = <LoadingOrError query={detail} />
    if (!detail.data || !server) return fallback
    const handleImage = (
        file: File | undefined,
        setter: (value: File | null) => void,
        clearSetter: (value: boolean) => void
    ): void => {
        if (!file) return
        if (!LAUNCHER_IMAGE_TYPES.has(file.type)) {
            window.alert(t('launcherImageTypeError'))
            return
        }
        setter(file)
        clearSetter(false)
    }
    const handleVideo = (file: File | undefined): void => {
        if (!file) return
        if (!LAUNCHER_VIDEO_TYPES.has(file.type)) {
            window.alert(t('launcherVideoTypeError'))
            return
        }
        setVideoFile(file)
        setVideoPreviewError(false)
    }
    return <>
        <ServerHeader detail={detail.data} />
        <section className="card launcher-editor-card">
            <div className="section-heading">
                <div>
                    <h2>{t('launcherPage')}</h2>
                    <p className="muted">{t('launcherPageHint')}</p>
                </div>
                {!canEdit && <span className="pill">{t('readOnly')}</span>}
            </div>
            <div className="launcher-preview-frame">
                <div className="launcher-header-preview">
                    <span className="launcher-header-preview-label" title={eyebrow.trim() || t('launcherFallbackEyebrow')}>
                        {eyebrow.trim() || t('launcherFallbackEyebrow')}
                    </span>
                    <div className="launcher-header-preview-tabs" aria-hidden="true">
                        <span className="active">{t('launcherPreviewPlay')}</span>
                        <span>{t('launcherPreviewMods')}</span>
                        <span>{t('launcherPreviewUpdates')}</span>
                    </div>
                </div>
                <div
                    className="launcher-hero-preview"
                    style={backgroundLoadState === 'loaded' && backgroundPreview
                        ? { backgroundImage: `url(${JSON.stringify(backgroundPreview)})` }
                        : undefined}
                >
                    {videoPreview && <video
                        ref={videoRef}
                        className={`launcher-hero-preview-video${previewPlaying ? ' is-playing' : ''}`}
                        src={videoPreview}
                        muted={previewMuted}
                        loop
                        playsInline
                        autoPlay={previewPlaying}
                        onCanPlay={() => setVideoPreviewError(false)}
                        onError={() => setVideoPreviewError(true)}
                    />}
                    {youtubeId && <iframe
                        ref={youtubeRef}
                        className={`launcher-hero-preview-video${previewPlaying ? ' is-playing' : ''}`}
                        src={`https://www.youtube.com/embed/${youtubeId}?enablejsapi=1&autoplay=1&mute=1&loop=1&playlist=${youtubeId}&controls=0&playsinline=1&origin=${encodeURIComponent(window.location.origin)}`}
                        title={t('launcherVideoPreview')}
                        allow="autoplay; encrypted-media"
                    />}
                    <div className="launcher-hero-preview-shade" />
                    <div className="launcher-hero-preview-content">
                        {logoPreview && logoLoadState === 'loaded'
                            ? <img src={logoPreview} alt="" />
                            : <div className="launcher-preview-logo-placeholder">MAPLECRAFT</div>}
                        <strong>{title || server.name}</strong>
                        <p>{tagline || server.description || t('launcherFallbackTagline')}</p>
                    </div>
                    {!backgroundPreview && <div className="launcher-preview-fallback">{t('launcherUsesDefault')}</div>}
                    {hasMissingImage && <div className="launcher-preview-missing" role="status">{t('launcherImageMissing')}</div>}
                    {videoPreviewError && <div className="launcher-preview-missing" role="status">{t('launcherVideoPreviewError')}</div>}
                    {hasVideo && <div className="launcher-preview-media-controls">
                        <button
                            type="button"
                            aria-label={previewPlaying ? t('launcherPauseVideo') : t('launcherPlayVideo')}
                            aria-pressed={previewPlaying}
                            onClick={() => setPreviewPlaying(value => !value)}
                        >{previewPlaying ? 'Ⅱ' : '▶'}</button>
                        <button
                            type="button"
                            aria-label={previewMuted ? t('launcherUnmuteVideo') : t('launcherMuteVideo')}
                            aria-pressed={!previewMuted}
                            onClick={() => setPreviewMuted(value => !value)}
                        >{previewMuted ? '🔇' : '🔊'}</button>
                    </div>}
                </div>
            </div>
            <form className="launcher-editor-form" onSubmit={event => {
                event.preventDefault()
                if (canEdit) mutation.mutate()
            }}>
                <div className="launcher-image-fields">
                    <label className="launcher-image-field">
                        <span>{t('launcherBackground')}</span>
                        <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            disabled={!canEdit}
                            onChange={event => handleImage(event.target.files?.[0], setBackgroundFile, setBackgroundCleared)}
                        />
                        <small className={backgroundLoadState === 'error' ? 'image-missing-text' : undefined}>
                            {backgroundLoadState === 'error'
                                ? t('launcherImageMissing')
                                : backgroundPreview ? t('launcherImageConfigured') : t('launcherUsesDefault')}
                        </small>
                        {canEdit && backgroundPreview && <button type="button" className="danger-link" onClick={() => {
                            setBackgroundFile(null)
                            setBackgroundCleared(true)
                        }}>{t('launcherClearImage')}</button>}
                    </label>
                    <label className="launcher-image-field">
                        <span>{t('launcherLogo')}</span>
                        <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            disabled={!canEdit}
                            onChange={event => handleImage(event.target.files?.[0], setLogoFile, setLogoCleared)}
                        />
                        <small className={logoLoadState === 'error' ? 'image-missing-text' : undefined}>
                            {logoLoadState === 'error'
                                ? t('launcherImageMissing')
                                : logoPreview ? t('launcherImageConfigured') : t('launcherUsesDefault')}
                        </small>
                        {canEdit && logoPreview && <button type="button" className="danger-link" onClick={() => {
                            setLogoFile(null)
                            setLogoCleared(true)
                        }}>{t('launcherClearImage')}</button>}
                    </label>
                </div>
                <div className="launcher-video-field">
                    <label>
                        <span>{t('launcherVideo')}</span>
                        <select
                            value={videoSource}
                            disabled={!canEdit}
                            onChange={event => {
                                const source = event.target.value as LauncherVideoSource
                                const existingVideo = server.launcherUi.video
                                const existingUrl = existingVideo && existingVideo.source !== 'upload'
                                    ? existingVideo.url
                                    : ''
                                setVideoSource(source)
                                setVideoFile(null)
                                setVideoUrl(source === existingVideo?.source && source !== 'upload'
                                    ? existingUrl
                                    : '')
                                setVideoPreviewError(false)
                            }}
                        >
                            <option value="">{t('launcherVideoNone')}</option>
                            <option value="upload">{t('launcherVideoUpload')}</option>
                            <option value="external">{t('launcherVideoExternal')}</option>
                            <option value="youtube">{t('launcherVideoYouTube')}</option>
                        </select>
                    </label>
                    {videoSource === 'upload' && <label>
                        <span>{t('chooseFile')}</span>
                        <input
                            type="file"
                            accept="video/mp4,video/webm"
                            disabled={!canEdit}
                            onChange={event => handleVideo(event.target.files?.[0])}
                        />
                        <small>{videoFile?.name ?? (storedVideo ? t('launcherVideoConfigured') : t('launcherVideoFileRequired'))}</small>
                    </label>}
                    {(videoSource === 'external' || videoSource === 'youtube') && <label className="wide">
                        <span>{videoSource === 'youtube' ? t('launcherVideoYouTubeUrl') : t('launcherVideoExternalUrl')}</span>
                        <input
                            type="url"
                            value={videoUrl}
                            disabled={!canEdit}
                            placeholder={videoSource === 'youtube' ? 'https://www.youtube.com/watch?v=…' : 'https://cdn.example.com/hero.mp4'}
                            onChange={event => setVideoUrl(event.target.value)}
                        />
                        <small>{videoSource === 'youtube' ? t('launcherVideoYouTubeHint') : t('launcherVideoExternalHint')}</small>
                    </label>}
                    {videoSource && canEdit && <button type="button" className="danger-link" onClick={() => {
                        setVideoSource('')
                        setVideoFile(null)
                        setVideoUrl('')
                        setVideoPreviewError(false)
                    }}>{t('launcherClearVideo')}</button>}
                </div>
                <div className="form-grid launcher-copy-fields">
                    <label>{t('launcherEyebrow')}<input value={eyebrow} maxLength={128} disabled={!canEdit} onChange={event => setEyebrow(event.target.value)} /></label>
                    <label>{t('launcherTitle')}<input value={title} maxLength={128} disabled={!canEdit} onChange={event => setTitle(event.target.value)} /></label>
                    <label className="wide">{t('launcherTagline')}<textarea value={tagline} maxLength={500} disabled={!canEdit} onChange={event => setTagline(event.target.value)} /></label>
                    <label className="wide">{t('launcherNewsRss')}<input type="url" value={rss} disabled={!canEdit} placeholder={detail.data.project.rss} onChange={event => setRss(event.target.value)} /></label>
                </div>
                <p className="field-hint">{t('launcherEmptyFallback')}</p>
                <ErrorNotice error={mutation.error} />
                {canEdit && <div className="actions">
                    <button className="primary" disabled={mutation.isPending}>{mutation.isPending ? t('working') : t('save')}</button>
                </div>}
            </form>
        </section>
    </>
}

interface SystemFolder {
    kind: 'system'
    id: string
    path: string
    name: string
    warning?: boolean
}

interface DirectoryEntry {
    kind: 'directory'
    id: string
    path: string
    name: string
    directory: ServerDirectory
}

interface ModuleEntry {
    kind: 'module'
    id: string
    path: string
    name: string
    module: ManagedModule
}

type ExplorerEntry = SystemFolder | DirectoryEntry | ModuleEntry

function parentPath(path: string): string {
    return path.split('/').slice(0, -1).join('/')
}

function baseName(path: string): string {
    return path.split('/').at(-1) ?? path
}

function pathInside(path: string, parent: string): boolean {
    const key = path.toLowerCase()
    const parentKey = parent.toLowerCase()
    if (parentKey === '') return true
    return key === parentKey || key.startsWith(`${parentKey}/`)
}

function optionalFolder(mode: OptionalMode): string {
    if (mode === 'OPTIONAL_ON') return 'optionalon'
    if (mode === 'OPTIONAL_OFF') return 'optionaloff'
    return 'required'
}

function modeFromFolder(folder: string): OptionalMode {
    if (folder === 'optionalon') return 'OPTIONAL_ON'
    if (folder === 'optionaloff') return 'OPTIONAL_OFF'
    return 'REQUIRED'
}

function moduleExplorerPath(module: ManagedModule): string {
    if (module.type === 'File') return `files/${module.relativePath ?? module.fileName ?? module.id}`
    if (module.type === 'Library') return `libraries/${module.fileName ?? module.originalName ?? module.id}`
    const root = module.type === 'ForgeMod' ? 'forgemods' : 'fabricmods'
    return `${root}/${optionalFolder(module.optionalMode)}/${module.fileName ?? module.originalName ?? module.id}`
}

function displayFileSize(size: number | null, bytes: string): string {
    if (size == null) return '—'
    if (size < 1024) return `${size.toLocaleString()} ${bytes}`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function rootFolders(server: ManagedServer, labels: {
    files: string
    libraries: string
    forgeMods: string
    fabricMods: string
}): SystemFolder[] {
    const hasForgeModules = server.modules.some(module => module.type === 'ForgeMod')
    const hasFabricModules = server.modules.some(module => module.type === 'FabricMod')
    const roots: SystemFolder[] = [
        { kind: 'system', id: 'files', path: 'files', name: labels.files },
        { kind: 'system', id: 'libraries', path: 'libraries', name: labels.libraries }
    ]
    if (server.forgeVersion || hasForgeModules) {
        roots.push({
            kind: 'system',
            id: 'forgemods',
            path: 'forgemods',
            name: labels.forgeMods,
            warning: !server.forgeVersion
        })
    }
    if (server.fabricVersion || hasFabricModules) {
        roots.push({
            kind: 'system',
            id: 'fabricmods',
            path: 'fabricmods',
            name: labels.fabricMods,
            warning: !server.fabricVersion
        })
    }
    return roots
}

function explorerPathChain(path: string): string[] {
    const chain = ['']
    let current = ''
    for (const part of path.split('/').filter(Boolean)) {
        current = current ? `${current}/${part}` : part
        chain.push(current)
    }
    return chain
}

function ExplorerTreeRow({
    name,
    path,
    depth,
    currentPath,
    icon,
    warning = false,
    hasChildren,
    expanded,
    onToggle,
    onOpen
}: {
    name: string
    path: string
    depth: number
    currentPath: string
    icon: string
    warning?: boolean
    hasChildren: boolean
    expanded: boolean
    onToggle: (path: string) => void
    onOpen: (path: string) => void
}): ReactNode {
    const { t } = useTranslation()
    return <div className="explorer-tree-row" style={{ paddingLeft: `${depth * 14}px` }}>
        {hasChildren
            ? <button
                type="button"
                className="tree-toggle"
                aria-expanded={expanded}
                aria-label={t(expanded ? 'collapseFolder' : 'expandFolder', { name })}
                onClick={() => onToggle(path)}
            ><span aria-hidden="true">{expanded ? '▾' : '▸'}</span></button>
            : <span className="tree-toggle-spacer" aria-hidden="true" />}
        <button
            type="button"
            className={currentPath === path ? 'tree-open active' : 'tree-open'}
            aria-label={name}
            aria-current={currentPath === path ? 'page' : undefined}
            onClick={() => onOpen(path)}
        >
            <span className="tree-icon" aria-hidden="true">{icon}</span>
            <span className="tree-label">{name}</span>
            {warning && <span className="tree-warning" aria-hidden="true">!</span>}
        </button>
    </div>
}

function ExplorerTree({
    detail,
    currentPath,
    expandedPaths,
    onToggle,
    onOpen
}: {
    detail: ServerDetail
    currentPath: string
    expandedPaths: ReadonlySet<string>
    onToggle: (path: string) => void
    onOpen: (path: string) => void
}): ReactNode {
    const { t } = useTranslation()
    const roots = rootFolders(detail.server, {
        files: t('regularFiles'),
        libraries: t('libraries'),
        forgeMods: 'Forge Mods',
        fabricMods: 'Fabric Mods'
    })
    const directories = [...detail.directories].sort((left, right) => left.path.localeCompare(right.path))
    const directoryParents = new Set(directories.map(directory => {
        const parent = parentPath(directory.path)
        return parent ? `files/${parent}` : 'files'
    }))
    const rootsVisible = expandedPaths.has('')
    return <aside className="explorer-tree" aria-label={t('folderNavigation')}>
        <ExplorerTreeRow
            name={detail.server.name}
            path=""
            depth={0}
            currentPath={currentPath}
            icon="▣"
            hasChildren={roots.length > 0}
            expanded={rootsVisible}
            onToggle={onToggle}
            onOpen={onOpen}
        />
        {rootsVisible && roots.map(root => {
            const hasChildren = root.path === 'files'
                ? directoryParents.has('files')
                : root.path === 'forgemods' || root.path === 'fabricmods'
            const expanded = expandedPaths.has(root.path)
            return <div key={root.id}>
                <ExplorerTreeRow
                    name={root.name}
                    path={root.path}
                    depth={1}
                    currentPath={currentPath}
                    icon="⌙"
                    warning={root.warning}
                    hasChildren={hasChildren}
                    expanded={expanded}
                    onToggle={onToggle}
                    onOpen={onOpen}
                />
                {root.path === 'files' && expanded && directories.map(directory => {
                    const logicalPath = `files/${directory.path}`
                    const depth = directory.path.split('/').length
                    const parentPaths = explorerPathChain(parentPath(logicalPath)).filter(path => path !== '')
                    if (!parentPaths.every(path => expandedPaths.has(path))) return null
                    return <ExplorerTreeRow
                        key={directory.id}
                        name={baseName(directory.path)}
                        path={logicalPath}
                        depth={depth + 1}
                        currentPath={currentPath}
                        icon="⌙"
                        hasChildren={directoryParents.has(logicalPath)}
                        expanded={expandedPaths.has(logicalPath)}
                        onToggle={onToggle}
                        onOpen={onOpen}
                    />
                })}
                {(root.path === 'forgemods' || root.path === 'fabricmods') && expanded
                    && ['required', 'optionalon', 'optionaloff'].map(folder => {
                        const path = `${root.path}/${folder}`
                        return <ExplorerTreeRow
                            key={folder}
                            name={t(folder)}
                            path={path}
                            depth={2}
                            currentPath={currentPath}
                            icon="⌙"
                            hasChildren={false}
                            expanded={false}
                            onToggle={onToggle}
                            onOpen={onOpen}
                        />
                    })}
            </div>
        })}
    </aside>
}

function currentEntries(
    detail: ServerDetail,
    currentPath: string,
    search: string,
    labels: {
        files: string
        libraries: string
        forgeMods: string
        fabricMods: string
        required: string
        optionalOn: string
        optionalOff: string
    }
): ExplorerEntry[] {
    const roots = rootFolders(detail.server, {
        files: labels.files,
        libraries: labels.libraries,
        forgeMods: labels.forgeMods,
        fabricMods: labels.fabricMods
    })
    const query = search.trim().toLowerCase()
    if (currentPath === '') {
        if (!query) return roots
        const directoryEntries: DirectoryEntry[] = detail.directories
            .filter(directory => directory.path.toLowerCase().includes(query))
            .map(directory => ({
                kind: 'directory',
                id: directory.id,
                path: `files/${directory.path}`,
                name: baseName(directory.path),
                directory
            }))
        const moduleEntries: ModuleEntry[] = detail.server.modules
            .filter(module => `${module.displayName} ${module.fileName ?? ''} ${module.relativePath ?? ''}`.toLowerCase().includes(query))
            .map(module => ({
                kind: 'module',
                id: module.id,
                path: moduleExplorerPath(module),
                name: module.type === 'File'
                    ? baseName(module.relativePath ?? module.fileName ?? module.id)
                    : module.fileName ?? module.originalName ?? module.displayName,
                module
            }))
        return [...directoryEntries, ...moduleEntries]
    }
    if (currentPath === 'files' || currentPath.startsWith('files/')) {
        const relative = currentPath === 'files' ? '' : currentPath.slice('files/'.length)
        const directories: DirectoryEntry[] = detail.directories
            .filter(directory => query
                ? pathInside(directory.path, relative) && directory.path.toLowerCase().includes(query)
                : parentPath(directory.path).toLowerCase() === relative.toLowerCase())
            .map(directory => ({
                kind: 'directory',
                id: directory.id,
                path: `files/${directory.path}`,
                name: baseName(directory.path),
                directory
            }))
        const modules: ModuleEntry[] = detail.server.modules
            .filter(module => {
                if (module.type !== 'File' || !module.relativePath) return false
                if (query) {
                    return pathInside(module.relativePath, relative)
                        && `${module.displayName} ${module.relativePath}`.toLowerCase().includes(query)
                }
                return parentPath(module.relativePath).toLowerCase() === relative.toLowerCase()
            })
            .map(module => ({
                kind: 'module',
                id: module.id,
                path: moduleExplorerPath(module),
                name: baseName(module.relativePath!),
                module
            }))
        return [...directories, ...modules]
    }
    if (currentPath === 'forgemods' || currentPath === 'fabricmods') {
        return ['required', 'optionalon', 'optionaloff'].map(folder => ({
            kind: 'system' as const,
            id: `${currentPath}-${folder}`,
            path: `${currentPath}/${folder}`,
            name: folder === 'required'
                ? labels.required
                : folder === 'optionalon'
                    ? labels.optionalOn
                    : labels.optionalOff
        }))
    }
    const modules = detail.server.modules.filter(module => {
        const path = moduleExplorerPath(module)
        const isDirectChild = parentPath(path).toLowerCase() === currentPath.toLowerCase()
        return isDirectChild
            && (!query || `${module.displayName} ${module.fileName ?? ''}`.toLowerCase().includes(query))
    })
    return modules.map(module => ({
        kind: 'module',
        id: module.id,
        path: moduleExplorerPath(module),
        name: module.fileName ?? module.originalName ?? module.displayName,
        module
    }))
}

function sortEntries(entries: ExplorerEntry[], sortBy: ExplorerSort, direction: 'asc' | 'desc'): ExplorerEntry[] {
    const factor = direction === 'asc' ? 1 : -1
    return [...entries].sort((left, right) => {
        if (left.kind !== 'module' && right.kind === 'module') return -1
        if (left.kind === 'module' && right.kind !== 'module') return 1
        let result = 0
        if (sortBy === 'type') {
            const leftType = left.kind === 'module' ? left.module.type : left.kind
            const rightType = right.kind === 'module' ? right.module.type : right.kind
            result = leftType.localeCompare(rightType)
        } else if (sortBy === 'size') {
            const leftSize = left.kind === 'module' ? left.module.size ?? -1 : -1
            const rightSize = right.kind === 'module' ? right.module.size ?? -1 : -1
            result = leftSize - rightSize
        } else if (sortBy === 'updated') {
            const leftTime = left.kind === 'module'
                ? Date.parse(left.module.updatedAt)
                : left.kind === 'directory'
                    ? Date.parse(left.directory.updatedAt)
                    : 0
            const rightTime = right.kind === 'module'
                ? Date.parse(right.module.updatedAt)
                : right.kind === 'directory'
                    ? Date.parse(right.directory.updatedAt)
                    : 0
            result = leftTime - rightTime
        } else {
            result = left.name.localeCompare(right.name)
        }
        return result * factor
    })
}

function uploadTarget(currentPath: string, server: ManagedServer): {
    type: ModuleType
    optionalMode: OptionalMode
    relativeDirectory: string
} | null {
    if (currentPath === 'files' || currentPath.startsWith('files/')) {
        return {
            type: 'File',
            optionalMode: 'REQUIRED',
            relativeDirectory: currentPath === 'files' ? '' : currentPath.slice('files/'.length)
        }
    }
    if (currentPath === 'libraries') {
        return { type: 'Library', optionalMode: 'REQUIRED', relativeDirectory: '' }
    }
    const [root, folder, extra] = currentPath.split('/')
    if (extra || !folder) return null
    if (root === 'forgemods' && server.forgeVersion) {
        return { type: 'ForgeMod', optionalMode: modeFromFolder(folder), relativeDirectory: '' }
    }
    if (root === 'fabricmods' && server.fabricVersion) {
        return { type: 'FabricMod', optionalMode: modeFromFolder(folder), relativeDirectory: '' }
    }
    return null
}

function ServerExplorer({ detail, canEdit }: { detail: ServerDetail, canEdit: boolean }): ReactNode {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const [currentPath, setCurrentPath] = useState('')
    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set(['']))
    const [search, setSearch] = useState('')
    const [sortBy, setSortBy] = useState<ExplorerSort>('name')
    const [direction, setDirection] = useState<'asc' | 'desc'>('asc')
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set())
    const [columnRatios, setColumnRatios] = useState<ExplorerColumnRatios>(loadExplorerColumnRatios)
    const [tableViewportWidth, setTableViewportWidth] = useState(EXPLORER_TABLE_MINIMUM_WIDTH)
    const [dragActive, setDragActive] = useState(false)
    const [dropReading, setDropReading] = useState(false)
    const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null)
    const [uploadSuccess, setUploadSuccess] = useState<UploadSuccess | null>(null)
    const [uploadInputError, setUploadInputError] = useState<string | null>(null)
    const uploadInput = useRef<HTMLInputElement>(null)
    const replaceInput = useRef<HTMLInputElement>(null)
    const selectAllInput = useRef<HTMLInputElement>(null)
    const tableWrap = useRef<HTMLDivElement>(null)
    const columnResize = useRef<{
        pointerId: number
        startX: number
        leftKey: ExplorerColumnKey
        rightKey: ExplorerColumnKey
        leftWidth: number
        rightWidth: number
        dataWidth: number
    } | null>(null)
    const selectionAnchor = useRef('')
    const entries = useMemo(
        () => sortEntries(currentEntries(detail, currentPath, search, {
            files: t('regularFiles'),
            libraries: t('libraries'),
            forgeMods: 'Forge Mods',
            fabricMods: 'Fabric Mods',
            required: t('required'),
            optionalOn: t('optionalon'),
            optionalOff: t('optionaloff')
        }), sortBy, direction),
        [currentPath, detail, direction, search, sortBy, t]
    )
    const selectableEntries = useMemo(() => entries.filter(entry => entry.kind !== 'system'), [entries])
    const selectableKeys = useMemo(
        () => selectableEntries.map(entry => `${entry.kind}:${entry.id}`),
        [selectableEntries]
    )
    const selectableKeySignature = selectableKeys.join('\n')
    const selectedEntries = selectableEntries.filter(entry => selectedKeys.has(`${entry.kind}:${entry.id}`))
    const selected = selectedEntries.length === 1 ? selectedEntries[0] : undefined
    const allSelected = selectableKeys.length > 0 && selectableKeys.every(key => selectedKeys.has(key))
    const target = uploadTarget(currentPath, detail.server)
    const minimumDataWidth = Math.max(...EXPLORER_COLUMN_CONFIGS.map(config =>
        config.minimumWidth / columnRatios[config.key]
    ))
    const tableWidth = Math.ceil(Math.max(
        EXPLORER_TABLE_MINIMUM_WIDTH,
        tableViewportWidth,
        EXPLORER_SELECTION_WIDTH + minimumDataWidth
    ))
    const tableDataWidth = tableWidth - EXPLORER_SELECTION_WIDTH
    const columnWidths = Object.fromEntries(EXPLORER_COLUMN_CONFIGS.map(config => [
        config.key,
        columnRatios[config.key] * tableDataWidth
    ])) as Record<ExplorerColumnKey, number>
    const explorerColumns = EXPLORER_COLUMN_CONFIGS.map(config => ({
        ...config,
        label: t(config.labelKey)
    }))
    const action = useMutation({
        mutationFn: (operation: () => Promise<unknown>) => operation(),
        onSuccess: () => {
            setSelectedKeys(new Set())
            selectionAnchor.current = ''
        },
        onSettled: () => {
            invalidateServer(queryClient, detail.project.id, detail.server.id)
        }
    })
    const downloadAction = useMutation({
        mutationFn: (operation: () => Promise<void>) => operation()
    })
    useEffect(() => {
        setSelectedKeys(new Set())
        selectionAnchor.current = ''
        setDragActive(false)
        setUploadSuccess(null)
        setUploadInputError(null)
    }, [currentPath])
    useEffect(() => {
        setCurrentPath('')
        setExpandedPaths(new Set(['']))
    }, [detail.server.id])
    useEffect(() => {
        const visibleKeys = new Set(selectableKeys)
        setSelectedKeys(current => {
            const next = new Set([...current].filter(key => visibleKeys.has(key)))
            return next.size === current.size ? current : next
        })
        if (selectionAnchor.current && !visibleKeys.has(selectionAnchor.current)) {
            selectionAnchor.current = ''
        }
    }, [selectableKeySignature])
    useEffect(() => {
        if (!selectAllInput.current) return
        selectAllInput.current.indeterminate = selectedEntries.length > 0 && !allSelected
    }, [allSelected, selectedEntries.length])
    useEffect(() => {
        if (uploadSuccess == null) return
        const timer = window.setTimeout(() => setUploadSuccess(null), 5000)
        return (): void => window.clearTimeout(timer)
    }, [uploadSuccess])
    useEffect(() => {
        const element = tableWrap.current
        if (!element) return
        const observer = new ResizeObserver(entries => {
            const width = entries[0]?.contentRect.width
            if (width && Number.isFinite(width)) setTableViewportWidth(Math.round(width))
        })
        observer.observe(element)
        return (): void => observer.disconnect()
    }, [])
    useEffect(() => {
        try {
            window.localStorage.setItem(EXPLORER_COLUMN_STORAGE_KEY, JSON.stringify(columnRatios))
        } catch {
            // Explorer remains usable when browser storage is unavailable.
        }
    }, [columnRatios])

    const upload = async (file: File): Promise<{ id: string }> => {
        const body = new FormData()
        body.append('file', file)
        return api(`/api/v1/projects/${detail.project.id}/uploads`, { method: 'POST', body })
    }
    const moduleUrl = (moduleId: string): string =>
        `/api/v1/projects/${detail.project.id}/servers/${detail.server.id}/modules/${moduleId}`

    const createFolder = (): void => {
        const name = window.prompt(t('newFolderName'))
        if (!name) return
        const relative = currentPath === 'files' ? '' : currentPath.slice('files/'.length)
        const path = relative ? `${relative}/${name}` : name
        action.mutate(() => api(
            `/api/v1/projects/${detail.project.id}/servers/${detail.server.id}/directories`,
            {
                method: 'POST',
                ...jsonBody({ draftVersion: detail.project.draftVersion, path })
            }
        ))
    }
    const handleUploadBatch = (files: UploadBatchFile[], directories: string[]): void => {
        if (!target || files.length === 0 && directories.length === 0 || action.isPending) return
        const batchTarget = target
        const pathKey = (path: string): string => path.normalize('NFC').toLowerCase()
        const relativeBase = batchTarget.type === 'File' ? batchTarget.relativeDirectory : ''
        const resolvedDirectories = [...new Set(directories.map(path =>
            relativeBase ? `${relativeBase}/${path}` : path
        ))].sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right))
        const resolvedFiles = files.map(value => ({
            file: value.file,
            relativePath: batchTarget.type === 'File'
                ? (relativeBase ? `${relativeBase}/${value.relativePath}` : value.relativePath)
                : value.file.name
        })).sort((left, right) => left.relativePath.localeCompare(right.relativePath))
        if (resolvedDirectories.some(path => !isSafeRelativePath(path))
            || resolvedFiles.some(value => batchTarget.type === 'File' && !isSafeRelativePath(value.relativePath))) {
            setUploadInputError(t('uploadInvalidPath'))
            return
        }
        if (batchTarget.type !== 'File' && directories.length > 0) {
            setUploadInputError(t('uploadFoldersFilesOnly'))
            return
        }
        const existingDirectories = new Set(detail.directories.map(directory => pathKey(directory.path)))
        const existingFiles = new Set(detail.server.modules
            .filter(module => module.type === 'File' && module.relativePath)
            .map(module => pathKey(module.relativePath!)))
        const incomingDirectories = new Set<string>()
        for (const path of resolvedDirectories) {
            const key = pathKey(path)
            if (existingFiles.has(key)) {
                setUploadInputError(t('uploadPathConflict', { path }))
                return
            }
            incomingDirectories.add(key)
        }
        const incomingFiles = new Set<string>()
        for (const value of resolvedFiles) {
            const key = pathKey(value.relativePath)
            if (incomingFiles.has(key)
                || batchTarget.type === 'File'
                    && (existingFiles.has(key) || existingDirectories.has(key) || incomingDirectories.has(key))) {
                setUploadInputError(t('uploadPathConflict', { path: value.relativePath }))
                return
            }
            incomingFiles.add(key)
        }
        const directoriesToCreate = resolvedDirectories.filter(path => !existingDirectories.has(pathKey(path)))
        const total = resolvedFiles.length
        setUploadSuccess(null)
        setUploadInputError(null)
        action.mutate(async () => {
            let completed = 0
            let createdFolders = 0
            let draftVersion = detail.project.draftVersion
            try {
                for (const path of directoriesToCreate) {
                    setUploadProgress({
                        phase: 'folders',
                        completed: createdFolders,
                        total: directoriesToCreate.length,
                        currentFile: path
                    })
                    const created = await api<{ draftVersion: number }>(
                        `/api/v1/projects/${detail.project.id}/servers/${detail.server.id}/directories`,
                        {
                            method: 'POST',
                            ...jsonBody({ draftVersion, path })
                        }
                    )
                    draftVersion = created.draftVersion
                    createdFolders += 1
                }
                for (const value of resolvedFiles) {
                    setUploadProgress({
                        phase: 'files',
                        completed,
                        total,
                        currentFile: value.relativePath
                    })
                    let stored: { id: string }
                    try {
                        stored = await upload(value.file)
                    } catch (error) {
                        throw new Error(t('uploadBatchFailed', {
                            completed,
                            total,
                            fileName: value.relativePath,
                            reason: errorMessage(error)
                        }))
                    }
                    const relativePath = batchTarget.type === 'File'
                        ? value.relativePath
                        : null
                    try {
                        const created = await api<{ id: string, draftVersion: number }>(
                            `/api/v1/projects/${detail.project.id}/servers/${detail.server.id}/modules`,
                            {
                                method: 'POST',
                                ...jsonBody({
                                    draftVersion,
                                    uploadId: stored.id,
                                    type: batchTarget.type,
                                    displayName: value.file.name,
                                    fileName: value.file.name,
                                    relativePath,
                                    optionalMode: batchTarget.optionalMode,
                                    sortOrder: detail.server.modules.length + completed
                                })
                            }
                        )
                        draftVersion = created.draftVersion
                    } catch (error) {
                        await api(`/api/v1/projects/${detail.project.id}/uploads/${stored.id}`, {
                            method: 'DELETE'
                        }).catch(() => undefined)
                        throw new Error(t('uploadBatchFailed', {
                            completed,
                            total,
                            fileName: value.relativePath,
                            reason: errorMessage(error)
                        }))
                    }
                    completed += 1
                }
                setUploadSuccess({ files: completed, folders: createdFolders })
                return { uploaded: completed, createdFolders }
            } finally {
                setUploadProgress(null)
            }
        })
    }
    const handleUploads = (files: File[]): void => handleUploadBatch(
        files.map(file => ({ file, relativePath: file.name })),
        []
    )
    const handleDragEnter = (event: DragEvent<HTMLDivElement>): void => {
        if (!canEdit || !target || action.isPending || dropReading) return
        event.preventDefault()
        setDragActive(true)
    }
    const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
        event.preventDefault()
        if (!canEdit || !target || action.isPending || dropReading) return
        event.dataTransfer.dropEffect = 'copy'
        setDragActive(true)
    }
    const handleDragLeave = (event: DragEvent<HTMLDivElement>): void => {
        const nextTarget = event.relatedTarget
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
        setDragActive(false)
    }
    const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
        event.preventDefault()
        setDragActive(false)
        if (!canEdit || action.isPending || dropReading) return
        if (!target) {
            setUploadInputError(t('uploadUnavailableHere'))
            return
        }
        const containsDirectory = hasDroppedDirectory(event.dataTransfer.items)
        if (containsDirectory && !(currentPath === 'files' || currentPath.startsWith('files/'))) {
            setUploadInputError(t('uploadFoldersFilesOnly'))
            return
        }
        if (!containsDirectory) {
            const files = Array.from(event.dataTransfer.files)
            if (files.length === 0 && event.dataTransfer.items.length > 0) {
                setUploadInputError(t('uploadDirectoryApiUnsupported'))
                return
            }
            handleUploads(files)
            return
        }
        setDropReading(true)
        void collectDroppedTree(event.dataTransfer.items).then(tree => {
            setDropReading(false)
            if (!tree) {
                setUploadInputError(t('uploadDirectoryApiUnsupported'))
                return
            }
            handleUploadBatch(tree.files, tree.directories)
        }).catch(error => {
            setDropReading(false)
            setUploadInputError(errorMessage(error))
        })
    }
    const selectedRefs = (): ExplorerEntryRef[] => selectedEntries.map(entry => ({
        kind: entry.kind,
        id: entry.id
    }))
    const selectEntry = (event: ReactMouseEvent, key: string, fromCheckbox = false): void => {
        const anchorIndex = selectableKeys.indexOf(selectionAnchor.current)
        const currentIndex = selectableKeys.indexOf(key)
        if (event.shiftKey && anchorIndex >= 0 && currentIndex >= 0) {
            const start = Math.min(anchorIndex, currentIndex)
            const end = Math.max(anchorIndex, currentIndex)
            setSelectedKeys(current => {
                const next = event.ctrlKey || event.metaKey ? new Set(current) : new Set<string>()
                selectableKeys.slice(start, end + 1).forEach(value => next.add(value))
                return next
            })
        } else if (fromCheckbox || event.ctrlKey || event.metaKey) {
            setSelectedKeys(current => {
                const next = new Set(current)
                if (next.has(key)) next.delete(key)
                else next.add(key)
                return next
            })
        } else {
            setSelectedKeys(new Set([key]))
        }
        selectionAnchor.current = key
    }
    const toggleAll = (): void => {
        setSelectedKeys(allSelected ? new Set() : new Set(selectableKeys))
        selectionAnchor.current = allSelected ? '' : selectableKeys.at(-1) ?? ''
    }
    const rename = (): void => {
        if (!selected) return
        const name = window.prompt(t('renamePrompt'), selected.name)
        if (!name || name === selected.name) return
        if (selected.kind === 'directory') {
            const current = selected.directory.path
            const parent = parentPath(current)
            const path = parent ? `${parent}/${name}` : name
            action.mutate(() => api(
                `/api/v1/projects/${detail.project.id}/servers/${detail.server.id}/directories/${selected.id}`,
                {
                    method: 'PATCH',
                    ...jsonBody({ draftVersion: detail.project.draftVersion, path })
                }
            ))
            return
        }
        action.mutate(() => api(moduleUrl(selected.id), {
            method: 'PATCH',
            ...jsonBody({ draftVersion: detail.project.draftVersion, fileName: name })
        }))
    }
    const move = (): void => {
        if (selectedEntries.length === 0 || selectedEntries.some(entry =>
            entry.kind === 'module' && entry.module.type !== 'File'
        )) return
        const destination = window.prompt(t('moveDestinationPrompt'), '')
        if (destination == null) return
        setUploadInputError(null)
        const normalizedDestination = destination.replace(/^\/+|\/+$/g, '')
        action.mutate(() => api(
            `/api/v1/projects/${detail.project.id}/servers/${detail.server.id}/explorer/move`,
            {
                method: 'POST',
                ...jsonBody({
                    draftVersion: detail.project.draftVersion,
                    entries: selectedRefs(),
                    destinationPath: normalizedDestination
                })
            }
        ))
    }
    const edit = (): void => {
        if (selected?.kind !== 'module') return
        const displayName = window.prompt(t('displayNamePrompt'), selected.module.displayName)
        if (!displayName) return
        let optionalMode = selected.module.optionalMode
        if (selected.module.type === 'ForgeMod' || selected.module.type === 'FabricMod') {
            const mode = window.prompt(t('optionalModePrompt'), optionalMode)
            if (mode == null) return
            if (!['REQUIRED', 'OPTIONAL_ON', 'OPTIONAL_OFF'].includes(mode)) {
                window.alert(t('optionalModeInvalid'))
                return
            }
            optionalMode = mode as OptionalMode
        }
        action.mutate(() => api(moduleUrl(selected.id), {
            method: 'PATCH',
            ...jsonBody({ draftVersion: detail.project.draftVersion, displayName, optionalMode })
        }))
    }
    const setChecksumValidation = (module: ManagedModule, validateChecksum: boolean): void => {
        if (!canEdit || module.type !== 'File' || action.isPending) return
        action.mutate(() => api(moduleUrl(module.id), {
            method: 'PATCH',
            ...jsonBody({ draftVersion: detail.project.draftVersion, validateChecksum })
        }))
    }
    const remove = (): void => {
        if (selectedEntries.length === 0) return
        const selectedDirectories = selectedEntries
            .filter((entry): entry is DirectoryEntry => entry.kind === 'directory')
            .map(entry => entry.directory)
        const directoryRoots = selectedDirectories.filter(directory => !selectedDirectories.some(other =>
            other.id !== directory.id && pathInside(directory.path, other.path)
        ))
        const directoryIds = new Set(detail.directories
            .filter(directory => directoryRoots.some(root => pathInside(directory.path, root.path)))
            .map(directory => directory.id))
        const moduleIds = new Set(selectedEntries
            .filter((entry): entry is ModuleEntry => entry.kind === 'module')
            .map(entry => entry.id))
        detail.server.modules.forEach(module => {
            if (module.type === 'File' && module.relativePath
                && directoryRoots.some(root => pathInside(module.relativePath!, root.path))) {
                moduleIds.add(module.id)
            }
        })
        if (!window.confirm(t('confirmDeleteSelection', {
            selectedCount: selectedEntries.length,
            directoryCount: directoryIds.size,
            moduleCount: moduleIds.size
        }))) return
        setUploadInputError(null)
        action.mutate(() => api(
            `/api/v1/projects/${detail.project.id}/servers/${detail.server.id}/explorer/delete`,
            {
                method: 'POST',
                ...jsonBody({
                    draftVersion: detail.project.draftVersion,
                    entries: selectedRefs(),
                    recursive: true
                })
            }
        ))
    }
    const replace = (file: File): void => {
        if (selected?.kind !== 'module') return
        action.mutate(async () => {
            const stored = await upload(file)
            return api(`${moduleUrl(selected.id)}/replace`, {
                method: 'POST',
                ...jsonBody({ draftVersion: detail.project.draftVersion, uploadId: stored.id })
            })
        })
    }
    const download = (): void => {
        if (selectedEntries.length === 0) return
        setUploadInputError(null)
        if (selected?.kind === 'module' && selected.module.uploadId && !selected.module.needsManualFile) {
            const link = document.createElement('a')
            link.href = `${moduleUrl(selected.id)}/download`
            document.body.append(link)
            link.click()
            link.remove()
            return
        }
        downloadAction.mutate(async () => {
            const response = await apiResponse(
                `/api/v1/projects/${detail.project.id}/servers/${detail.server.id}/explorer/download`,
                { method: 'POST', ...jsonBody({ entries: selectedRefs() }) }
            )
            const blob = await response.blob()
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = `${detail.server.serverKey}-selection.zip`
            document.body.append(link)
            link.click()
            link.remove()
            window.setTimeout(() => URL.revokeObjectURL(url), 0)
        })
    }
    const resizeColumnBoundary = (
        leftKey: ExplorerColumnKey,
        rightKey: ExplorerColumnKey,
        delta: number,
        leftWidth = columnWidths[leftKey],
        rightWidth = columnWidths[rightKey],
        dataWidth = tableDataWidth
    ): void => {
        const leftMinimum = EXPLORER_COLUMN_CONFIG_BY_KEY[leftKey].minimumWidth
        const rightMinimum = EXPLORER_COLUMN_CONFIG_BY_KEY[rightKey].minimumWidth
        const clampedDelta = Math.max(leftMinimum - leftWidth, Math.min(delta, rightWidth - rightMinimum))
        setColumnRatios(current => ({
            ...current,
            [leftKey]: (leftWidth + clampedDelta) / dataWidth,
            [rightKey]: (rightWidth - clampedDelta) / dataWidth
        }))
    }
    const beginColumnResize = (
        event: ReactPointerEvent<HTMLSpanElement>,
        leftKey: ExplorerColumnKey,
        rightKey: ExplorerColumnKey
    ): void => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        columnResize.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            leftKey,
            rightKey,
            leftWidth: columnWidths[leftKey],
            rightWidth: columnWidths[rightKey],
            dataWidth: tableDataWidth
        }
    }
    const continueColumnResize = (event: ReactPointerEvent<HTMLSpanElement>): void => {
        const resize = columnResize.current
        if (resize?.pointerId !== event.pointerId) return
        resizeColumnBoundary(
            resize.leftKey,
            resize.rightKey,
            event.clientX - resize.startX,
            resize.leftWidth,
            resize.rightWidth,
            resize.dataWidth
        )
    }
    const endColumnResize = (event: ReactPointerEvent<HTMLSpanElement>): void => {
        if (columnResize.current?.pointerId !== event.pointerId) return
        columnResize.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
        }
    }
    const resizeColumnWithKeyboard = (
        event: ReactKeyboardEvent<HTMLSpanElement>,
        leftKey: ExplorerColumnKey,
        rightKey: ExplorerColumnKey
    ): void => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        const step = event.shiftKey ? 25 : 10
        resizeColumnBoundary(leftKey, rightKey, event.key === 'ArrowRight' ? step : -step)
    }
    const resetColumnBoundary = (leftKey: ExplorerColumnKey, rightKey: ExplorerColumnKey): void => {
        const combinedWidth = columnWidths[leftKey] + columnWidths[rightKey]
        const leftDefault = EXPLORER_COLUMN_CONFIG_BY_KEY[leftKey].defaultWidth
        const rightDefault = EXPLORER_COLUMN_CONFIG_BY_KEY[rightKey].defaultWidth
        const targetLeftWidth = combinedWidth * leftDefault / (leftDefault + rightDefault)
        resizeColumnBoundary(leftKey, rightKey, targetLeftWidth - columnWidths[leftKey])
    }
    const openPath = (path: string): void => {
        setExpandedPaths(current => {
            const next = new Set(current)
            for (const ancestor of explorerPathChain(path)) next.add(ancestor)
            return next
        })
        setCurrentPath(path)
    }
    const toggleExpandedPath = (path: string): void => {
        setExpandedPaths(current => {
            const next = new Set(current)
            if (next.has(path)) next.delete(path)
            else next.add(path)
            return next
        })
    }
    const open = (entry: ExplorerEntry): void => {
        if (entry.kind !== 'module') openPath(entry.path)
    }
    const canMoveSelection = selectedEntries.length > 0 && selectedEntries.every(entry =>
        entry.kind === 'directory' || entry.module.type === 'File'
    )
    const singleDownloadUnavailable = selected?.kind === 'module'
        && (!selected.module.uploadId || selected.module.needsManualFile)
    const breadcrumbs = currentPath ? currentPath.split('/') : []
    return <section className="explorer-card">
        <div className="explorer-toolbar">
            <button className="secondary" onClick={() => openPath(parentPath(currentPath))} disabled={!currentPath}>←</button>
            {canEdit && <button className="secondary" onClick={createFolder} disabled={!currentPath.startsWith('files')}>{t('newFolder')}</button>}
            {canEdit && <button className="secondary" onClick={() => uploadInput.current?.click()} disabled={!target || action.isPending || dropReading}>{t('upload')}</button>}
            <input
                ref={uploadInput}
                className="hidden-file-input"
                type="file"
                multiple
                onChange={event => {
                    const files = Array.from(event.target.files ?? [])
                    if (files.length > 0) handleUploads(files)
                    event.target.value = ''
                }}
            />
            {canEdit && <button className="text-button toolbar-action" onClick={rename} disabled={!selected || action.isPending}>{t('rename')}</button>}
            {canEdit && <button className="text-button toolbar-action" onClick={move} disabled={!canMoveSelection || action.isPending}>{t('move')}</button>}
            {canEdit && <button className="text-button toolbar-action" onClick={edit} disabled={selected?.kind !== 'module' || action.isPending}>{t('edit')}</button>}
            {canEdit && <button className="text-button toolbar-action" onClick={() => replaceInput.current?.click()} disabled={selected?.kind !== 'module' || action.isPending}>{t('replace')}</button>}
            <input
                ref={replaceInput}
                className="hidden-file-input"
                type="file"
                onChange={event => {
                    const file = event.target.files?.[0]
                    if (file) replace(file)
                    event.target.value = ''
                }}
            />
            <button
                className="text-button toolbar-action"
                onClick={download}
                disabled={selectedEntries.length === 0 || singleDownloadUnavailable || downloadAction.isPending}
            >{t('download')}</button>
            {canEdit && <button className="danger-link toolbar-action" onClick={remove} disabled={selectedEntries.length === 0 || action.isPending}>{t('delete')}</button>}
            <button className="text-button toolbar-action" onClick={() => invalidateServer(queryClient, detail.project.id, detail.server.id)}>{t('refresh')}</button>
        </div>
        <div className="explorer-address">
            <span>{t('location')}</span>
            <button onClick={() => openPath('')}>{detail.server.name}</button>
            {breadcrumbs.map((part, index) => {
                const path = breadcrumbs.slice(0, index + 1).join('/')
                const label = part === 'files'
                    ? t('regularFiles')
                    : part === 'libraries'
                        ? t('libraries')
                        : ['required', 'optionalon', 'optionaloff'].includes(part)
                            ? t(part)
                            : part
                return <span key={path}>› <button onClick={() => openPath(path)}>{label}</button></span>
            })}
            <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder={t('searchFiles')}
                aria-label={t('searchFiles')}
            />
        </div>
        <div className="explorer-body">
            <ExplorerTree
                detail={detail}
                currentPath={currentPath}
                expandedPaths={expandedPaths}
                onToggle={toggleExpandedPath}
                onOpen={openPath}
            />
            <div
                className={`explorer-main${dragActive ? ' drag-active' : ''}`}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                aria-busy={uploadProgress != null || dropReading}
            >
                {dragActive && <div className="explorer-drop-overlay" role="status">{t('dropFilesAndFoldersHere')}</div>}
                <div className="explorer-view-options">
                    <span>{selectedEntries.length > 0
                        ? t('selectedItems', { selected: selectedEntries.length, total: entries.length })
                        : `${entries.length} ${t('items')}`}</span>
                    <label>{t('sortBy')}<select value={sortBy} onChange={event => setSortBy(event.target.value as ExplorerSort)}>
                        <option value="name">{t('name')}</option>
                        <option value="type">{t('type')}</option>
                        <option value="size">{t('size')}</option>
                        <option value="updated">{t('updated')}</option>
                    </select></label>
                    <button className="text-button" onClick={() => setDirection(value => value === 'asc' ? 'desc' : 'asc')}>{direction === 'asc' ? '↑' : '↓'}</button>
                </div>
                <div ref={tableWrap} className="explorer-table-wrap">
                    <table className="explorer-table" style={{ width: `${tableWidth}px` }}>
                        <colgroup>
                            <col style={{ width: `${EXPLORER_SELECTION_WIDTH}px` }} />
                            {explorerColumns.map(column => <col
                                key={column.key}
                                style={{ width: `${columnWidths[column.key]}px` }}
                            />)}
                        </colgroup>
                        <thead><tr>
                            <th scope="col" className="explorer-selection-cell"><input
                                ref={selectAllInput}
                                type="checkbox"
                                checked={allSelected}
                                disabled={selectableKeys.length === 0}
                                aria-label={t('selectAll')}
                                onChange={toggleAll}
                            /></th>
                            {explorerColumns.map((column, index) => {
                                const rightColumn = explorerColumns[index + 1]
                                const resizeLabel = rightColumn
                                    ? t('resizeExplorerColumns', { left: column.label, right: rightColumn.label })
                                    : ''
                                return <th
                                    key={column.key}
                                    scope="col"
                                    className="explorer-column-header"
                                    data-explorer-column={column.key}
                                    title={column.label}
                                >
                                    <span className="explorer-column-label">{column.label}</span>
                                    {rightColumn && <span
                                        className="explorer-column-resizer"
                                        role="separator"
                                        tabIndex={0}
                                        aria-orientation="vertical"
                                        aria-label={resizeLabel}
                                        aria-valuemin={column.minimumWidth}
                                        aria-valuemax={Math.round(columnWidths[column.key]
                                            + columnWidths[rightColumn.key]
                                            - rightColumn.minimumWidth)}
                                        aria-valuenow={Math.round(columnWidths[column.key])}
                                        title={resizeLabel}
                                        data-resize-boundary={`${column.key}-${rightColumn.key}`}
                                        onPointerDown={event => beginColumnResize(event, column.key, rightColumn.key)}
                                        onPointerMove={continueColumnResize}
                                        onPointerUp={endColumnResize}
                                        onPointerCancel={endColumnResize}
                                        onLostPointerCapture={() => { columnResize.current = null }}
                                        onKeyDown={event => resizeColumnWithKeyboard(event, column.key, rightColumn.key)}
                                        onDoubleClick={() => resetColumnBoundary(column.key, rightColumn.key)}
                                    />}
                                </th>
                            })}
                        </tr></thead>
                        <tbody>
                            {entries.map(entry => {
                                const key = `${entry.kind}:${entry.id}`
                                const module = entry.kind === 'module' ? entry.module : null
                                const type = entry.kind === 'module' ? entry.module.type : t('folder')
                                const status = module?.needsManualFile
                                    ? t('waitingFile')
                                    : module
                                        ? t(optionalFolder(module.optionalMode))
                                        : ''
                                const updated = entry.kind === 'module'
                                    ? entry.module.updatedAt
                                    : entry.kind === 'directory'
                                        ? entry.directory.updatedAt
                                        : null
                                const size = module ? displayFileSize(module.size, t('bytes')) : '—'
                                const updatedLabel = updated ? new Date(updated).toLocaleString() : '—'
                                return <tr
                                    key={key}
                                    className={selectedKeys.has(key) ? 'selected' : ''}
                                    aria-selected={entry.kind === 'system' ? undefined : selectedKeys.has(key)}
                                    onClick={event => {
                                        if (entry.kind === 'system') {
                                            setSelectedKeys(new Set())
                                            selectionAnchor.current = ''
                                        } else {
                                            selectEntry(event, key)
                                        }
                                    }}
                                    onDoubleClick={() => open(entry)}
                                >
                                    <td className="explorer-selection-cell">{entry.kind !== 'system' && <input
                                        type="checkbox"
                                        checked={selectedKeys.has(key)}
                                        readOnly
                                        aria-label={t('selectItem', { name: entry.name })}
                                        onClick={event => {
                                            event.stopPropagation()
                                            selectEntry(event, key, true)
                                        }}
                                    />}</td>
                                    <td className="explorer-name-cell" title={entry.name}><div className="explorer-name-content">
                                        <span className={`explorer-entry-icon ${entry.kind}`}>{entry.kind === 'module' ? '◈' : '▰'}</span>
                                        <strong>{entry.kind === 'system' && entry.warning ? `⚠ ${entry.name}` : entry.name}</strong>
                                        {module?.needsManualFile && <span className="warning-dot" title={t('waitingFile')}>!</span>}
                                    </div></td>
                                    <td title={type}><span className="explorer-cell-text">{type}</span></td>
                                    <td title={entry.path}><code className="explorer-cell-text">{entry.path}</code></td>
                                    <td title={size}><span className="explorer-cell-text">{size}</span></td>
                                    <td className={module?.needsManualFile ? 'warning' : ''} title={status || undefined}><span className="explorer-cell-text">{status}</span></td>
                                    <td title={module?.type === 'File' ? t('checksumValidationHint') : undefined}>
                                        {module?.type === 'File'
                                            ? <button
                                                type="button"
                                                role="switch"
                                                aria-checked={module.validateChecksum}
                                                aria-label={t('checksumValidationFor', { name: entry.name })}
                                                className={`checksum-switch${module.validateChecksum ? ' enabled' : ''}`}
                                                disabled={!canEdit || action.isPending}
                                                onClick={event => {
                                                    event.stopPropagation()
                                                    setChecksumValidation(module, !module.validateChecksum)
                                                }}
                                            ><span /></button>
                                            : module
                                                ? <span className="checksum-always-on">{t('checksumValidationAlwaysOn')}</span>
                                                : '—'}
                                    </td>
                                    <td title={updatedLabel}><span className="explorer-cell-text">{updatedLabel}</span></td>
                                </tr>
                            })}
                        </tbody>
                    </table>
                    {entries.length === 0 && <div className="empty explorer-empty">{t('folderEmpty')}</div>}
                </div>
            </div>
        </div>
        {uploadProgress && <div className="explorer-progress" role="status" aria-live="polite">{t(uploadProgress.phase === 'folders' ? 'createFolderBatchProgress' : 'uploadBatchProgress', {
            current: uploadProgress.completed + 1,
            total: uploadProgress.total,
            fileName: uploadProgress.currentFile
        })}</div>}
        {(action.isPending || dropReading || downloadAction.isPending) && !uploadProgress && <div className="explorer-progress" role="status">{t(downloadAction.isPending ? 'preparingDownload' : 'working')}</div>}
        {uploadSuccess != null && <div className="explorer-upload-success" role="status">{uploadSuccess.folders > 0
            ? t('uploadTreeComplete', { folderCount: uploadSuccess.folders, fileCount: uploadSuccess.files })
            : t('uploadBatchComplete', { count: uploadSuccess.files })}</div>}
        <ErrorNotice error={uploadInputError ?? action.error ?? downloadAction.error} />
    </section>
}

export function ServerFilesPage({ user }: { user: ApiUser }): ReactNode {
    const { projectId = '', serverId = '' } = useParams()
    const detail = useServerDetail(projectId, serverId)
    const fallback = <LoadingOrError query={detail} />
    if (!detail.data) return fallback
    const canEdit = user.role === 'ADMIN' || user.role === 'EDITOR'
    return <>
        <ServerHeader detail={detail.data} />
        <ServerExplorer detail={detail.data} canEdit={canEdit} />
    </>
}

export function ServerRootRedirect(): ReactNode {
    const { projectId = '', serverId = '' } = useParams()
    return <Navigate to={`/projects/${projectId}/servers/${serverId}/overview`} replace />
}
