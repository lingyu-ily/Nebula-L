import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from './router.js'
import type {
    ApiUser,
    LoaderCatalogResponse,
    MinecraftCatalogResponse,
    VersionCatalogLoader
} from '@nebula/shared'
import {
    api,
    ApiError,
    jsonBody,
    setCsrfToken,
    type AuditLog,
    type AuthResponse,
    type Job,
    type ManagedServer,
    type Project,
    type ProjectDetail,
    type Release
} from './api.js'

function useSession(): ReturnType<typeof useQuery<AuthResponse, Error>> {
    return useQuery({
        queryKey: ['session'],
        queryFn: async () => {
            const response = await api<AuthResponse>('/api/v1/auth/me')
            setCsrfToken(response.csrfToken)
            return response
        },
        retry: false
    })
}

function ErrorNotice({ error }: { error: unknown }): ReactNode {
    if (!error) return null
    return <div className="notice error" role="alert">{error instanceof Error ? error.message : String(error)}</div>
}

function LoginPage(): ReactNode {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const login = useMutation({
        mutationFn: (credentials: { username: string, password: string }) => api<AuthResponse>('/api/v1/auth/login', {
            method: 'POST',
            ...jsonBody(credentials)
        }),
        onSuccess: response => {
            setCsrfToken(response.csrfToken)
            queryClient.setQueryData(['session'], response)
        }
    })
    const submit = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        login.mutate({ username: String(data.get('username')), password: String(data.get('password')) })
    }
    return <main className="login-shell">
        <section className="login-panel">
            <div className="nebula-mark" aria-hidden="true"><span /></div>
            <p className="eyebrow">HELIOS DISTRIBUTION CONTROL</p>
            <h1>{t('brand')}</h1>
            <p className="muted">{t('tagline')}</p>
            <form onSubmit={submit} className="stack">
                <label>{t('username')}<input name="username" autoComplete="username" required autoFocus /></label>
                <label>{t('password')}<input name="password" type="password" autoComplete="current-password" required /></label>
                <ErrorNotice error={login.error} />
                <button className="primary" disabled={login.isPending}>{t('login')}</button>
            </form>
        </section>
        <aside className="login-art" aria-hidden="true">
            <div className="orbit orbit-one" /><div className="orbit orbit-two" />
            <div className="release-card"><small>RELEASE PIPELINE</small><strong>Verified</strong><span>RustFS · MariaDB · Helios</span></div>
        </aside>
    </main>
}

function ChangePasswordPage({ user }: { user: ApiUser }): ReactNode {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const change = useMutation({
        mutationFn: (value: { currentPassword: string, newPassword: string }) => api('/api/v1/auth/change-password', {
            method: 'POST', ...jsonBody(value)
        }),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['session'] })
    })
    const submit = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        change.mutate({
            currentPassword: String(data.get('currentPassword')),
            newPassword: String(data.get('newPassword'))
        })
    }
    return <main className="center-page"><section className="card narrow">
        <p className="eyebrow">{user.username}</p><h1>{t('forcedPassword')}</h1>
        <form className="stack" onSubmit={submit}>
            <label>{t('currentPassword')}<input name="currentPassword" type="password" required /></label>
            <label>{t('newPassword')}<input name="newPassword" type="password" minLength={12} required /></label>
            <ErrorNotice error={change.error} />
            <button className="primary">{t('changePassword')}</button>
        </form>
    </section></main>
}

function Shell({ user, children }: { user: ApiUser, children: ReactNode }): ReactNode {
    const { t, i18n } = useTranslation()
    const queryClient = useQueryClient()
    const navigate = useNavigate()
    const logout = useMutation({
        mutationFn: () => api('/api/v1/auth/logout', { method: 'POST' }),
        onSuccess: () => {
            queryClient.clear()
            void navigate('/')
        }
    })
    const toggleLanguage = (): void => {
        void i18n.changeLanguage(i18n.resolvedLanguage === 'en' ? 'zh-TW' : 'en')
    }
    return <div className="app-shell">
        <aside className="sidebar">
            <Link to="/projects" className="brand"><span className="brand-dot" />{t('brand')}</Link>
            <nav>
                <NavLink to="/projects">{t('projects')}</NavLink>
                {user.role === 'ADMIN' && <NavLink to="/users">{t('users')}</NavLink>}
                <NavLink to="/audit">{t('audit')}</NavLink>
            </nav>
            <div className="account">
                <span className={`role role-${user.role.toLowerCase()}`}>{user.role}</span>
                <strong>{user.username}</strong>
                <button className="text-button" onClick={toggleLanguage}>{t('language')}</button>
                <button className="text-button" onClick={() => logout.mutate()}>{t('logout')}</button>
            </div>
        </aside>
        <main className="content">{children}</main>
    </div>
}

