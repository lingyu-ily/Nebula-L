import { describe, expect, it } from 'vitest'
import { RETAINED_RELEASE_COUNT, selectReleasesForDeletion } from './release-retention.js'

describe('release retention', () => {
    it('retains five releases in total and always protects the active release', () => {
        const releases = [
            { id: 'available-1' },
            { id: 'available-2' },
            { id: 'active' },
            { id: 'available-3' },
            { id: 'available-4' },
            { id: 'available-5' },
            { id: 'available-6' }
        ]

        expect(RETAINED_RELEASE_COUNT).toBe(5)
        expect(selectReleasesForDeletion(releases, 'active').map(release => release.id)).toEqual([
            'available-5',
            'available-6'
        ])
    })
})
