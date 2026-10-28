import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, Route, Routes, useNavigate, useParams } from './router.js'
import type { ApiUser, LauncherUsageResponse } from '@nebula/shared'
import {
    api,
    ApiError,
    jsonBody,
    setCsrfToken,
    type AuditLog,
    type AuthResponse,
    type DisabledProject,
    type JobSummary,
    type PaginatedResponse,
    type Project,
    type ProjectSummary
} from './api.js'
import {
    NewServerPage,
    ServerFilesPage,
    ServerLauncherPage,
    ServerOverviewPage,
    ServerRootRedirect,
    ServerSettingsPage
} from './server-pages.js'
import { BuildVersion } from './BuildVersion.js'
import { ConsoleShell as Shell } from './visual/ConsoleShell.js'
import { MotionToggle } from './visual/motion.js'
import { Spotlight } from './visual/Spotlight.js'
import { Icon } from './visual/Icon.js'

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
    const { t, i18n } = useTranslation()
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
            <p className="eyebrow">{t('controlPlane')}</p>
            <h1>{t('brand')}</h1>
            <p className="muted">{t('tagline')}</p>
            <form onSubmit={submit} className="stack">
                <label>{t('username')}<input name="username" autoComplete="username" required autoFocus /></label>
                <label>{t('password')}<input name="password" type="password" autoComplete="current-password" required /></label>
                <ErrorNotice error={login.error} />
                <button className="primary login-submit" disabled={login.isPending}><span>{t('login')}</span><Icon name="arrow" /></button>
            </form>
            <div className="login-controls"><MotionToggle /><button type="button" className="text-button" onClick={() => void i18n.changeLanguage(i18n.resolvedLanguage === 'en' ? 'zh-TW' : 'en')}><Icon name="globe" />{t('language')}</button></div>
            <BuildVersion />
        </section>
        <aside className="login-art" aria-hidden="true">
            <div className="art-coordinate">NEBULA / 001 <span>25° 02′ N · 121° 33′ E</span></div>
            <div className="orbital-system"><div className="orbital-halo" /><div className="cosmic-ring ring-one" /><div className="cosmic-ring ring-two" /><div className="cosmic-ring ring-three" /><div className="cosmic-core"><span>N</span></div><span className="orbit-label">HELIOS NETWORK</span></div>
            <div className="art-copy"><p className="eyebrow">{t('loginArtEyebrow')}</p><h2>{t('loginArtTitle')}</h2><p>{t('loginArtHint')}</p></div>
            <div className="art-footer"><span><i />{t('loginArtFooter')}</span><span>01 — ∞</span></div>
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
    return <main className="center-page"><section className="card narrow password-card">
        <div className="nebula-mark" aria-hidden="true"><span /></div><p className="eyebrow">{user.username}</p><h1>{t('forcedPassword')}</h1>
        <form className="stack" onSubmit={submit}>
            <label>{t('currentPassword')}<input name="currentPassword" type="password" required /></label>
            <label>{t('newPassword')}<input name="newPassword" type="password" minLength={12} required /></label>
            <ErrorNotice error={change.error} />
            <button className="primary">{t('changePassword')}</button>
        </form>
        <MotionToggle />
    </section></main>
}

