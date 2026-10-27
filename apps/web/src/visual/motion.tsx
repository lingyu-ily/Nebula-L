import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from './Icon.js'

const STORAGE_KEY = 'nebula.motion'
interface MotionValue { enabled: boolean, reduced: boolean, toggle: () => void }
const MotionContext = createContext<MotionValue | null>(null)

export function MotionProvider({ children }: { children: ReactNode }): ReactNode {
    const [preferred, setPreferred] = useState(() => {
        try { return localStorage.getItem(STORAGE_KEY) !== 'off' } catch { return true }
    })
    const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    useEffect(() => {
        const query = window.matchMedia('(prefers-reduced-motion: reduce)')
        const change = (): void => setReduced(query.matches)
        const sync = (event: StorageEvent): void => {
            if (event.key === STORAGE_KEY || event.key === null) setPreferred(event.newValue !== 'off')
        }
        query.addEventListener('change', change)
        window.addEventListener('storage', sync)
        return (): void => {
            query.removeEventListener('change', change)
            window.removeEventListener('storage', sync)
        }
    }, [])
    const enabled = preferred && !reduced
    useEffect(() => {
        document.documentElement.dataset.motion = enabled ? 'on' : 'off'
    }, [enabled])
    const toggle = (): void => {
        try { localStorage.setItem(STORAGE_KEY, preferred ? 'off' : 'on') } catch { /* In-memory preference still works. */ }
        setPreferred(!preferred)
    }
    return <MotionContext.Provider value={{ enabled, reduced, toggle }}>{children}</MotionContext.Provider>
}

export function useMotion(): MotionValue {
    const motion = useContext(MotionContext)
    if (!motion) throw new Error('MotionProvider is not available')
    return motion
}

export function MotionToggle(): ReactNode {
    const { t } = useTranslation()
    const { enabled, reduced, toggle } = useMotion()
    return <button type="button" className="motion-toggle" aria-label={t('motionEffects')} aria-description={reduced ? t('motionSystem') : undefined} aria-pressed={enabled} disabled={reduced} onClick={toggle} title={reduced ? t('motionSystem') : t('motionEffects')}>
        <Icon name="sparkles" /><span>{t('motionEffects')}</span><span className="toggle-track" aria-hidden="true"><span /></span>
    </button>
}