function ProjectsPage({ user }: { user: ApiUser }): ReactNode {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const projects = useQuery({ queryKey: ['projects'], queryFn: () => api<{ items: Project[] }>('/api/v1/projects') })
    const createProject = useMutation({
        mutationFn: (value: unknown) => api('/api/v1/projects', { method: 'POST', ...jsonBody(value) }),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['projects'] })
    })
    const submit = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        createProject.mutate({
            name: String(data.get('name')),
            slug: String(data.get('slug')),
            description: String(data.get('description')),
            rss: String(data.get('rss'))
        })
        event.currentTarget.reset()
    }
    return <>
        <header className="page-header"><div><p className="eyebrow">CONTROL PLANE</p><h1>{t('projects')}</h1></div></header>
        {user.role === 'ADMIN' && <details className="card disclosure">
            <summary>{t('newProject')}</summary>
            <form className="form-grid" onSubmit={submit}>
                <label>{t('name')}<input name="name" required /></label>
                <label>{t('slug')}<input name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required /></label>
                <label className="wide">{t('description')}<textarea name="description" /></label>
                <label className="wide">{t('rss')}<input name="rss" type="url" /></label>
                <ErrorNotice error={createProject.error} /><div className="actions"><button className="primary">{t('create')}</button></div>
            </form>
        </details>}
        <div className="project-grid">
            {projects.data?.items.map(project => <Link className="project-card" to={`/projects/${project.id}`} key={project.id}>
                <div className="project-card-top"><span className={`status-dot ${project.activeReleaseId ? 'online' : ''}`} /><span>{project.activeReleaseId ? t('active') : t('draft')}</span></div>
                <h2>{project.name}</h2><p>{project.description || project.slug}</p>
                <footer><code>/{project.slug}</code><span>{t('revision')} {project.draftRevision}</span></footer>
            </Link>)}
            {!projects.isLoading && projects.data?.items.length === 0 && <div className="empty">{t('noProjects')}</div>}
        </div>
        <ErrorNotice error={projects.error} />
    </>
}

function ProjectSettings({ detail, canEdit }: { detail: ProjectDetail, canEdit: boolean }): ReactNode {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const update = useMutation({
        mutationFn: (value: unknown) => api(`/api/v1/projects/${detail.project.id}`, { method: 'PUT', ...jsonBody(value) }),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['project', detail.project.id] })
    })
    const submit = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        update.mutate({
            revision: detail.project.draftRevision,
            name: String(data.get('name')),
            slug: String(data.get('slug')),
            description: String(data.get('description')),
            rss: String(data.get('rss')),
            discord: data.get('discordClientId') || data.get('discordSmallText') || data.get('discordSmallKey') ? {
                clientId: String(data.get('discordClientId')),
                smallImageText: String(data.get('discordSmallText')),
                smallImageKey: String(data.get('discordSmallKey'))
            } : null
        })
    }
    return <section className="card"><h2>{t('projectSettings')}</h2>
        <form className="form-grid" onSubmit={submit}>
            <label>{t('name')}<input name="name" defaultValue={detail.project.name} disabled={!canEdit} required /></label>
            <label>{t('slug')}<input name="slug" defaultValue={detail.project.slug} disabled={!canEdit || Boolean(detail.project.activeReleaseId)} required /></label>
            <label className="wide">{t('description')}<textarea name="description" defaultValue={detail.project.description} disabled={!canEdit} /></label>
            <label className="wide">{t('rss')}<input name="rss" type="url" defaultValue={detail.project.rss} disabled={!canEdit} /></label>
            <label>{t('discordClient')}<input name="discordClientId" defaultValue={detail.project.discord?.clientId} disabled={!canEdit} /></label>
            <label>{t('discordSmallText')}<input name="discordSmallText" defaultValue={detail.project.discord?.smallImageText} disabled={!canEdit} /></label>
            <label>{t('discordSmallKey')}<input name="discordSmallKey" defaultValue={detail.project.discord?.smallImageKey} disabled={!canEdit} /></label>
            <ErrorNotice error={update.error} />
            {canEdit && <div className="actions"><button className="primary">{t('save')}</button></div>}
        </form>
    </section>
}