function ProjectsPage({ user }: { user: ApiUser }): ReactNode {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const projects = useQuery({ queryKey: ['projects'], queryFn: () => api<{ items: Project[] }>('/api/v1/projects') })
    const disabledProjects = useQuery({
        queryKey: ['projects', 'disabled'],
        queryFn: () => api<{ items: DisabledProject[] }>('/api/v1/projects/disabled'),
        enabled: user.role === 'ADMIN',
        refetchInterval: query => query.state.data?.items.some(project =>
            project.deletion?.status === 'QUEUED' || project.deletion?.status === 'RUNNING'
        ) ? 3000 : false
    })
    const createProject = useMutation({
        mutationFn: (value: unknown) => api('/api/v1/projects', { method: 'POST', ...jsonBody(value) }),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['projects'] })
    })
    const restoreProject = useMutation({
        mutationFn: ({ id, draftVersion }: { id: string, draftVersion: number }) => api(`/api/v1/projects/${id}/restore`, {
            method: 'POST',
            ...jsonBody({ draftVersion })
        }),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['projects'] })
    })
    const purgeProject = useMutation({
        mutationFn: ({ id, draftVersion, confirmationName }: { id: string, draftVersion: number, confirmationName: string }) => api(`/api/v1/projects/${id}/purge`, {
            method: 'POST',
            ...jsonBody({ draftVersion, confirmationName })
        }),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['projects', 'disabled'] })
    })
    const retryPurge = useMutation({
        mutationFn: ({ id, draftVersion }: { id: string, draftVersion: number }) => api(`/api/v1/projects/${id}/purge/retry`, {
            method: 'POST',
            ...jsonBody({ draftVersion })
        }),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['projects', 'disabled'] })
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
    const confirmRestore = (project: DisabledProject): void => {
        if (window.confirm(t('confirmRestoreProject', { name: project.name }))) {
            restoreProject.mutate({ id: project.id, draftVersion: project.draftVersion })
        }
    }
    const confirmPurge = (project: DisabledProject): void => {
        if (!window.confirm(t('confirmPurgeProject', { name: project.name }))) return
        const confirmationName = window.prompt(t('purgeProjectNamePrompt', { name: project.name }))
        if (confirmationName == null) return
        if (confirmationName !== project.name) {
            window.alert(t('purgeProjectNameMismatch'))
            return
        }
        purgeProject.mutate({ id: project.id, draftVersion: project.draftVersion, confirmationName })
    }
    return <>
        <header className="page-header"><div><p className="eyebrow">{t('controlPlane')}</p><h1>{t('projects')}</h1><p>{t('projectsHint')}</p></div><span className="header-emblem" aria-hidden="true"><Icon name="layers" /></span></header>
        <section className="project-summary" aria-label={t('workspaceSummary')}>
            <Spotlight><article className="metric-card"><Icon name="layers" /><span>{t('totalDistributions')}</span><strong>{projects.data ? projects.data.items.length.toString().padStart(2, '0') : '—'}</strong></article></Spotlight>
            <Spotlight><article className="metric-card"><Icon name="pulse" /><span>{t('publishedDistributions')}</span><strong>{projects.data ? projects.data.items.filter(project => project.published).length.toString().padStart(2, '0') : '—'}</strong></article></Spotlight>
            <Spotlight><article className="metric-card"><Icon name="sparkles" /><span>{t('draftDistributions')}</span><strong>{projects.data ? projects.data.items.filter(project => !project.published).length.toString().padStart(2, '0') : '—'}</strong></article></Spotlight>
        </section>
        {user.role === 'ADMIN' && <details className="card disclosure">
            <summary><Icon name="plus" />{t('newProject')}</summary>
            <form className="form-grid" onSubmit={submit}>
                <label>{t('name')}<input name="name" required /></label>
                <label>{t('slug')}<input name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required /></label>
                <label className="wide">{t('description')}<textarea name="description" /></label>
                <label className="wide">{t('rss')}<input name="rss" type="url" /></label>
                <ErrorNotice error={createProject.error} /><div className="actions"><button className="primary">{t('create')}</button></div>
            </form>
        </details>}
        <div className="project-grid">
            {projects.data?.items.map((project, index) => <Spotlight className="project-spotlight" key={project.id} style={{ animationDelay: `${Math.min(index, 5) * 65}ms` }}><Link className="project-card" to={`/projects/${project.id}`}>
                <div className="project-card-art" aria-hidden="true"><Icon name="layers" /><Icon name="arrow" /></div>
                <div className="project-card-top"><span className={`status-dot ${project.published ? 'online' : ''}`} /><span>{project.published ? t('active') : t('draft')}</span></div>
                <h2>{project.name}</h2><p>{project.description || project.slug}</p>
                <footer><code>/{project.slug}</code><span>{project.releaseRevision == null ? t('notPublished') : `${t('revision')} ${project.releaseRevision}`}</span></footer>
            </Link></Spotlight>)}
            {!projects.isLoading && projects.data?.items.length === 0 && <div className="empty">{t('noProjects')}</div>}
        </div>
        <ErrorNotice error={projects.error} />
        {user.role === 'ADMIN' && <details className="card disclosure disabled-projects">
            <summary>{t('disabledProjects')} ({disabledProjects.data?.items.length ?? 0})</summary>
            <div className="disabled-project-list">
                {disabledProjects.data?.items.map(project => {
                    const deletion = project.deletion
                    const restorePending = restoreProject.isPending && restoreProject.variables.id === project.id
                    const purgePending = purgeProject.isPending && purgeProject.variables.id === project.id
                    const retryPending = retryPurge.isPending && retryPurge.variables.id === project.id
                    return <article className="disabled-project-card" key={project.id}>
                        <div>
                            <h3>{project.name}</h3>
                            <p><code>/{project.slug}</code> · {t('disabledAt')} {project.disabledAt ? new Date(project.disabledAt).toLocaleString() : '—'}</p>
                            {deletion && <span className={`pill deletion-${deletion.status.toLowerCase()}`}>
                                {deletion.status === 'QUEUED' ? t('purgeQueued') : deletion.status === 'RUNNING' ? t('purgeRunning') : t('purgeFailed')}
                            </span>}
                            {deletion?.status === 'FAILED' && deletion.error && <small className="error-text">{deletion.error}</small>}
                        </div>
                        <div className="disabled-project-actions">
                            {!deletion && <>
                                <button className="secondary" disabled={restorePending || purgePending} onClick={() => confirmRestore(project)}>
                                    {restorePending ? t('restoringProject') : t('restoreProject')}
                                </button>
                                <button className="danger-button" disabled={restorePending || purgePending} onClick={() => confirmPurge(project)}>
                                    {purgePending ? t('queueingPurge') : t('purgeProject')}
                                </button>
                            </>}
                            {deletion?.status === 'FAILED' && <button
                                className="danger-button"
                                disabled={retryPending}
                                onClick={() => retryPurge.mutate({ id: project.id, draftVersion: project.draftVersion })}
                            >{retryPending ? t('queueingPurge') : t('retryPurge')}</button>}
                        </div>
                    </article>
                })}
                {!disabledProjects.isLoading && disabledProjects.data?.items.length === 0 && <div className="empty">{t('noDisabledProjects')}</div>}
            </div>
            <ErrorNotice error={disabledProjects.error ?? restoreProject.error ?? purgeProject.error ?? retryPurge.error} />
        </details>}
    </>
}

