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

export function detectLauncherVideoHeader(buffer: Buffer): 'video/mp4' | 'video/webm' {
    if (buffer.length >= 8 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
        return 'video/mp4'
    }
    if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1A, 0x45, 0xDF, 0xA3]))) {
        return 'video/webm'
    }
    throw new LauncherVideoValidationError('File is not a valid MP4 or WebM video')
}
