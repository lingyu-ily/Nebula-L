import {
    Children,
    createContext,
    isValidElement,
    useContext,
    useEffect,
    useMemo,
    useState,
    type AnchorHTMLAttributes,
    type MouseEvent,
    type ReactNode
} from 'react'

interface RouterValue {
    pathname: string
    navigate: (to: string, options?: { replace?: boolean }) => void
}

interface RouteProps {
    path: string
    element: ReactNode
}

const RouterContext = createContext<RouterValue | null>(null)
const ParamsContext = createContext<Record<string, string>>({})

export function BrowserRouter({ children }: { children: ReactNode }): ReactNode {
    const [pathname, setPathname] = useState(window.location.pathname)
    useEffect((): (() => void) => {
        const handler = (): void => setPathname(window.location.pathname)
        window.addEventListener('popstate', handler)
        return (): void => window.removeEventListener('popstate', handler)
    }, [])
    const value = useMemo<RouterValue>(() => ({
        pathname,
        navigate: (to, options): void => {
            if (options?.replace) {
                window.history.replaceState(null, '', to)
            } else {
                window.history.pushState(null, '', to)
            }
            setPathname(window.location.pathname)
        }
    }), [pathname])
    return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function useNavigate(): RouterValue['navigate'] {
    const router = useContext(RouterContext)
    if (!router) throw new Error('Router is not available')
    return router.navigate
}

export function useParams<T extends Record<string, string | undefined> = Record<string, string>>(): T {
    return useContext(ParamsContext) as T
}

export function Link({ to, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }): ReactNode {
    const navigate = useNavigate()
    const click = (event: MouseEvent<HTMLAnchorElement>): void => {
        onClick?.(event)
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        navigate(to)
    }
    return <a {...props} href={to} onClick={click} />
}

export function NavLink(props: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }): ReactNode {
    const router = useContext(RouterContext)
    const active = router?.pathname === props.to || router?.pathname.startsWith(`${props.to}/`)
    const className = [props.className, active ? 'active' : ''].filter(Boolean).join(' ')
    return <Link {...props} className={className} />
}

export function Navigate({ to, replace = false }: { to: string, replace?: boolean }): ReactNode {
    const navigate = useNavigate()
    useEffect(() => navigate(to, { replace }), [navigate, replace, to])
    return null
}

export function Route(props: RouteProps): ReactNode {
    void props
    return null
}

function matchRoute(pattern: string, pathname: string): Record<string, string> | null {
    if (pattern === '*') return {}
    const patternParts = pattern.split('/').filter(Boolean)
    const pathParts = pathname.split('/').filter(Boolean)
    if (patternParts.length !== pathParts.length) return null
    const params: Record<string, string> = {}
    for (let index = 0; index < patternParts.length; index++) {
        const patternPart = patternParts[index]
        const pathPart = pathParts[index]
        if (patternPart.startsWith(':')) {
            params[patternPart.slice(1)] = decodeURIComponent(pathPart)
        } else if (patternPart !== pathPart) {
            return null
        }
    }
    return params
}

export function Routes({ children }: { children: ReactNode }): ReactNode {
    const router = useContext(RouterContext)
    if (!router) throw new Error('Router is not available')
    for (const child of Children.toArray(children)) {
        if (!isValidElement<RouteProps>(child)) continue
        const params = matchRoute(child.props.path, router.pathname)
        if (params != null) {
            return <ParamsContext.Provider value={params}>{child.props.element}</ParamsContext.Provider>
        }
    }
    return null
}