function ServerForm({ project, server, onDone }: { project: Project, server?: ManagedServer, onDone: () => void }): ReactNode {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const initialLoader = server?.forgeVersion ? 'forge' : server?.fabricVersion ? 'fabric' : 'none'
    const [minecraftVersion, setMinecraftVersion] = useState(server?.minecraftVersion ?? '')
    const [loader, setLoader] = useState<'none' | VersionCatalogLoader>(initialLoader)
    const [loaderVersion, setLoaderVersion] = useState(server?.forgeVersion ?? server?.fabricVersion ?? '')
    const selectedLoader = loader === 'none' ? null : loader
    const minecraftCatalog = useQuery<MinecraftCatalogResponse, Error>({
        queryKey: ['version-catalog', 'minecraft'],
        queryFn: () => api('/api/v1/version-catalog/minecraft'),
        retry: false,
        staleTime: 15 * 60 * 1_000
    })
    const loaderCatalog = useQuery<LoaderCatalogResponse, Error>({
        queryKey: ['version-catalog', 'loader', selectedLoader, minecraftVersion.trim()],
        queryFn: () => {
            if (!selectedLoader) {
                throw new Error('A loader must be selected')
            }
            const query = new URLSearchParams({
                loader: selectedLoader,
                minecraftVersion: minecraftVersion.trim()
            })
            return api(`/api/v1/version-catalog/loaders?${query}`)
        },
        enabled: selectedLoader != null && minecraftVersion.trim().length > 0,
        retry: false,
        staleTime: 15 * 60 * 1_000
    })
    const mutation = useMutation({
        mutationFn: async ({ value, icon }: { value: Record<string, unknown>, icon: File | null }) => {
            if (icon) {
                const body = new FormData()
                body.append('file', icon)
                const upload = await api<{ id: string }>(`/api/v1/projects/${project.id}/uploads`, { method: 'POST', body })
                value.iconUploadId = upload.id
            }
            return api(
                server ? `/api/v1/projects/${project.id}/servers/${server.id}` : `/api/v1/projects/${project.id}/servers`,
                { method: server ? 'PUT' : 'POST', ...jsonBody(value) }
            )
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['project', project.id] })
            onDone()
        }
    })
    const submit = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        const ruleLines = String(data.get('untrackedRules') ?? '').split(/\r?\n/).map(value => value.trim()).filter(Boolean)
        const rules = ruleLines.map(line => {
            const separator = line.indexOf(':')
            return { appliesTo: line.slice(0, separator), pattern: line.slice(separator + 1) }
        })
        const supported = String(data.get('javaSupported') ?? '').trim()
        const suggested = Number(data.get('javaSuggested'))
        const ramMinimum = Number(data.get('ramMinimum'))
        const ramRecommended = Number(data.get('ramRecommended'))
        const iconValue = data.get('icon')
        mutation.mutate({ value: {
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
                ...(ramMinimum && ramRecommended ? { ram: { minimum: ramMinimum, recommended: ramRecommended } } : {})
            } : null,
            untrackedRules: rules
        }, icon: iconValue instanceof File && iconValue.size > 0 ? iconValue : null })
    }
    return <form className="form-grid inset" onSubmit={submit}>
        <label>{t('serverId')}<input name="serverKey" defaultValue={server?.serverKey} disabled={server?.publishedOnce} required /></label>
        <label>{t('name')}<input name="name" defaultValue={server?.name} required /></label>
        <label className="wide">{t('description')}<textarea name="description" defaultValue={server?.description} /></label>
        <label>{t('minecraft')}
            <input
                name="minecraftVersion"
                value={minecraftVersion}
                onChange={event => setMinecraftVersion(event.target.value)}
                list="minecraft-version-options"
                autoComplete="off"
                required
            />
            <datalist id="minecraft-version-options">
                {minecraftCatalog.data?.versions.map(version =>
                    <option key={version.value} value={version.value} />
                )}
            </datalist>
            <small className={minecraftCatalog.isError ? 'field-hint warning' : 'field-hint'}>
                {minecraftCatalog.isPending
                    ? t('versionsLoading')
                    : minecraftCatalog.isError
                        ? t('versionsUnavailable')
                        : minecraftCatalog.data.stale
                            ? t('versionsStale')
                            : t('manualVersionHint')}
            </small>
        </label>
        <label>{t('serverVersion')}<input name="serverVersion" defaultValue={server?.serverVersion ?? '1.0.0'} required /></label>
        <label>{t('address')}<input name="address" defaultValue={server?.address ?? 'localhost:25565'} required /></label>
        <label>{t('discordShort')}<input name="discordShort" defaultValue={server?.discord?.shortId} /></label>
        <label>{t('discordLargeText')}<input name="discordLargeText" defaultValue={server?.discord?.largeImageText} /></label>
        <label>{t('discordLargeKey')}<input name="discordLargeKey" defaultValue={server?.discord?.largeImageKey} /></label>
        <label>{t('loader')}<select
            name="loader"
            value={loader}
            onChange={event => {
                setLoader(event.target.value as 'none' | VersionCatalogLoader)
                setLoaderVersion('')
            }}
        ><option value="none">{t('loaderNone')}</option><option value="forge">Forge</option><option value="fabric">Fabric</option></select></label>
        <label>{t('loaderVersion')}
            <input
                name="loaderVersion"
                value={loaderVersion}
                onChange={event => setLoaderVersion(event.target.value)}
                list="loader-version-options"
                autoComplete="off"
                disabled={!selectedLoader}
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
            {selectedLoader && <small className={loaderCatalog.isError ? 'field-hint warning' : 'field-hint'}>
                {loaderCatalog.isPending
                    ? t('versionsLoading')
                    : loaderCatalog.isError
                        ? t('versionsUnavailable')
                        : loaderCatalog.data.stale
                            ? t('versionsStale')
                            : loaderCatalog.data.versions.length === 0
                                ? t('noCompatibleVersions')
                                : t('manualVersionHint')}
            </small>}
        </label>
        <label>{t('order')}<input name="sortOrder" type="number" min="0" defaultValue={server?.sortOrder ?? 0} /></label>
        <label>{t('javaSupported')}<input name="javaSupported" defaultValue={(server?.javaOptions as { supported?: string } | null)?.supported} placeholder=">=17" /></label>
        <label>{t('javaSuggested')}<input name="javaSuggested" type="number" min="8" defaultValue={(server?.javaOptions as { suggestedMajor?: number } | null)?.suggestedMajor} /></label>
        <label>{t('ramMinimum')}<input name="ramMinimum" type="number" min="512" step="512" defaultValue={(server?.javaOptions as { ram?: { minimum?: number } } | null)?.ram?.minimum} /></label>
        <label>{t('ramRecommended')}<input name="ramRecommended" type="number" min="512" step="512" defaultValue={(server?.javaOptions as { ram?: { recommended?: number } } | null)?.ram?.recommended} /></label>
        <label className="wide file-input">{t('serverIcon')}<input name="icon" type="file" accept="image/png,image/jpeg" /></label>
        <label className="wide">{t('untrackedRules')}<textarea name="untrackedRules" defaultValue={server?.untrackedRules.map(rule => `${rule.appliesTo}:${rule.pattern}`).join('\n')} placeholder={t('untrackedHint')} /></label>
        <label className="checkbox"><input name="mainServer" type="checkbox" defaultChecked={server?.mainServer} />{t('mainServer')}</label>
        <label className="checkbox"><input name="autoconnect" type="checkbox" defaultChecked={server?.autoconnect} />{t('autoconnect')}</label>
        <ErrorNotice error={mutation.error} />
        <div className="actions"><button type="button" className="secondary" onClick={onDone}>{t('cancel')}</button><button className="primary">{t('save')}</button></div>
    </form>
}