function formatUsageDate(date: string, language: string, includeYear = false): string {
    return new Intl.DateTimeFormat(language, {
        timeZone: 'Asia/Taipei',
        month: 'short',
        day: 'numeric',
        ...(includeYear ? { year: 'numeric' } : {})
    }).format(new Date(`${date}T00:00:00.000Z`))
}

function LauncherUsageChart({ usage }: { usage: LauncherUsageResponse }): ReactNode {
    const { t, i18n } = useTranslation()
    const width = 960
    const height = 320
    const padding = { top: 22, right: 22, bottom: 48, left: 58 }
    const plotWidth = width - padding.left - padding.right
    const plotHeight = height - padding.top - padding.bottom
    const maximum = Math.max(1, ...usage.series.map(day => day.activeLaunchers))
    const point = (value: number, index: number): { x: number, y: number } => ({
        x: padding.left + index / Math.max(usage.series.length - 1, 1) * plotWidth,
        y: padding.top + (1 - value / maximum) * plotHeight
    })
    const points = usage.series.map((day, index) => {
        const position = point(day.activeLaunchers, index)
        return `${position.x},${position.y}`
    }).join(' ')
    const tickIndexes = [0, 7, 14, 21, usage.series.length - 1]
    const language = i18n.resolvedLanguage ?? 'zh-TW'

    return <svg className="usage-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="usageChartTitle usageChartDescription">
        <title id="usageChartTitle">{t('analyticsChartTitle')}</title>
        <desc id="usageChartDescription">{t('analyticsChartDescription', { maximum })}</desc>
        {[0, 0.25, 0.5, 0.75, 1].map(ratio => {
            const y = padding.top + ratio * plotHeight
            const value = Math.round(maximum * (1 - ratio))
            return <g key={ratio}><line className="usage-grid-line" x1={padding.left} x2={width - padding.right} y1={y} y2={y} /><text className="usage-axis-label" x={padding.left - 12} y={y + 4} textAnchor="end">{value}</text></g>
        })}
        <polyline className="usage-line" points={points} />
        {tickIndexes.map(index => {
            const day = usage.series[index]
            if (!day) return null
            const position = point(day.activeLaunchers, index)
            return <text className="usage-axis-label" key={day.date} x={position.x} y={height - 16} textAnchor={index === 0 ? 'start' : index === usage.series.length - 1 ? 'end' : 'middle'}>{formatUsageDate(day.date, language)}</text>
        })}
        {usage.series.map((day, index) => {
            const position = point(day.activeLaunchers, index)
            return <circle className="usage-point" key={day.date} cx={position.x} cy={position.y} r={index === usage.series.length - 1 ? 5 : 3}>
                <title>{formatUsageDate(day.date, language, true)}: {day.activeLaunchers}</title>
            </circle>
        })}
    </svg>
}

