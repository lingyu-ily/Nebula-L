import { describe, expect, it } from 'vitest'
import { isCompleteServerOrder } from './server-order.js'

describe('server ordering', () => {
    const first = '9fb8ad8a-4d47-4dd8-85f7-07059f4ef4c8'
    const second = '0d4b42c8-45ec-4bbc-9ca1-80901de7b38d'
    const external = '15560bba-d040-4a1f-a3b3-11ca28e3ef15'

    it('accepts the complete server set in a different order', () => {
        expect(isCompleteServerOrder([first, second], [second, first])).toBe(true)
    })

    it('rejects missing or external server IDs', () => {
        expect(isCompleteServerOrder([first, second], [first])).toBe(false)
        expect(isCompleteServerOrder([first, second], [first, external])).toBe(false)
        expect(isCompleteServerOrder([first, second], [first, first])).toBe(false)
    })
})
