import { lookup } from 'dns/promises'
import { open, rm } from 'fs/promises'
import { get } from 'https'
import { isIP } from 'net'
import type { LookupAddress } from 'dns'
import type { IncomingMessage } from 'http'
import { stageUpload, type StagedUpload } from './storage.js'

export const LAUNCHER_VIDEO_TYPES = new Set(['video/mp4', 'video/webm'])

export class LauncherVideoValidationError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'LauncherVideoValidationError'
    }
}

export function normalizeYouTubeVideoId(value: string): string {
    let url: URL
    try {
        url = new URL(value)
    } catch {
        throw new LauncherVideoValidationError('A valid YouTube URL is required')
    }
    if (url.protocol !== 'https:') {
        throw new LauncherVideoValidationError('YouTube URLs must use HTTPS')
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    let id: string | null = null
    if (host === 'youtu.be') {
        id = url.pathname.split('/').find(Boolean) ?? null
    } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
        const segments = url.pathname.split('/').filter(Boolean)
        if (url.pathname === '/watch') {
            id = url.searchParams.get('v')
        } else if (['shorts', 'embed'].includes(segments[0] ?? '')) {
            id = segments[1] ?? null
        }
    }
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) {
        throw new LauncherVideoValidationError('A single YouTube video URL is required')
    }
    return id
}

export function validateExternalVideoUrl(value: string): URL {
    let url: URL
    try {
        url = new URL(value)
    } catch {
        throw new LauncherVideoValidationError('A valid external video URL is required')
    }
    if (url.protocol !== 'https:') {
        throw new LauncherVideoValidationError('External videos must use HTTPS')
    }
    if (url.username || url.password) {
        throw new LauncherVideoValidationError('External video URLs cannot contain credentials')
    }
    if (url.port && url.port !== '443') {
        throw new LauncherVideoValidationError('External video URLs must use the standard HTTPS port')
    }
    return url
}

function isPublicIpv4(address: string): boolean {
    const parts = address.split('.').map(Number)
    if (parts.length !== 4 || parts.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
        return false
    }
    const [a, b, c] = parts
    return !(a === 0
        || a === 10
        || a === 127
        || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 0 && (c === 0 || c === 2))
        || (a === 192 && b === 88 && c === 99)
        || (a === 192 && b === 168)
        || (a === 198 && (b === 18 || b === 19))
        || (a === 198 && b === 51 && c === 100)
        || (a === 203 && b === 0 && c === 113)
        || a >= 224)
}

export function isPublicLauncherVideoAddress(address: string): boolean {
    const family = isIP(address)
    if (family === 4) {
        return isPublicIpv4(address)
    }
    if (family !== 6) {
        return false
    }
    const normalized = address.toLowerCase()
    if (normalized.startsWith('::ffff:')) {
        return isPublicIpv4(normalized.slice(7))
    }
    return normalized !== '::'
        && normalized !== '::1'
        && !normalized.startsWith('fc')
        && !normalized.startsWith('fd')
        && !/^fe[89ab]/.test(normalized)
        && !normalized.startsWith('ff')
        && !normalized.startsWith('2001:db8')
}

async function resolvePublicHost(hostname: string): Promise<LookupAddress> {
    const addresses = await lookup(hostname, { all: true, verbatim: true })
    if (addresses.length === 0 || addresses.some(value => !isPublicLauncherVideoAddress(value.address))) {
        throw new LauncherVideoValidationError('External video host resolves to a non-public address')
    }
    return addresses[0]
}

async function requestVideo(url: URL, redirectsLeft = 5): Promise<{ response: IncomingMessage, finalUrl: URL }> {
    const resolved = await resolvePublicHost(url.hostname)
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
        const request = get(url, {
            headers: {
                Accept: 'video/mp4,video/webm',
                'User-Agent': 'Nebula-L/0.1 launcher-video-publisher'
            },
            lookup: (_hostname, _options, callback) => callback(null, resolved.address, resolved.family)
        }, resolve)
        request.once('error', reject)
        request.setTimeout(30_000, () => request.destroy(new Error('External video request timed out')))
    })
    const status = response.statusCode ?? 0
    if (status >= 300 && status < 400 && response.headers.location) {
        response.resume()
        if (redirectsLeft <= 0) {
            throw new LauncherVideoValidationError('External video redirected too many times')
        }
        const redirectUrl = validateExternalVideoUrl(new URL(response.headers.location, url).toString())
        return requestVideo(redirectUrl, redirectsLeft - 1)
    }
    if (status < 200 || status >= 300) {
        response.resume()
        if (status >= 400 && status < 500) {
            throw new LauncherVideoValidationError(`External video returned HTTP ${status}`)
        }
        throw new Error(`External video returned HTTP ${status}`)
    }
    return { response, finalUrl: url }
}

export function detectLauncherVideoHeader(buffer: Buffer): 'video/mp4' | 'video/webm' {
    if (buffer.length >= 8 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
        return 'video/mp4'
    }
    if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1A, 0x45, 0xDF, 0xA3]))) {
        return 'video/webm'
    }
    throw new LauncherVideoValidationError('File is not a valid MP4 or WebM video')
}

async function detectVideoType(path: string): Promise<'video/mp4' | 'video/webm'> {
    const handle = await open(path, 'r')
    try {
        const buffer = Buffer.alloc(12)
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        return detectLauncherVideoHeader(buffer.subarray(0, bytesRead))
    } finally {
        await handle.close()
    }
}

export interface StagedLauncherVideo extends StagedUpload {
    contentType: 'video/mp4' | 'video/webm'
    extension: '.mp4' | '.webm'
    finalUrl: string
}

export async function downloadExternalVideo(value: string, maxBytes: number): Promise<StagedLauncherVideo> {
    const initialUrl = validateExternalVideoUrl(value)
    const { response, finalUrl } = await requestVideo(initialUrl)
    const declaredLength = Number(response.headers['content-length'])
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        response.destroy()
        throw new LauncherVideoValidationError(`External video exceeds ${maxBytes} bytes`)
    }
    const declaredType = String(response.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase()
    if (!LAUNCHER_VIDEO_TYPES.has(declaredType)) {
        response.destroy()
        throw new LauncherVideoValidationError('External video must be served as video/mp4 or video/webm')
    }
    let staged: StagedUpload
    try {
        staged = await stageUpload(response, maxBytes)
    } catch (error) {
        if (error instanceof Error && error.message.includes('exceeds')) {
            throw new LauncherVideoValidationError(`External video exceeds ${maxBytes} bytes`)
        }
        throw error
    }
    try {
        const detectedType = await detectVideoType(staged.path)
        if (detectedType !== declaredType) {
            throw new LauncherVideoValidationError('External video Content-Type does not match its file format')
        }
        return {
            ...staged,
            contentType: detectedType,
            extension: detectedType === 'video/mp4' ? '.mp4' : '.webm',
            finalUrl: finalUrl.toString()
        }
    } catch (error) {
        await rm(staged.directory, { recursive: true, force: true })
        throw error
    }
}