function AnalyticsPage(): ReactNode {
    const { t, i18n } = useTranslation()
    const projects = useQuery({ queryKey: ['projects'], queryFn: () => api<{ items: Project[] }>('/api/v1/projects') })
    const [projectId, setProjectId] = useState('')
    useEffect(() => {
        const items = projects.data?.items ?? []
        if (items.length > 0 && !items.some(project => project.id === projectId)) {
            setProjectId(items[0].id)
        }
    }, [projectId, projects.data])
    const usage = useQuery({
        queryKey: ['launcher-usage', projectId],
        queryFn: () => api<LauncherUsageResponse>(`/api/v1/projects/${projectId}/launcher-usage`),
        enabled: projectId.length > 0
    })
    const today = usage.data?.series.at(-1)
    const language = i18n.resolvedLanguage ?? 'zh-TW'

    return <>
        <header className="page-header"><div><p className="eyebrow">{t('analyticsEyebrow')}</p><h1>{t('analytics')}</h1><p>{t('analyticsHint')}</p></div></header>
        <section className="card analytics-filter">
            <label>{t('analyticsDistribution')}<select value={projectId} disabled={projects.isLoading || (projects.data?.items.length ?? 0) === 0} onChange={event => setProjectId(event.target.value)}>
                {projects.data?.items.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}
            </select></label>
            <p className="muted">{t('analyticsTimeZone')}</p>
        </section>
        <ErrorNotice error={projects.error ?? usage.error} />
        {!projects.isLoading && projects.data?.items.length === 0 && <div className="empty">{t('analyticsNoProjects')}</div>}
        {usage.isLoading && projectId && <section className="card analytics-loading">{t('analyticsLoading')}</section>}
        {usage.data && <>
            <section className="analytics-summary">
                <Spotlight className="usage-spotlight"><article className="card usage-today"><Icon name="pulse" /><span>{t('analyticsToday')}</span><strong>{today?.activeLaunchers ?? 0}</strong><small>{t('analyticsEstimated')}</small></article></Spotlight>
                <article className="card usage-chart-card"><div className="section-heading"><div><h2>{t('analyticsChartTitle')}</h2><p className="muted">{usage.data.project.name} · {usage.data.from} — {usage.data.to}</p></div></div><LauncherUsageChart usage={usage.data} /></article>
            </section>
            <details className="card usage-table"><summary>{t('analyticsTable')}</summary><div className="table-card"><table><thead><tr><th>{t('analyticsDate')}</th><th>{t('analyticsActiveLaunchers')}</th></tr></thead><tbody>
                {[...usage.data.series].reverse().map(day => <tr key={day.date}><td>{formatUsageDate(day.date, language, true)}</td><td>{day.activeLaunchers}</td></tr>)}
            </tbody></table></div></details>
        </>}
    </>
}