function ServerPanel({ detail, canEdit }: { detail: ProjectDetail, canEdit: boolean }): ReactNode {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const [editor, setEditor] = useState<ManagedServer | 'new' | null>(null)
    const remove = useMutation({
        mutationFn: (server: ManagedServer) => api(`/api/v1/projects/${detail.project.id}/servers/${server.id}`, {
            method: 'DELETE', ...jsonBody({ revision: detail.project.draftRevision })
        }),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['project', detail.project.id] })
    })
    return <section className="card"><div className="section-heading"><h2>{t('servers')}</h2>{canEdit && <button className="secondary" onClick={() => setEditor('new')}>{t('newServer')}</button>}</div>
        {editor && <ServerForm project={detail.project} server={editor === 'new' ? undefined : editor} onDone={() => setEditor(null)} />}
        <div className="server-list">
            {detail.servers.map(server => <article className="server-row" key={server.id}>
                <div><span className="server-version">MC {server.minecraftVersion}</span><h3>{server.name}</h3><p><code>{server.serverKey}</code> · {server.address}</p></div>
                <div className="server-meta"><span>{server.forgeVersion ? `Forge ${server.forgeVersion}` : server.fabricVersion ? `Fabric ${server.fabricVersion}` : t('loaderNone')}</span>{server.mainServer && <span className="pill">{t('mainServer')}</span>}</div>
                {canEdit && <div className="row-actions"><button className="text-button" onClick={() => setEditor(server)}>{t('edit')}</button><button className="danger-link" onClick={() => window.confirm(t('confirmDelete')) && remove.mutate(server)}>{t('delete')}</button></div>}
            </article>)}
            {detail.servers.length === 0 && <div className="empty">{t('noServers')}</div>}
        </div><ErrorNotice error={remove.error} />
    </section>
}

