import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FRAGMENT, VERTEX } from './aurora-shaders.js'
import { useMotion } from './motion.js'

// Aurora shader and OKLCH conversion adapted from React Bits, (c) 2026 David Haz.
// Pinned source and license are documented in aurora-shaders.ts and THIRD_PARTY.md.
function toOklch(hex: string): number[] {
    const [r, g, b] = [1, 3, 5].map(index => {
        const value = parseInt(hex.slice(index, index + 2), 16) / 255
        return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
    })
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
    const blue = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, Math.hypot(a, blue), Math.atan2(blue, a)]
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
    const shader = gl.createShader(type)
    if (!shader) return null
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
    gl.deleteShader(shader)
    return null
}

function AuroraCanvas(): ReactNode {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [renderer, setRenderer] = useState('fallback')
    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        let gl: WebGL2RenderingContext | null = null
        try {
            gl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false })
        } catch { return }
        if (!gl) return
        const context = gl
        const vertex = compile(context, context.VERTEX_SHADER, VERTEX)
        const fragment = compile(context, context.FRAGMENT_SHADER, FRAGMENT)
        const program = context.createProgram()
        if (!vertex || !fragment || !program) {
            if (vertex) context.deleteShader(vertex)
            if (fragment) context.deleteShader(fragment)
            if (program) context.deleteProgram(program)
            return
        }
        context.attachShader(program, vertex)
        context.attachShader(program, fragment)
        context.bindAttribLocation(program, 0, 'aPosition')
        context.linkProgram(program)
        context.deleteShader(vertex)
        context.deleteShader(fragment)
        if (!context.getProgramParameter(program, context.LINK_STATUS)) {
            context.deleteProgram(program)
            return
        }
        const buffer = context.createBuffer()
        const vao = context.createVertexArray()
        if (!buffer || !vao) {
            context.deleteProgram(program)
            if (buffer) context.deleteBuffer(buffer)
            if (vao) context.deleteVertexArray(vao)
            return
        }
        context.bindVertexArray(vao)
        context.bindBuffer(context.ARRAY_BUFFER, buffer)
        context.bufferData(context.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), context.STATIC_DRAW)
        context.enableVertexAttribArray(0)
        context.vertexAttribPointer(0, 2, context.FLOAT, false, 0, 0)
        const uniform = (name: string): WebGLUniformLocation | null => context.getUniformLocation(program, name)
        context.useProgram(program)
        const palette = new Float32Array(15)
        let previous = 0
        ;['#65e7d6', '#7b8cff', '#b46dff'].forEach((color, index) => {
            const stop = toOklch(color)
            if (index > 0) {
                while (stop[2] - previous > Math.PI) stop[2] -= Math.PI * 2
                while (stop[2] - previous < -Math.PI) stop[2] += Math.PI * 2
            }
            previous = stop[2]
            palette.set(stop, index * 3)
        })
        context.uniform3fv(uniform('uStops'), palette)
        context.uniform1i(uniform('uStopCount'), 3)
        context.uniform1i(uniform('uLayers'), 3)
        context.uniform1f(uniform('uAmplitude'), 1.2)
        context.uniform1f(uniform('uBlend'), 0.65)
        context.uniform1f(uniform('uHeight'), 0.54)
        context.uniform1f(uniform('uScale'), 1)
        context.uniform1f(uniform('uGlow'), 0.8)
        context.uniform1f(uniform('uBrightness'), 0.8)
        context.uniform1f(uniform('uFlip'), 0)
        context.uniform1f(uniform('uReveal'), 1)
        context.uniform1f(uniform('uOpacity'), 1)
        context.uniform1f(uniform('uLightMode'), 0)
        context.uniform3f(uniform('uPointer'), 0, 0, 0)
        const resolution = uniform('uResolution')
        const time = uniform('uTime')
        let raf = 0
        let elapsed = 0
        let last = 0
        let lost = false
        const draw = (): void => {
            context.viewport(0, 0, canvas.width, canvas.height)
            context.uniform2f(resolution, canvas.width, canvas.height)
            context.uniform1f(time, elapsed)
            context.drawArrays(context.TRIANGLES, 0, 3)
        }
        const frame = (now: number): void => {
            raf = 0
            if (document.hidden || lost) return
            // Cap to 30fps; decorative rendering should leave time for management tasks.
            if (!last || now - last >= 32) {
                elapsed += last ? Math.min((now - last) / 1000, 0.1) * 0.4 : 0
                last = now
                draw()
            }
            raf = requestAnimationFrame(frame)
        }
        const resize = (): void => {
            const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
            canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio))
            canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio))
            if (!document.hidden && !lost) draw()
        }
        const visibility = (): void => {
            cancelAnimationFrame(raf)
            raf = 0
            last = 0
            canvas.dataset.paused = String(document.hidden)
            if (!document.hidden && !lost) raf = requestAnimationFrame(frame)
        }
        const contextLost = (event: Event): void => {
            event.preventDefault()
            lost = true
            cancelAnimationFrame(raf)
            setRenderer('fallback')
        }
        const observer = new ResizeObserver(resize)
        observer.observe(canvas)
        document.addEventListener('visibilitychange', visibility)
        canvas.addEventListener('webglcontextlost', contextLost)
        resize()
        visibility()
        setRenderer('webgl')
        return (): void => {
            cancelAnimationFrame(raf)
            observer.disconnect()
            document.removeEventListener('visibilitychange', visibility)
            canvas.removeEventListener('webglcontextlost', contextLost)
            context.deleteBuffer(buffer)
            context.deleteVertexArray(vao)
            context.deleteProgram(program)
        }
    }, [])
    return <canvas ref={canvasRef} className="aurora-canvas" data-renderer={renderer} />
}

export function NebulaBackground(): ReactNode {
    const { enabled } = useMotion()
    const backdrop = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const visibility = (): void => {
            if (backdrop.current) backdrop.current.dataset.paused = String(document.hidden)
            document.documentElement.dataset.pageVisible = String(!document.hidden)
        }
        visibility()
        document.addEventListener('visibilitychange', visibility)
        return (): void => document.removeEventListener('visibilitychange', visibility)
    }, [])
    return <div ref={backdrop} className="nebula-backdrop" aria-hidden="true" data-mode={enabled ? 'animated' : 'static'}>
        <div className="aurora-fallback" />
        {enabled && <AuroraCanvas />}
        <div className="cosmic-stars" /><div className="cosmic-grid" />
    </div>
}
