import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type FormEvent,
    type ReactNode
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type {
    ApiUser,
    LoaderCatalogResponse,
    MinecraftCatalogResponse,
    VersionCatalogLoader
} from '@nebula/shared'
import {
    api,
    jsonBody,
    type ManagedModule,
    type ManagedServer,
    type Project,
    type ProjectDetail,
    type ServerDetail,
    type ServerDirectory
} from './api.js'
import { Link, NavLink, Navigate, useNavigate, useParams } from './router.js'

type OptionalMode = ManagedModule['optionalMode']
type ModuleType = ManagedModule['type']
type ExplorerSort = 'name' | 'type' | 'size' | 'updated'

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
                <span className="pill">{t('revision')} {detail.project.draftRevision}</span>
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
    canEdit: boolean
    onDone: (serverId?: string) => void
}

function ServerForm({ project, server, canEdit, onDone }: ServerFormProps): ReactNode {
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
                revision: project.draftRevision,
                serverKey: String(data.get('serverKey')),
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
                sortOrder: Number(data.get('sortOrder')),
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
        <label>{t('order')}<input name="sortOrder" type="number" min="0" defaultValue={server?.sortOrder ?? 0} disabled={!canEdit} /></label>
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
                ...jsonBody({ revision: detail.data.project.draftRevision })
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
    const [backgroundCleared, setBackgroundCleared] = useState(false)
    const [logoCleared, setLogoCleared] = useState(false)
    const [eyebrow, setEyebrow] = useState(server?.launcherUi.eyebrow ?? '')
    const [title, setTitle] = useState(server?.launcherUi.title ?? '')
    const [tagline, setTagline] = useState(server?.launcherUi.tagline ?? '')
    const [rss, setRss] = useState(server?.launcherUi.rss ?? '')
    const backgroundFilePreview = useFilePreview(backgroundFile)
    const logoFilePreview = useFilePreview(logoFile)

    useEffect(() => {
        if (!server) return
        setEyebrow(server.launcherUi.eyebrow)
        setTitle(server.launcherUi.title)
        setTagline(server.launcherUi.tagline)
        setRss(server.launcherUi.rss)
        setBackgroundFile(null)
        setLogoFile(null)
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
            return api<{ draftRevision: number }>(
                `/api/v1/projects/${projectId}/servers/${serverId}/launcher-ui`,
                {
                    method: 'PATCH',
                    ...jsonBody({
                        revision: detail.data.project.draftRevision,
                        backgroundUploadId,
                        logoUploadId,
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
    const backgroundPreview = backgroundFilePreview ?? storedBackground
    const logoPreview = logoFilePreview ?? storedLogo
    const backgroundLoadState = useImageLoadState(backgroundPreview)
    const logoLoadState = useImageLoadState(logoPreview)
    const hasMissingImage = backgroundLoadState === 'error' || logoLoadState === 'error'
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

function ExplorerTree({
    detail,
    currentPath,
    onOpen
}: {
    detail: ServerDetail
    currentPath: string
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
    return <aside className="explorer-tree" aria-label={t('folders')}>
        <button className={currentPath === '' ? 'active' : ''} onClick={() => onOpen('')}>
            <span className="tree-icon">▣</span>{detail.server.name}
        </button>
        {roots.map(root => <div key={root.id}>
            <button className={currentPath === root.path ? 'active' : ''} onClick={() => onOpen(root.path)}>
                <span className="tree-icon">▸</span>{root.name}{root.warning && <span className="tree-warning">!</span>}
            </button>
            {root.path === 'files' && directories.map(directory => {
                const logicalPath = `files/${directory.path}`
                const depth = directory.path.split('/').length
                return <button
                    key={directory.id}
                    className={currentPath === logicalPath ? 'active tree-child' : 'tree-child'}
                    style={{ paddingLeft: `${24 + depth * 14}px` }}
                    onClick={() => onOpen(logicalPath)}
                ><span className="tree-icon">⌙</span>{baseName(directory.path)}</button>
            })}
            {(root.path === 'forgemods' || root.path === 'fabricmods') && ['required', 'optionalon', 'optionaloff'].map(folder =>
                <button
                    key={folder}
                    className={currentPath === `${root.path}/${folder}` ? 'active tree-child' : 'tree-child'}
                    onClick={() => onOpen(`${root.path}/${folder}`)}
                ><span className="tree-icon">⌙</span>{t(folder)}</button>
            )}
        </div>)}
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
    const [search, setSearch] = useState('')
    const [sortBy, setSortBy] = useState<ExplorerSort>('name')
    const [direction, setDirection] = useState<'asc' | 'desc'>('asc')
    const [selectedKey, setSelectedKey] = useState('')
    const uploadInput = useRef<HTMLInputElement>(null)
    const replaceInput = useRef<HTMLInputElement>(null)
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
    const selected = entries.find(entry => `${entry.kind}:${entry.id}` === selectedKey)
    const target = uploadTarget(currentPath, detail.server)
    const action = useMutation({
        mutationFn: (operation: () => Promise<unknown>) => operation(),
        onSuccess: () => {
            setSelectedKey('')
            invalidateServer(queryClient, detail.project.id, detail.server.id)
        }
    })
    useEffect(() => setSelectedKey(''), [currentPath])

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
                ...jsonBody({ revision: detail.project.draftRevision, path })
            }
        ))
    }
    const handleUpload = (file: File): void => {
        if (!target) return
        action.mutate(async () => {
            const stored = await upload(file)
            const relativePath = target.type === 'File'
                ? (target.relativeDirectory ? `${target.relativeDirectory}/${file.name}` : file.name)
                : null
            return api(`/api/v1/projects/${detail.project.id}/servers/${detail.server.id}/modules`, {
                method: 'POST',
                ...jsonBody({
                    revision: detail.project.draftRevision,
                    uploadId: stored.id,
                    type: target.type,
                    displayName: file.name,
                    fileName: file.name,
                    relativePath,
                    optionalMode: target.optionalMode,
                    sortOrder: detail.server.modules.length
                })
            })
        })
    }
    const rename = (): void => {
        if (!selected || selected.kind === 'system') return
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
                    ...jsonBody({ revision: detail.project.draftRevision, path })
                }
            ))
            return
        }
        action.mutate(() => api(moduleUrl(selected.id), {
            method: 'PATCH',
            ...jsonBody({ revision: detail.project.draftRevision, fileName: name })
        }))
    }
    const move = (): void => {
        if (!selected || selected.kind === 'system') return
        if (selected.kind === 'module' && selected.module.type !== 'File') return
        const destination = window.prompt(t('moveDestinationPrompt'), '')
        if (destination == null) return
        const normalizedDestination = destination.replace(/^\/+|\/+$/g, '')
        const path = normalizedDestination ? `${normalizedDestination}/${selected.name}` : selected.name
        if (selected.kind === 'directory') {
            action.mutate(() => api(
                `/api/v1/projects/${detail.project.id}/servers/${detail.server.id}/directories/${selected.id}`,
                {
                    method: 'PATCH',
                    ...jsonBody({ revision: detail.project.draftRevision, path })
                }
            ))
        } else {
            action.mutate(() => api(moduleUrl(selected.id), {
                method: 'PATCH',
                ...jsonBody({ revision: detail.project.draftRevision, relativePath: path })
            }))
        }
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
            ...jsonBody({ revision: detail.project.draftRevision, displayName, optionalMode })
        }))
    }
    const remove = (): void => {
        if (!selected || selected.kind === 'system') return
        if (selected.kind === 'directory') {
            const directoryCount = detail.directories.filter(directory => pathInside(directory.path, selected.directory.path)).length
            const moduleCount = detail.server.modules.filter(module =>
                module.type === 'File'
                && module.relativePath != null
                && pathInside(module.relativePath, selected.directory.path)
            ).length
            if (!window.confirm(t('confirmDeleteFolder', { directoryCount, moduleCount }))) return
            action.mutate(() => api(
                `/api/v1/projects/${detail.project.id}/servers/${detail.server.id}/directories/${selected.id}`,
                {
                    method: 'DELETE',
                    ...jsonBody({ revision: detail.project.draftRevision, recursive: true })
                }
            ))
            return
        }
        if (!window.confirm(t('confirmDelete'))) return
        action.mutate(() => api(moduleUrl(selected.id), {
            method: 'DELETE',
            ...jsonBody({ revision: detail.project.draftRevision })
        }))
    }
    const replace = (file: File): void => {
        if (selected?.kind !== 'module') return
        action.mutate(async () => {
            const stored = await upload(file)
            return api(`${moduleUrl(selected.id)}/replace`, {
                method: 'POST',
                ...jsonBody({ revision: detail.project.draftRevision, uploadId: stored.id })
            })
        })
    }
    const open = (entry: ExplorerEntry): void => {
        if (entry.kind !== 'module') setCurrentPath(entry.path)
    }
    const breadcrumbs = currentPath ? currentPath.split('/') : []
    return <section className="explorer-card">
        <div className="explorer-toolbar">
            <button className="secondary" onClick={() => setCurrentPath(parentPath(currentPath))} disabled={!currentPath}>←</button>
            {canEdit && <button className="secondary" onClick={createFolder} disabled={!currentPath.startsWith('files')}>{t('newFolder')}</button>}
            {canEdit && <button className="secondary" onClick={() => uploadInput.current?.click()} disabled={!target}>{t('upload')}</button>}
            <input
                ref={uploadInput}
                className="hidden-file-input"
                type="file"
                onChange={event => {
                    const file = event.target.files?.[0]
                    if (file) handleUpload(file)
                    event.target.value = ''
                }}
            />
            {canEdit && <button className="text-button toolbar-action" onClick={rename} disabled={!selected || selected.kind === 'system'}>{t('rename')}</button>}
            {canEdit && <button className="text-button toolbar-action" onClick={move} disabled={!selected || selected.kind === 'system' || selected.kind === 'module' && selected.module.type !== 'File'}>{t('move')}</button>}
            {canEdit && <button className="text-button toolbar-action" onClick={edit} disabled={selected?.kind !== 'module'}>{t('edit')}</button>}
            {canEdit && <button className="text-button toolbar-action" onClick={() => replaceInput.current?.click()} disabled={selected?.kind !== 'module'}>{t('replace')}</button>}
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
            {canEdit && <button className="danger-link toolbar-action" onClick={remove} disabled={!selected || selected.kind === 'system'}>{t('delete')}</button>}
            <button className="text-button toolbar-action" onClick={() => invalidateServer(queryClient, detail.project.id, detail.server.id)}>{t('refresh')}</button>
        </div>
        <div className="explorer-address">
            <span>{t('location')}</span>
            <button onClick={() => setCurrentPath('')}>{detail.server.name}</button>
            {breadcrumbs.map((part, index) => {
                const path = breadcrumbs.slice(0, index + 1).join('/')
                const label = part === 'files'
                    ? t('regularFiles')
                    : part === 'libraries'
                        ? t('libraries')
                        : ['required', 'optionalon', 'optionaloff'].includes(part)
                            ? t(part)
                            : part
                return <span key={path}>› <button onClick={() => setCurrentPath(path)}>{label}</button></span>
            })}
            <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder={t('searchFiles')}
                aria-label={t('searchFiles')}
            />
        </div>
        <div className="explorer-body">
            <ExplorerTree detail={detail} currentPath={currentPath} onOpen={setCurrentPath} />
            <div className="explorer-main">
                <div className="explorer-view-options">
                    <span>{entries.length} {t('items')}</span>
                    <label>{t('sortBy')}<select value={sortBy} onChange={event => setSortBy(event.target.value as ExplorerSort)}>
                        <option value="name">{t('name')}</option>
                        <option value="type">{t('type')}</option>
                        <option value="size">{t('size')}</option>
                        <option value="updated">{t('updated')}</option>
                    </select></label>
                    <button className="text-button" onClick={() => setDirection(value => value === 'asc' ? 'desc' : 'asc')}>{direction === 'asc' ? '↑' : '↓'}</button>
                </div>
                <div className="explorer-table-wrap">
                    <table className="explorer-table">
                        <thead><tr><th>{t('name')}</th><th>{t('type')}</th><th>{t('destination')}</th><th>{t('size')}</th><th>{t('status')}</th><th>{t('updated')}</th></tr></thead>
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
                                return <tr
                                    key={key}
                                    className={selectedKey === key ? 'selected' : ''}
                                    onClick={() => setSelectedKey(key)}
                                    onDoubleClick={() => open(entry)}
                                >
                                    <td><span className={`explorer-entry-icon ${entry.kind}`}>{entry.kind === 'module' ? '◈' : '▰'}</span><strong>{entry.kind === 'system' && entry.warning ? `⚠ ${entry.name}` : entry.name}</strong>{module?.needsManualFile && <span className="warning-dot" title={t('waitingFile')}>!</span>}</td>
                                    <td>{type}</td>
                                    <td><code>{entry.path}</code></td>
                                    <td>{module ? displayFileSize(module.size, t('bytes')) : '—'}</td>
                                    <td className={module?.needsManualFile ? 'warning' : ''}>{status}</td>
                                    <td>{updated ? new Date(updated).toLocaleString() : '—'}</td>
                                </tr>
                            })}
                        </tbody>
                    </table>
                    {entries.length === 0 && <div className="empty explorer-empty">{t('folderEmpty')}</div>}
                </div>
            </div>
        </div>
        {action.isPending && <div className="explorer-progress">{t('working')}</div>}
        <ErrorNotice error={action.error} />
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
