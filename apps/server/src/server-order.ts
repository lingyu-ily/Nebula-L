export function isCompleteServerOrder(existingIds: string[], requestedIds: string[]): boolean {
    if (existingIds.length !== requestedIds.length) {
        return false
    }
    if (new Set(requestedIds).size !== requestedIds.length) {
        return false
    }
    const existing = new Set(existingIds)
    return requestedIds.every(id => existing.has(id))
}