function ModulePanel({ detail, canEdit }: { detail: ProjectDetail, canEdit: boolean }): ReactNode {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const [error, setError] = useState<unknown>()
    const uploadModule = useMutation({
        mutationFn: async (form: HTMLFormElement) => {
            const data = new FormData(form)
            const file = data.get('file')
            if (!(file instanceof File) || file.size === 0) throw new Error(t('chooseFile'))
            const fileBody = new FormData(); fileBody.append('file', file)
            const stored = await api<{ id: string }>(`/api/v1/projects/${detail.project.id}/uploads`, { method: 'POST', body: fileBody })
            const type = String(data.get('type'))
            return api(`/api/v1/projects/${detail.project.id}/servers/${String(data.get('serverId'))}/modules`, {
                method: 'POST',
                ...jsonBody({
                    revision: detail.project.draftRevision,
                    uploadId: stored.id,
                    type,
                    displayName: String(data.get('displayName') || file.name),
                    relativePath: type === 'File' ? String(data.get('relativePath')) : null,
                    optionalMode: String(data.get('optionalMode')),
                    sortOrder: Number(data.get('sortOrder'))
                })
            })
        },
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['project', detail.project.id] }),
        onError: setError
    })
    const remove = useMutation({
        mutationFn: ({ serverId, moduleId }: { serverId: string, moduleId: string }) => api(`/api/v1/projects/${detail.project.id}/servers/${serverId}/modules/${moduleId}`, {
            method: 'DELETE', ...jsonBody({ revision: detail.project.draftRevision })
        }),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['project', detail.project.id] })
    })
    const importPack = useMutation({
        mutationFn: async (form: HTMLFormElement) => {
            const data = new FormData(form)
            const file = data.get('file')
            if (!(file instanceof File) || file.size === 0) throw new Error(t('chooseFile'))
            const body = new FormData(); body.append('file', file)
            const upload = await api<{ id: string }>(`/api/v1/projects/${detail.project.id}/uploads`, { method: 'POST', body })
            return api(`/api/v1/projects/${detail.project.id}/imports/curseforge`, {
                method: 'POST', ...jsonBody({ uploadId: upload.id, serverKey: String(data.get('serverKey')) })
            })
        },
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['jobs', detail.project.id] })
    })
    return <section className="card"><h2>{t('files')}</h2>
        {canEdit && detail.servers.length > 0 && <details className="sub-disclosure"><summary>{t('uploadModule')}</summary>
            <form className="form-grid inset" onSubmit={event => { event.preventDefault(); uploadModule.mutate(event.currentTarget) }}>
                <label>{t('chooseServer')}<select name="serverId">{detail.servers.map(server => <option key={server.id} value={server.id}>{server.name}</option>)}</select></label>
                <label>{t('type')}<select name="type"><option>ForgeMod</option><option>FabricMod</option><option>Library</option><option>File</option></select></label>
                <label>{t('name')}<input name="displayName" /></label><label>{t('destination')}<input name="relativePath" placeholder="config/options.txt" /></label>
                <label>{t('status')}<select name="optionalMode"><option value="REQUIRED">{t('required')}</option><option value="OPTIONAL_ON">{t('optionalOn')}</option><option value="OPTIONAL_OFF">{t('optionalOff')}</option></select></label>
                <label>{t('order')}<input name="sortOrder" type="number" min="0" defaultValue="0" /></label>
                <label className="wide file-input">{t('chooseFile')}<input name="file" type="file" required /></label>
                <div className="actions"><button className="primary" disabled={uploadModule.isPending}>{t('upload')}</button></div>
            </form>
        </details>}
        {canEdit && <details className="sub-disclosure"><summary>{t('curseForge')}</summary>
            <form className="form-grid inset" onSubmit={event => { event.preventDefault(); importPack.mutate(event.currentTarget) }}>
                <label>{t('serverId')}<input name="serverKey" required /></label>
                <label className="file-input">{t('chooseFile')}<input name="file" type="file" accept=".zip" required /></label>
                <div className="actions"><button className="primary">{t('import')}</button></div>
            </form>
        </details>}
        <ErrorNotice error={error ?? uploadModule.error ?? importPack.error ?? remove.error} />
        {detail.servers.map(server => <div className="module-group" key={server.id}><h3>{server.name}<span>{server.modules.length}</span></h3>
            {server.modules.map(module => <div className="module-row" key={module.id}>
                <span className={`file-type type-${module.type.toLowerCase()}`}>{module.type}</span>
                <div><strong>{module.displayName}</strong><small>{module.relativePath || module.originalName} · {module.size ? `${module.size.toLocaleString()} ${t('bytes')}` : ''}</small></div>
                {module.needsManualFile && <a href={module.manualUrl ?? '#'} className="warning" target="_blank" rel="noreferrer">{t('waitingFile')}</a>}
                {canEdit && <button className="danger-link" onClick={() => window.confirm(t('confirmDelete')) && remove.mutate({ serverId: server.id, moduleId: module.id })}>{t('delete')}</button>}
            </div>)}
        </div>)}
    </section>
}

