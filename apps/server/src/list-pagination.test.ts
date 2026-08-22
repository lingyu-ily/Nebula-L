import { describe, expect, it } from 'vitest'
import { createPage } from './list-pagination.js'

describe('list pagination', () => {
    it('uses one extra row to report another page', () => {
        expect(createPage([1, 2, 3, 4, 5, 6], 5, 10)).toEqual({
            items: [1, 2, 3, 4, 5],
            limit: 5,
            offset: 10,
            hasMore: true
        })
    })

    it('reports the last page without padding its items', () => {
        expect(createPage([6], 5, 5)).toEqual({
            items: [6],
            limit: 5,
            offset: 5,
            hasMore: false
        })
    })
})
