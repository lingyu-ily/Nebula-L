import { describe, expect, it } from 'vitest'
import {
    detectLauncherVideoHeader,
    LauncherVideoValidationError,
    normalizeYouTubeVideoId
} from './launcher-video.js'

describe('launcher video sources', () => {
    it.each([
        ['https://www.youtube.com/watch?v=abcdefghijk', 'abcdefghijk'],
        ['https://youtu.be/abcdefghijk', 'abcdefghijk'],
        ['https://www.youtube.com/shorts/abcdefghijk', 'abcdefghijk'],
        ['https://www.youtube.com/embed/abcdefghijk', 'abcdefghijk']
    ])('normalizes a single YouTube URL', (url, expected) => {
        expect(normalizeYouTubeVideoId(url)).toBe(expected)
    })

    it('rejects playlists and non-YouTube hosts', () => {
        expect(() => normalizeYouTubeVideoId('https://www.youtube.com/playlist?list=test'))
            .toThrow(LauncherVideoValidationError)
        expect(() => normalizeYouTubeVideoId('https://example.com/watch?v=abcdefghijk'))
            .toThrow(LauncherVideoValidationError)
    })

    it('detects MP4 and WebM file signatures', () => {
        const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.alloc(4)])
        const webm = Buffer.from([0x1A, 0x45, 0xDF, 0xA3])
        expect(detectLauncherVideoHeader(mp4)).toBe('video/mp4')
        expect(detectLauncherVideoHeader(webm)).toBe('video/webm')
        expect(() => detectLauncherVideoHeader(Buffer.from('not-video'))).toThrow(/valid MP4 or WebM/)
    })
})