function ReleasePanel({ project, canEdit }: { project: Project, canEdit: boolean }): ReactNode {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const jobs = useQuery({ queryKey: ['jobs', project.id], queryFn: () => api<{ items: Job[] }>(`/api/v1/projects/${project.id}/jobs`), refetchInterval: 3000 })
    const releases = useQuery({ queryKey: ['releases', project.id], queryFn: () => api<{ items: Release[] }>(`/api/v1/projects/${project.id}/releases`), refetchInterval: 5000 })
    const retry = useMutation({ mutationFn: (id: string) => api(`/api/v1/jobs/${id}/retry`, { method: 'POST' }), onSuccess: () => void jobs.refetch() })
    const activate = useMutation({
        mutationFn: (id: string) => api(`/api/v1/projects/${project.id}/releases/${id}/activate`, { method: 'POST' }),
        onSuccess: () => { void releases.refetch(); void queryClient.invalidateQueries({ queryKey: ['project', project.id] }) }
    })
    return <div className="two-column">
        <section className="card"><h2>{t('jobs')}</h2>{jobs.data?.items.map(job => <div className="timeline-row" key={job.id}>
            <span className={`job-state state-${job.status.toLowerCase()}`} />
            <div><strong>{job.kind}</strong><small>{new Date(job.createdAt).toLocaleString()} · {t('attempts')} {job.attempts}/{job.maxAttempts}</small>{job.error && <p className="error-text">{job.error}</p>}</div>
            <span>{job.status === 'RUNNING' ? `${job.progress}%` : job.status}</span>
            {canEdit && job.status === 'FAILED' && <button className="text-button" onClick={() => retry.mutate(job.id)}>{t('retry')}</button>}
        </div>)}{jobs.data?.items.length === 0 && <div className="empty">{t('noRecords')}</div>}</section>
        <section className="card"><h2>{t('releases')}</h2>{releases.data?.items.map(release => <div className="timeline-row" key={release.id}>
            <span className={`job-state ${release.status === 'ACTIVE' ? 'state-succeeded' : ''}`} />
            <div><strong>r{release.draftRevision}</strong><small>{new Date(release.activatedAt).toLocaleString()} · {release.createdBy}</small></div>
            <span className="pill">{release.status}</span>
            {canEdit && release.retained && release.status !== 'ACTIVE' && <button className="text-button" onClick={() => window.confirm(t('confirmRollback')) && activate.mutate(release.id)}>{t('rollback')}</button>}
        </div>)}{releases.data?.items.length === 0 && <div className="empty">{t('noRecords')}</div>}</section>
        <ErrorNotice error={jobs.error ?? releases.error ?? retry.error ?? activate.error} />
    </div>
}

