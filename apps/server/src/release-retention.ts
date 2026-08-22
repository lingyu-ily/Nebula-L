export const RETAINED_RELEASE_COUNT = 5

export function selectReleasesForDeletion<T extends { id: string }>(
    releases: T[],
    activeReleaseId: string
): T[] {
    let retainedAvailable = 0
    return releases.filter(release => {
        if (release.id === activeReleaseId) {
            return false
        }
        if (retainedAvailable < RETAINED_RELEASE_COUNT - 1) {
            retainedAvailable += 1
            return false
        }
        return true
    })
}
