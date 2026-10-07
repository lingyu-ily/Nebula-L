import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), work: vi.fn() }))
vi.mock('./db/index.js', (): Record<string, unknown> => ({ getPool: (): unknown => ({
    getConnection: async (): Promise<unknown> => ({ query: mocks.query, release: mocks.release })
}) }))

import { ProjectStorageBusyError, withProjectStorageLock } from './project-storage-lock.js'

beforeEach(() => {
    vi.clearAllMocks()
    mocks.query.mockResolvedValue([[{ acquired: 1 }]])
    mocks.work.mockResolvedValue('result')
})

describe('project storage serialization', () => {
    it('owns a dedicated connection until the work finishes', async () => {
        expect(await withProjectStorageLock('project', mocks.work)).toBe('result')
        expect(mocks.query.mock.calls[0]?.[0]).toContain('GET_LOCK')
        expect(mocks.query.mock.calls[1]?.[0]).toContain('RELEASE_LOCK')
        expect(mocks.query.mock.calls[0]?.[1]).toEqual(mocks.query.mock.calls[1]?.[1])
        expect(mocks.release.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.work.mock.invocationCallOrder[0])
    })

    it('skips storage work when another publisher or cleaner owns the lock', async () => {
        mocks.query.mockResolvedValue([[{ acquired: 0 }]])
        await expect(withProjectStorageLock('project', mocks.work)).rejects.toBeInstanceOf(ProjectStorageBusyError)
        expect(mocks.work).not.toHaveBeenCalled()
        expect(mocks.query).toHaveBeenCalledTimes(1)
        expect(mocks.release).toHaveBeenCalledTimes(1)
    })

    it('releases the lock and connection after a storage failure', async () => {
        mocks.work.mockRejectedValue(new Error('S3 unavailable'))
        await expect(withProjectStorageLock('project', mocks.work)).rejects.toThrow('S3 unavailable')
        expect(mocks.query.mock.calls[1]?.[0]).toContain('RELEASE_LOCK')
        expect(mocks.release).toHaveBeenCalledTimes(1)
    })
})
