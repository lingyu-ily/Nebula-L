import { describe, expect, it } from 'vitest'

describe('release object layout', () => {
    it('keeps stable and immutable paths separate', () => {
        const slug = 'production-pack'
        const release = '0b61e959-5299-429b-bfcb-9b213f9c89fb'
        expect(`public/${slug}/releases/${release}/distribution.json`)
            .not.toBe(`public/${slug}/distribution.json`)
    })
})