function ProjectSettings({ detail, canEdit }: { detail: ProjectSummary, canEdit: boolean }): ReactNode {
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
            draftVersion: detail.project.draftVersion,
            name: String(data.get('name')),
            slug: String(data.get('slug') ?? detail.project.slug),
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
            <label>{t('slug')}<input name="slug" defaultValue={detail.project.slug} disabled={!canEdit || detail.project.published} required /></label>
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

function LauncherPanel({ project }: { project: Project }): ReactNode {
    const { t } = useTranslation()
    const [copied, setCopied] = useState(false)
    const copyUrl = async (): Promise<void> => {
        await navigator.clipboard.writeText(project.launcherUrl)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2000)
    }
    const status = !project.published
        ? t('launcherNotPublished')
        : project.stableDistributionReady
            ? t('launcherReady')
            : t('launcherUnavailable')
    return <section className={`card launcher-card ${project.published && !project.stableDistributionReady ? 'launcher-warning' : ''}`}>
        <div className="section-heading"><div><h2>{t('launcherDistribution')}</h2><p className="muted">{t('launcherDistributionHint')}</p></div>
            <span className={`pill ${project.stableDistributionReady ? 'result-success' : ''}`}>{status}</span>
        </div>
        <div className="launcher-url-row"><code>{project.launcherUrl}</code><button type="button" className="secondary" onClick={() => void copyUrl()}>{copied ? t('copied') : t('copyUrl')}</button></div>
        <dl className="launcher-meta"><div><dt>{t('currentPublishId')}</dt><dd><code>{project.currentPublishId ?? '—'}</code></dd></div></dl>
    </section>
}

function ServerPanel({ detail, canEdit }: { detail: ProjectSummary, canEdit: boolean }): ReactNode {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const [orderedIds, setOrderedIds] = useState(() => detail.servers.map(server => server.id))
    const [announcement, setAnnouncement] = useState('')
    const orderedServers = orderedIds.flatMap(id => {
        const server = detail.servers.find(candidate => candidate.id === id)
        return server ? [server] : []
    })
    const orderChanged = orderedIds.some((id, index) => id !== detail.servers[index]?.id)
    const saveOrder = useMutation({
        mutationFn: (serverIds: string[]) => api<{ updated: boolean, draftVersion: number }>(`/api/v1/projects/${detail.project.id}/servers/order`, {
            method: 'PUT',
            ...jsonBody({ draftVersion: detail.project.draftVersion, serverIds })
        }),
        onSuccess: (response, serverIds) => {
            queryClient.setQueryData<ProjectSummary>(['project', detail.project.id, 'summary'], current => {
                if (!current) return current
                const serversById = new Map(current.servers.map(server => [server.id, server]))
                return {
                    project: { ...current.project, draftVersion: response.draftVersion },
                    servers: serverIds.flatMap((id, sortOrder) => {
                        const server = serversById.get(id)
                        return server ? [{ ...server, sortOrder }] : []
                    })
                }
            })
            void queryClient.invalidateQueries({ queryKey: ['project', detail.project.id] })
        }
    })
    const moveServer = (index: number, offset: -1 | 1): void => {
        const targetIndex = index + offset
        const server = orderedServers[index]
        if (!server || targetIndex < 0 || targetIndex >= orderedIds.length) return
        setOrderedIds(current => {
            const next = [...current]
            const currentId = next[index]
            const targetId = next[targetIndex]
            if (!currentId || !targetId) return current
            next[index] = targetId
            next[targetIndex] = currentId
            return next
        })
        setAnnouncement(t('serverMoved', { name: server.name, position: targetIndex + 1 }))
    }
    return <section className="card">
        <div className="section-heading server-panel-heading"><h2>{t('servers')}</h2>{canEdit && <div className="server-panel-actions">
            <button type="button" className="secondary" disabled={!orderChanged || saveOrder.isPending} onClick={() => saveOrder.mutate(orderedIds)}>{saveOrder.isPending ? t('savingServerOrder') : t('saveServerOrder')}</button>
            <Link className="secondary button-link" to={`/projects/${detail.project.id}/servers/new`}>{t('newServer')}</Link>
        </div>}</div>
        <div className="server-list">
            {orderedServers.map((server, index) => <article className="server-row" key={server.id}>
                <div className="server-primary"><span className="server-order-position" aria-label={t('serverPosition', { position: index + 1 })}>{index + 1}</span><div><span className="server-version">MC {server.minecraftVersion}</span><h3>{server.name}</h3><p><code>{server.serverKey}</code> · {server.address}</p></div></div>
                <div className="server-meta"><span>{server.forgeVersion ? `Forge ${server.forgeVersion}` : server.fabricVersion ? `Fabric ${server.fabricVersion}` : t('loaderNone')}</span>{server.mainServer && <span className="pill">{t('mainServer')}</span>}</div>
                <div className="row-actions">{canEdit && <div className="server-order-controls">
                    <button type="button" disabled={index === 0 || saveOrder.isPending} aria-label={t('moveServerUp', { name: server.name })} onClick={() => moveServer(index, -1)}>↑</button>
                    <button type="button" disabled={index === orderedServers.length - 1 || saveOrder.isPending} aria-label={t('moveServerDown', { name: server.name })} onClick={() => moveServer(index, 1)}>↓</button>
                </div>}<Link className="text-button" to={`/projects/${detail.project.id}/servers/${server.id}/overview`}>{t('manage')}</Link></div>
            </article>)}
            {detail.servers.length === 0 && <div className="empty">{t('noServers')}</div>}
        </div>
        <span className="sr-only" aria-live="polite">{announcement}</span>
        <ErrorNotice error={saveOrder.error} />
    </section>
}

