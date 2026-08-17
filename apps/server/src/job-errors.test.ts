import { describe, expect, it } from 'vitest'
import { PermanentJobError, shouldRetryJob } from './job-errors.js'

describe('job retry policy', () => {
    it('does not retry permanent publish input errors', () => {
        expect(shouldRetryJob(new PermanentJobError('missing upload'), 1, 3)).toBe(false)
    })

    it('retries transient errors until max attempts', () => {
        expect(shouldRetryJob(new Error('RustFS 503'), 1, 3)).toBe(true)
        expect(shouldRetryJob(new Error('RustFS 503'), 3, 3)).toBe(false)
    })
})
