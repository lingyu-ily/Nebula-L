export interface PageResult<T> {
    items: T[]
    limit: number
    offset: number
    hasMore: boolean
}

export function createPage<T>(rows: T[], limit: number, offset: number): PageResult<T> {
    return {
        items: rows.slice(0, limit),
        limit,
        offset,
        hasMore: rows.length > limit
    }
}