function CurseForgePanel({ detail, canEdit }: { detail: ProjectSummary, canEdit: boolean }): ReactNode {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const importPack = useMutation({
        mutationFn: async (form: HTMLFormElement) => {
            const data = new FormData(form)
            const file = data.get('file')
            if (!(file instanceof File) || file.size === 0) throw new Error(t('chooseFile'))
            const body = new FormData()
            body.append('file', file)
            const upload = await api<{ id: string }>(`/api/v1/projects/${detail.project.id}/uploads`, { method: 'POST', body })
            return api(`/api/v1/projects/${detail.project.id}/imports/curseforge`, {
                method: 'POST',
                ...jsonBody({ uploadId: upload.id, serverKey: String(data.get('serverKey')) })
            })
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['jobs', detail.project.id] })
            void queryClient.invalidateQueries({ queryKey: ['project', detail.project.id] })
        }
    })
    if (!canEdit) return null
    return <section className="card"><h2>{t('curseForge')}</h2>
        <p className="muted">{t('curseForgeHint')}</p>
        <form className="form-grid" onSubmit={event => { event.preventDefault(); importPack.mutate(event.currentTarget) }}>
            <label>{t('serverId')}<input name="serverKey" required /></label>
            <label className="file-input">{t('chooseFile')}<input name="file" type="file" accept=".zip" required /></label>
            <div className="actions"><button className="primary" disabled={importPack.isPending}>{t('import')}</button></div>
        </form>
        <ErrorNotice error={importPack.error} />
    </section>
}

const HISTORY_PAGE_SIZE = 5

function HistoryPagination({
    label,
    page,
    hasMore,
    onPrevious,
    onNext
}: {
    label: string
    page: number
    hasMore: boolean
    onPrevious: () => void
    onNext: () => void
}): ReactNode {
    const { t } = useTranslation()
    if (page === 0 && !hasMore) return null
    return <nav className="timeline-pagination" aria-label={label}>
        <button type="button" className="text-button" disabled={page === 0} onClick={onPrevious}>{t('previousPage')}</button>
        <span>{t('pageNumber', { page: page + 1 })}</span>
        <button type="button" className="text-button" disabled={!hasMore} onClick={onNext}>{t('nextPage')}</button>
    </nav>
}

