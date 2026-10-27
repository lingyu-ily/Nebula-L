import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { ApiUser } from '@nebula/shared'
import { api } from '../api.js'
import { BuildVersion } from '../BuildVersion.js'
import { Link, NavLink, usePathname } from '../router.js'
import { Icon } from './Icon.js'
import { MotionToggle, useMotion } from './motion.js'

export function ConsoleShell({ user, children }: { user: ApiUser, children: ReactNode }): ReactNode {
    const { t, i18n } = useTranslation()
    const queryClient = useQueryClient()
    const pathname = usePathname()
    const { enabled } = useMotion()
    const [menuOpen, setMenuOpen] = useState(false)
    const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 900px)').matches)
    const sidebar = useRef<HTMLElement>(null)
    const menuButton = useRef<HTMLButtonElement>(null)
    const page = useRef<HTMLDivElement>(null)
    const logout = useMutation({
        mutationFn: () => api('/api/v1/auth/logout', { method: 'POST' }),
        onSuccess: () => {
            queryClient.clear()
            window.location.replace('/')
        }
    })
    useEffect(() => {
        const query = window.matchMedia('(max-width: 900px)')
        const change = (): void => { setNarrow(query.matches); setMenuOpen(false) }
        query.addEventListener('change', change)
        return (): void => query.removeEventListener('change', change)
    }, [])
    useEffect(() => { setMenuOpen(false) }, [pathname])
    useEffect(() => {
        // Animate the existing page node; never remount forms or Explorer for decoration.
        if (enabled) {
            const animation = page.current?.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 350, easing: 'cubic-bezier(.2,.7,.2,1)' })
            return (): void => animation?.cancel()
        }
    }, [pathname, enabled])
    useEffect(() => {
        if (!menuOpen || !narrow) return
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        // Wait for the browser to apply the drawer's visibility and remove inert.
        const focusFrame = requestAnimationFrame(() => sidebar.current?.querySelector<HTMLElement>('a')?.focus())
        const keyboard = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false) }
            if (event.key !== 'Tab') return
            const controls = sidebar.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)')
            if (!controls?.length) return
            const first = controls[0]
            const last = controls[controls.length - 1]
            if (!sidebar.current?.contains(document.activeElement)) {
                event.preventDefault()
                if (event.shiftKey) last.focus()
                else first.focus()
                return
            }
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
            if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
        }
        document.addEventListener('keydown', keyboard)
        return (): void => {
            cancelAnimationFrame(focusFrame)
            document.body.style.overflow = previousOverflow
            document.removeEventListener('keydown', keyboard)
            menuButton.current?.focus()
        }
    }, [menuOpen, narrow])
    const section = pathname.startsWith('/analytics') ? t('analytics') : pathname.startsWith('/users') ? t('users') : pathname.startsWith('/audit') ? t('audit') : t('projects')
    return <div className="app-shell" data-menu-open={menuOpen}>
        <a className="skip-link" href="#console-main" inert={narrow && menuOpen}>{t('skipContent')}</a>
        <header className="mobile-bar" inert={narrow && menuOpen}>
            <span className="brand"><span className="brand-symbol" aria-hidden="true">N</span>NEBULA<span className="console-word">CONSOLE</span></span>
            <button ref={menuButton} type="button" className="icon-button" aria-label={t('openNavigation')} aria-expanded={menuOpen} aria-controls="console-sidebar" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button>
        </header>
        {narrow && menuOpen && <button type="button" className="menu-backdrop" tabIndex={-1} aria-label={t('closeNavigation')} onClick={() => setMenuOpen(false)} />}
        <aside ref={sidebar} id="console-sidebar" className="sidebar" inert={narrow && !menuOpen} role={narrow ? 'dialog' : undefined} aria-modal={narrow && menuOpen ? true : undefined} aria-label={t('navigation')}>
            <div className="sidebar-brand-row"><Link to="/projects" className="brand" onClick={() => setMenuOpen(false)}><span className="brand-symbol" aria-hidden="true">N</span><span>NEBULA<small>CONSOLE</small></span></Link>
                <button type="button" className="icon-button menu-close" aria-label={t('closeNavigation')} onClick={() => setMenuOpen(false)}><Icon name="close" /></button>
            </div>
            <p className="nav-caption">{t('workspace')}</p>
            <nav aria-label={t('navigation')} onClick={event => {
                if (event.target instanceof Element && event.target.closest('a')) setMenuOpen(false)
            }}>
                <NavLink to="/projects"><Icon name="grid" /><span>{t('projects')}</span><span className="nav-indicator" /></NavLink>
                <NavLink to="/analytics"><Icon name="chart" /><span>{t('analytics')}</span><span className="nav-indicator" /></NavLink>
                {user.role === 'ADMIN' && <NavLink to="/users"><Icon name="users" /><span>{t('users')}</span><span className="nav-indicator" /></NavLink>}
                <NavLink to="/audit"><Icon name="shield" /><span>{t('audit')}</span><span className="nav-indicator" /></NavLink>
            </nav>
            <div className="sidebar-note"><Icon name="layers" /><span>{t('consoleHint')}</span><span className="sidebar-orbit" aria-hidden="true" /></div>
            <div className="account">
                <div className="account-identity"><span className="account-avatar" aria-hidden="true">{user.username.slice(0, 1).toUpperCase()}</span><div><strong>{user.username}</strong><span className={`role role-${user.role.toLowerCase()}`}>{user.role}</span></div></div>
                <MotionToggle />
                <div className="account-actions"><button className="text-button" onClick={() => void i18n.changeLanguage(i18n.resolvedLanguage === 'en' ? 'zh-TW' : 'en')}><Icon name="globe" />{t('language')}</button>
                    <button className="text-button" disabled={logout.isPending} onClick={() => logout.mutate()}><Icon name="logout" />{t('logout')}</button></div>
                <BuildVersion />
            </div>
        </aside>
        <main id="console-main" className="content" tabIndex={-1} inert={narrow && menuOpen}>
            <div className="workspace-topbar"><span><span className="topbar-dot" />{t('workspace')}<span className="topbar-divider">/</span>{section}</span><span className="workspace-tag">HELIOS / NEBULA</span></div>
            <div className="page-content" ref={page}>{children}</div>
        </main>
    </div>
}