function ProjectPage({ user }: { user: ApiUser }): ReactNode {
    const { projectId = '' } = useParams()
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const detail = useQuery({ queryKey: ['project', projectId], queryFn: () => api<ProjectDetail>(`/api/v1/projects/${projectId}`) })
    const publish = useMutation({
        mutationFn: (revision: number) => api<{ jobId: string }>(`/api/v1/projects/${projectId}/publish`, { method: 'POST', ...jsonBody({ revision }) }),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['jobs', projectId] })
    })
    if (detail.isLoading) return <div className="loading">NEBULA</div>
    if (!detail.data) return <ErrorNotice error={detail.error} />
    const canEdit = user.role === 'ADMIN' || user.role === 'EDITOR'
    const project = detail.data.project
    return <>
        <header className="page-header project-header"><div><Link to="/projects" className="back-link">← {t('projects')}</Link><h1>{project.name}</h1><p><code>/{project.slug}</code> · {t('revision')} {project.draftRevision}</p></div>
            {canEdit && <div className="publish-block"><button className="publish-button" disabled={publish.isPending} onClick={() => window.confirm(t('confirmPublish')) && publish.mutate(project.draftRevision)}>{publish.isPending ? t('publishing') : t('publish')}</button><small>{t('publishHint')}</small></div>}
        </header>
        <ErrorNotice error={publish.error} />
        <ProjectSettings detail={detail.data} canEdit={canEdit} />
        <ServerPanel detail={detail.data} canEdit={canEdit} />
        <ModulePanel detail={detail.data} canEdit={canEdit} />
        <ReleasePanel project={project} canEdit={canEdit} />
    </>
}

