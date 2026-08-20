import { describe, expect, it } from 'vitest'
import {
    detectLauncherVideoHeader,
    isPublicLauncherVideoAddress,
    LauncherVideoValidationError,
    normalizeYouTubeVideoId,
    validateExternalVideoUrl
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

    it('requires credential-free standard-port HTTPS external URLs', () => {
        expect(validateExternalVideoUrl('https://cdn.example.com/video.mp4').hostname).toBe('cdn.example.com')
        expect(() => validateExternalVideoUrl('http://cdn.example.com/video.mp4')).toThrow(/HTTPS/)
        expect(() => validateExternalVideoUrl('https://user:pass@cdn.example.com/video.mp4')).toThrow(/credentials/)
        expect(() => validateExternalVideoUrl('https://cdn.example.com:8443/video.mp4')).toThrow(/standard HTTPS port/)
    })

    it.each([
        '127.0.0.1',
        '10.0.0.2',
        '169.254.169.254',
        '192.0.2.1',
        '192.168.1.5',
        '198.51.100.1',
        '203.0.113.1',
        '::1',
        'fc00::1',
        'fe80::1'
    ])(
        'blocks non-public address %s', address => {
            expect(isPublicLauncherVideoAddress(address)).toBe(false)
        })

    it.each(['1.1.1.1', '8.8.8.8', '192.2.0.1', '198.51.1.1', '203.1.0.1', '2606:4700:4700::1111'])(
        'allows public address %s', address => {
            expect(isPublicLauncherVideoAddress(address)).toBe(true)
        })

    it('detects MP4 and WebM file signatures', () => {
        const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.alloc(4)])
        const webm = Buffer.from([0x1A, 0x45, 0xDF, 0xA3])
        expect(detectLauncherVideoHeader(mp4)).toBe('video/mp4')
        expect(detectLauncherVideoHeader(webm)).toBe('video/webm')
        expect(() => detectLauncherVideoHeader(Buffer.from('not-video'))).toThrow(/valid MP4 or WebM/)
    })
})
