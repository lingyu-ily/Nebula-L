import { describe, expect, it } from 'vitest'
import { storedObjectMetadataMatches } from './storage.js'

describe('release object layout', () => {
    it('keeps stable and immutable paths separate', () => {
        const slug = 'production-pack'
        const release = '0b61e959-5299-429b-bfcb-9b213f9c89fb'
        expect(`public/${slug}/releases/${release}/distribution.json`)
            .not.toBe(`public/${slug}/distribution.json`)
    })
})

describe('stored object verification', () => {
    const expected = {
        size: 128,
        sha256: 'a'.repeat(64),
        cacheControl: 'no-cache, must-revalidate',
        releaseId: 'release-1'
    }

    it('accepts matching stable distribution metadata', () => {
        expect(storedObjectMetadataMatches({
            contentLength: 128,
            sha256: 'a'.repeat(64),
            cacheControl: 'no-cache, must-revalidate',
            releaseId: 'release-1'
        }, expected)).toBe(true)
    })

    it.each([
        { contentLength: 127, sha256: 'a'.repeat(64), cacheControl: 'no-cache, must-revalidate', releaseId: 'release-1' },
        { contentLength: 128, sha256: 'b'.repeat(64), cacheControl: 'no-cache, must-revalidate', releaseId: 'release-1' },
        { contentLength: 128, sha256: 'a'.repeat(64), cacheControl: 'public, max-age=31536000, immutable', releaseId: 'release-1' },
        { contentLength: 128, sha256: 'a'.repeat(64), cacheControl: 'no-cache, must-revalidate', releaseId: 'release-2' }
    ])('rejects mismatched stable distribution metadata', actual => {
        expect(storedObjectMetadataMatches(actual, expected)).toBe(false)
    })
})