function ReleasePanel({ project, canEdit }: { project: Project, canEdit: boolean }): ReactNode {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const [jobPage, setJobPage] = useState(0)
    const refreshedPublishId = useRef<string | null>(null)
    const jobs = useQuery({
        queryKey: ['jobs', project.id, 'summary', jobPage],
        queryFn: () => api<PaginatedResponse<JobSummary>>(`/api/v1/projects/${project.id}/jobs?view=summary&limit=${HISTORY_PAGE_SIZE}&offset=${jobPage * HISTORY_PAGE_SIZE}`),
        refetchInterval: jobPage === 0 ? 3000 : false
    })
    const latestSuccessfulPublishId = jobs.data?.items.find(job =>
        job.kind === 'PUBLISH' && job.status === 'SUCCEEDED'
    )?.id
    useEffect(() => {
        if (jobPage !== 0 || !latestSuccessfulPublishId
            || latestSuccessfulPublishId === project.currentPublishId
            || latestSuccessfulPublishId === refreshedPublishId.current) return
        refreshedPublishId.current = latestSuccessfulPublishId
        void queryClient.invalidateQueries({ queryKey: ['projects'] })
        void queryClient.invalidateQueries({ queryKey: ['project', project.id, 'summary'] })
    }, [jobPage, latestSuccessfulPublishId, project.id, project.currentPublishId, queryClient])
    const retry = useMutation({ mutationFn: (id: string) => api(`/api/v1/jobs/${id}/retry`, { method: 'POST' }), onSuccess: () => void jobs.refetch() })
    return <section className="card"><h2>{t('jobs')}</h2>{jobs.data?.items.map(job => <div className="timeline-row" key={job.id}>
        <span className={`job-state state-${job.status.toLowerCase()}`} />
        <div><strong>{job.kind}</strong><small>{new Date(job.createdAt).toLocaleString()} · {t('attempts')} {job.attempts}/{job.maxAttempts}</small>{job.error && <p className="error-text">{job.error}</p>}</div>
        <span>{job.status === 'RUNNING'
            ? `${job.progress}%`
            : job.status === 'FAILED'
                ? `${job.status} · ${job.progress}%`
                : job.status}</span>
        {canEdit && job.status === 'FAILED' && <button className="text-button" onClick={() => retry.mutate(job.id)}>{t('retry')}</button>}
    </div>)}{jobs.data?.items.length === 0 && <div className="empty">{t('noRecords')}</div>}
    <HistoryPagination
        label={t('jobsPagination')}
        page={jobPage}
        hasMore={jobs.data?.hasMore ?? false}
        onPrevious={() => setJobPage(current => Math.max(0, current - 1))}
        onNext={() => setJobPage(current => current + 1)}
    />
    <ErrorNotice error={jobs.error ?? retry.error} />
    </section>
}