function UsersPage(): ReactNode {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const users = useQuery({ queryKey: ['users'], queryFn: () => api<{ items: ApiUser[] }>('/api/v1/users') })
    const create = useMutation({ mutationFn: (value: unknown) => api('/api/v1/users', { method: 'POST', ...jsonBody(value) }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['users'] }) })
    const update = useMutation({ mutationFn: ({ id, value }: { id: string, value: unknown }) => api(`/api/v1/users/${id}`, { method: 'PATCH', ...jsonBody(value) }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['users'] }) })
    const resetPassword = useMutation({
        mutationFn: ({ id, password }: { id: string, password: string }) => api(`/api/v1/users/${id}/reset-password`, { method: 'POST', ...jsonBody({ password }) }),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['users'] })
    })
    const promptPasswordReset = (user: ApiUser): void => {
        const password = window.prompt(`${t('resetPassword')}: ${user.username}`)
        if (password == null) return
        if (password.length < 12) {
            window.alert(t('passwordTooShort'))
            return
        }
        resetPassword.mutate({ id: user.id, password })
    }
    const submit = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault(); const data = new FormData(event.currentTarget)
        create.mutate({ username: String(data.get('username')), password: String(data.get('password')), role: String(data.get('role')) })
        event.currentTarget.reset()
    }
    return <><header className="page-header"><div><p className="eyebrow">IDENTITY & ACCESS</p><h1>{t('users')}</h1></div></header>
        <details className="card disclosure"><summary>{t('newUser')}</summary><form className="form-grid" onSubmit={submit}>
            <label>{t('username')}<input name="username" required /></label><label>{t('password')}<input name="password" type="password" minLength={12} required /></label>
            <label>{t('role')}<select name="role"><option value="EDITOR">{t('editor')}</option><option value="AUDITOR">{t('auditor')}</option><option value="ADMIN">{t('admin')}</option></select></label>
            <div className="actions"><button className="primary">{t('create')}</button></div>
        </form></details>
        <section className="card table-card"><table><thead><tr><th>{t('username')}</th><th>{t('role')}</th><th>{t('status')}</th><th /></tr></thead><tbody>{users.data?.items.map(user => <tr key={user.id}><td><strong>{user.username}</strong></td><td><select aria-label={`${t('role')}: ${user.username}`} value={user.role} onChange={event => update.mutate({ id: user.id, value: { role: event.target.value } })}><option value="ADMIN">{t('admin')}</option><option value="EDITOR">{t('editor')}</option><option value="AUDITOR">{t('auditor')}</option></select></td><td>{user.status}</td><td><div className="row-actions"><button className="text-button" onClick={() => promptPasswordReset(user)}>{t('resetPassword')}</button><button className="text-button" onClick={() => update.mutate({ id: user.id, value: { status: user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' } })}>{user.status === 'ACTIVE' ? t('disable') : t('enable')}</button></div></td></tr>)}</tbody></table></section>
        <ErrorNotice error={users.error ?? create.error ?? update.error ?? resetPassword.error} />
    </>
}

function AuditPage(): ReactNode {
    const { t } = useTranslation()
    const [action, setAction] = useState('')
    const logs = useQuery({ queryKey: ['audit', action], queryFn: () => api<{ items: AuditLog[] }>(`/api/v1/audit-logs?limit=100${action ? `&action=${encodeURIComponent(action)}` : ''}`) })
    const actions = useMemo(() => [...new Set(logs.data?.items.map(item => item.action) ?? [])], [logs.data])
    return <><header className="page-header"><div><p className="eyebrow">IMMUTABLE EVENT TRAIL</p><h1>{t('audit')}</h1></div><div className="header-actions"><a className="secondary button-link" href="/api/v1/audit-logs?format=csv">{t('exportCsv')}</a><a className="secondary button-link" href="/api/v1/audit-logs?format=json">{t('exportJson')}</a></div></header>
        <section className="card"><div className="filters"><label>{t('action')}<select value={action} onChange={event => setAction(event.target.value)}><option value="">—</option>{actions.map(value => <option key={value}>{value}</option>)}</select></label></div>
            <div className="audit-list">{logs.data?.items.map(log => <details className="audit-row" key={log.id}><summary><time>{new Date(log.createdAt).toLocaleString()}</time><strong>{log.action}</strong><span>{log.actorUsername ?? 'SYSTEM'}</span><span className={`result-${log.result.toLowerCase()}`}>{log.result}</span></summary><pre>{JSON.stringify({ entity: `${log.entityType}:${log.entityId}`, ip: log.ip, before: log.before, after: log.after, error: log.errorMessage }, null, 2)}</pre></details>)}</div>
        </section><ErrorNotice error={logs.error} /></>
}

export function App(): ReactNode {
    const session = useSession()
    if (session.isLoading) return <div className="splash"><div className="nebula-mark"><span /></div><strong>NEBULA</strong></div>
    if (session.error instanceof ApiError && session.error.status === 401 || !session.data) return <LoginPage />
    if (session.data.user.mustChangePassword) return <ChangePasswordPage user={session.data.user} />
    const user = session.data.user
    return <Shell user={user}><Routes>
        <Route path="/projects" element={<ProjectsPage user={user} />} />
        <Route path="/projects/:projectId" element={<ProjectPage user={user} />} />
        <Route path="/users" element={user.role === 'ADMIN' ? <UsersPage /> : <Navigate to="/projects" replace />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes></Shell>
}
