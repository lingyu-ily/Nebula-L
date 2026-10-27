import type { ReactNode } from 'react'

const paths = {
    grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    chart: 'M4 3v17h17 M8 14l4-5 4 3 5-7',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    shield: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6',
    sparkles: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z M20 2v4 M18 4h4',
    menu: 'M4 6h16 M4 12h16 M4 18h16',
    close: 'M6 6l12 12 M18 6L6 18',
    arrow: 'M5 12h14 M13 6l6 6-6 6',
    globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c5 5 5 13 0 18 M12 3c-5 5-5 13 0 18',
    logout: 'M9 4H4v16h5 M10 12h11 M17 8l4 4-4 4',
    layers: 'M12 3l10 5-10 5L2 8z M2 12l10 5 10-5 M2 16l10 5 10-5',
    pulse: 'M2 12h5l3-8 4 16 3-8h5',
    plus: 'M12 5v14 M5 12h14'
}

export function Icon({ name, className = '' }: { name: keyof typeof paths, className?: string }): ReactNode {
    return <svg className={`ui-icon ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
