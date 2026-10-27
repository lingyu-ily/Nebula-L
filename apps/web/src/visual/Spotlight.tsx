import { useRef, type HTMLAttributes, type ReactNode } from 'react'
import { useMotion } from './motion.js'

// Pointer-lit surface inspired by https://reactbits.dev/components/spotlight-card.
// Local CSS implementation preserves the child link/section semantics.
export function Spotlight({ children, className = '', ...props }: HTMLAttributes<HTMLDivElement>): ReactNode {
    const { enabled } = useMotion()
    const surface = useRef<HTMLDivElement>(null)
    return <div {...props} ref={surface} className={`spotlight ${className}`} onPointerMove={event => {
        if (!enabled || event.pointerType === 'touch') return
        const element = surface.current
        if (!element) return
        const rect = element.getBoundingClientRect()
        element.style.setProperty('--spot-x', `${event.clientX - rect.left}px`)
        element.style.setProperty('--spot-y', `${event.clientY - rect.top}px`)
    }}>{children}</div>
}
