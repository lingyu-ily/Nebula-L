import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
    const execute = vi.fn()
    const connectionExecute = vi.fn()
    return {
        execute,
        connectionExecute,
        queryOne: vi.fn(),
        withTransaction: vi.fn(async (work: (connection: { execute: typeof connectionExecute }) => Promise<unknown>) =>
            work({ execute: connectionExecute }))
    }
})

vi.mock('./db/index.js', () => ({
    getPool: (): { execute: typeof mocks.execute } => ({ execute: mocks.execute }),
    queryOne: mocks.queryOne,
    withTransaction: mocks.withTransaction
}))

import {
    buildUsageDateRange,
    getLauncherUsage,
    getLauncherUsageDate,
    recordLauncherPresence,
    rollupLauncherUsage
} from './launcher-usage.js'

describe('anonymous Launcher usage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.execute.mockResolvedValue([[]])
        mocks.connectionExecute.mockResolvedValue([{}])
    })

    it('uses Taipei midnight and returns exactly 30 reporting dates', () => {
        expect(getLauncherUsageDate(new Date('2026-08-24T15:59:59.999Z'))).toBe('2026-08-24')
        expect(getLauncherUsageDate(new Date('2026-08-24T16:00:00.000Z'))).toBe('2026-08-25')
        const dates = buildUsageDateRange('2026-08-25')
        expect(dates).toHaveLength(30)
        expect(dates[0]).toBe('2026-07-27')
        expect(dates.at(-1)).toBe('2026-08-25')
    })

    it('stores only a project-and-day-scoped hash of the random token', async () => {
        mocks.queryOne.mockResolvedValue({ id: 'project-1', name: 'MapleCraft', slug: 'maplecraft' })
        const token = 'A'.repeat(43)
        await recordLauncherPresence('maplecraft', token, new Date('2026-08-25T00:00:00.000Z'))
        const values = mocks.execute.mock.calls[0]?.[1] as string[]
        expect(values[0]).toBe('project-1')
        expect(values[1]).toBe('2026-08-25')
        expect(values[2]).toMatch(/^[a-f0-9]{64}$/)
        expect(values).not.toContain(token)
    })

    it('rolls completed days into aggregates and enforces 30-day retention', async () => {
        await rollupLauncherUsage(new Date('2026-08-25T00:00:00.000Z'))
        expect(mocks.connectionExecute).toHaveBeenCalledTimes(3)
        expect(mocks.connectionExecute.mock.calls[0]?.[1]).toEqual(['2026-08-25'])
        expect(mocks.connectionExecute.mock.calls[1]?.[1]).toEqual(['2026-08-25'])
        expect(mocks.connectionExecute.mock.calls[2]?.[1]).toEqual(['2026-07-27'])
    })

    it('fills missing history with zero and includes the current live count', async () => {
        mocks.queryOne
            .mockResolvedValueOnce({ id: 'project-1', name: 'MapleCraft', slug: 'maplecraft' })
            .mockResolvedValueOnce({ active_launchers: 4 })
        mocks.execute.mockResolvedValueOnce([[{ usage_date: '2026-08-23', active_launchers: 2 }]])

        const response = await getLauncherUsage('project-1', new Date('2026-08-25T00:00:00.000Z'))
        expect(response?.series).toHaveLength(30)
        expect(response?.series.find(day => day.date === '2026-08-23')?.activeLaunchers).toBe(2)
        expect(response?.series.find(day => day.date === '2026-08-24')?.activeLaunchers).toBe(0)
        expect(response?.series.at(-1)).toEqual({ date: '2026-08-25', activeLaunchers: 4 })
    })
})