function ProjectPage({ user }: { user: ApiUser }): ReactNode {
    const { projectId = '' } = useParams()
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const navigate = useNavigate()
    const detail = useQuery({ queryKey: ['project', projectId, 'summary'], queryFn: () => api<ProjectSummary>(`/api/v1/projects/${projectId}?view=summary`) })
    const publish = useMutation({
        mutationFn: (draftVersion: number) => api<{ jobId: string }>(`/api/v1/projects/${projectId}/publish`, { method: 'POST', ...jsonBody({ draftVersion }) }),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['jobs', projectId] })
    })
    const disableProject = useMutation({
        mutationFn: (draftVersion: number) => api(`/api/v1/projects/${projectId}`, { method: 'DELETE', ...jsonBody({ draftVersion }) }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['projects'] })
            queryClient.removeQueries({ queryKey: ['project', projectId] })
            navigate('/projects', { replace: true })
        }
    })
    if (detail.isLoading) return <div className="loading">NEBULA</div>
    if (!detail.data) return <ErrorNotice error={detail.error} />
    const canEdit = user.role === 'ADMIN' || user.role === 'EDITOR'
    const project = detail.data.project
    const confirmDisableProject = (): void => {
        if (!window.confirm(t('confirmDisableProject', { name: project.name }))) return
        const enteredName = window.prompt(t('disableProjectNamePrompt', { name: project.name }))
        if (enteredName == null) return
        if (enteredName !== project.name) {
            window.alert(t('disableProjectNameMismatch'))
            return
        }
        disableProject.mutate(project.draftVersion)
    }
    return <>
        <header className="page-header project-header"><div><Link to="/projects" className="back-link">← {t('projects')}</Link><h1>{project.name}</h1><p><code>/{project.slug}</code> · {project.releaseRevision == null ? t('notPublished') : `${t('revision')} ${project.releaseRevision}`}</p></div>
            {canEdit && <div className="publish-block"><button className="publish-button" disabled={publish.isPending} onClick={() => window.confirm(t('confirmPublish')) && publish.mutate(project.draftVersion)}>{publish.isPending ? t('publishing') : t('publish')}</button><small>{t('publishHint')}</small></div>}
        </header>
        <ErrorNotice error={publish.error} />
        <LauncherPanel project={project} />
        <ServerPanel key={project.draftVersion} detail={detail.data} canEdit={canEdit} />
        <ReleasePanel key={project.id} project={project} canEdit={canEdit} />
        <ProjectSettings detail={detail.data} canEdit={canEdit} />
        <CurseForgePanel detail={detail.data} canEdit={canEdit} />
        {user.role === 'ADMIN' && <section className="card danger-zone">
            <div><h2>{t('disableProject')}</h2><p>{t('disableProjectHint')}</p></div>
            <button
                className="danger-button"
                disabled={disableProject.isPending}
                onClick={confirmDisableProject}
            >{disableProject.isPending ? t('disablingProject') : t('disableProject')}</button>
            <ErrorNotice error={disableProject.error} />
        </section>}
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
    return <><header className="page-header"><div><p className="eyebrow">{t('identityAccess')}</p><h1>{t('users')}</h1></div></header>
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
    return <><header className="page-header"><div><p className="eyebrow">{t('auditTrail')}</p><h1>{t('audit')}</h1></div><div className="header-actions"><a className="secondary button-link" href="/api/v1/audit-logs?format=csv">{t('exportCsv')}</a><a className="secondary button-link" href="/api/v1/audit-logs?format=json">{t('exportJson')}</a></div></header>
        <section className="card"><div className="filters"><label>{t('action')}<select value={action} onChange={event => setAction(event.target.value)}><option value="">—</option>{actions.map(value => <option key={value}>{value}</option>)}</select></label></div>
            <div className="audit-list">{logs.data?.items.map(log => <details className="audit-row" key={log.id}><summary><time>{new Date(log.createdAt).toLocaleString()}</time><strong>{log.action}</strong><span>{log.actorUsername ?? 'SYSTEM'}</span><span className={`result-${log.result.toLowerCase()}`}>{log.result}</span></summary><pre>{JSON.stringify({ entity: `${log.entityType}:${log.entityId}`, ip: log.ip, before: log.before, after: log.after, error: log.errorMessage }, null, 2)}</pre></details>)}</div>
        </section><ErrorNotice error={logs.error} /></>
}

export function App(): ReactNode {
    const session = useSession()
    if (session.isLoading) return <div className="splash" role="status"><div className="nebula-mark"><span /></div><strong>NEBULA</strong></div>
    if (session.error instanceof ApiError && session.error.status === 401 || !session.data) return <LoginPage />
    if (session.data.user.mustChangePassword) return <ChangePasswordPage user={session.data.user} />
    const user = session.data.user
    return <Shell user={user}><Routes>
        <Route path="/projects" element={<ProjectsPage user={user} />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/projects/:projectId" element={<ProjectPage user={user} />} />
        <Route path="/projects/:projectId/servers/new" element={<NewServerPage user={user} />} />
        <Route path="/projects/:projectId/servers/:serverId" element={<ServerRootRedirect />} />
        <Route path="/projects/:projectId/servers/:serverId/overview" element={<ServerOverviewPage />} />
        <Route path="/projects/:projectId/servers/:serverId/settings" element={<ServerSettingsPage user={user} />} />
        <Route path="/projects/:projectId/servers/:serverId/launcher" element={<ServerLauncherPage user={user} />} />
        <Route path="/projects/:projectId/servers/:serverId/files" element={<ServerFilesPage user={user} />} />
        <Route path="/users" element={user.role === 'ADMIN' ? <UsersPage /> : <Navigate to="/projects" replace />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes></Shell>
}
