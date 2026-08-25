import { createHash } from 'crypto'
import type { LauncherUsageResponse } from '@nebula/shared'
import type { RowDataPacket } from 'mysql2'
import { getPool, queryOne, withTransaction } from './db/index.js'

export const LAUNCHER_USAGE_TIME_ZONE = 'Asia/Taipei' as const
export const LAUNCHER_USAGE_DAYS = 30
export const LAUNCHER_USAGE_ROLLUP_MS = 60 * 60 * 1000

interface ProjectRow extends RowDataPacket {
    id: string
    name: string
    slug: string
}

interface UsageRow extends RowDataPacket {
    usage_date: string
    active_launchers: number
}

function datePartsInTaipei(now: Date): { year: string, month: string, day: string } {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: LAUNCHER_USAGE_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(now)
    const value = (type: Intl.DateTimeFormatPartTypes): string =>
        parts.find(part => part.type === type)?.value ?? ''
    return { year: value('year'), month: value('month'), day: value('day') }
}

export function getLauncherUsageDate(now = new Date()): string {
    const { year, month, day } = datePartsInTaipei(now)
    return `${year}-${month}-${day}`
}

export function addUsageDays(date: string, days: number): string {
    const instant = new Date(`${date}T00:00:00.000Z`)
    instant.setUTCDate(instant.getUTCDate() + days)
    return instant.toISOString().slice(0, 10)
}

export function buildUsageDateRange(today: string): string[] {
    return Array.from({ length: LAUNCHER_USAGE_DAYS }, (_, index) =>
        addUsageDays(today, index - (LAUNCHER_USAGE_DAYS - 1)))
}

function hashDailyToken(projectId: string, usageDate: string, dailyToken: string): string {
    return createHash('sha256')
        .update(projectId)
        .update('\0')
        .update(usageDate)
        .update('\0')
        .update(dailyToken)
        .digest('hex')
}

export async function recordLauncherPresence(
    projectSlug: string,
    dailyToken: string,
    now = new Date()
): Promise<void> {
    const project = await queryOne<ProjectRow>(
        'SELECT id, name, slug FROM projects WHERE slug = ? AND active_release_id IS NOT NULL',
        [projectSlug]
    )
    if (!project) return
    const usageDate = getLauncherUsageDate(now)
    await getPool().execute(
        `INSERT IGNORE INTO launcher_daily_presence (project_id, usage_date, token_hash, first_seen_at)
         VALUES (?, ?, ?, UTC_TIMESTAMP(3))`,
        [project.id, usageDate, hashDailyToken(project.id, usageDate, dailyToken)]
    )
}

export async function rollupLauncherUsage(now = new Date()): Promise<void> {
    const today = getLauncherUsageDate(now)
    const oldestRetainedDate = addUsageDays(today, -(LAUNCHER_USAGE_DAYS - 1))
    await withTransaction(async connection => {
        await connection.execute(
            `INSERT INTO launcher_daily_usage (project_id, usage_date, active_launchers, finalized_at)
             SELECT project_id, usage_date, COUNT(*), UTC_TIMESTAMP(3)
             FROM launcher_daily_presence
             WHERE usage_date < ?
             GROUP BY project_id, usage_date
             ON DUPLICATE KEY UPDATE active_launchers = VALUES(active_launchers), finalized_at = VALUES(finalized_at)`,
            [today]
        )
        await connection.execute('DELETE FROM launcher_daily_presence WHERE usage_date < ?', [today])
        await connection.execute('DELETE FROM launcher_daily_usage WHERE usage_date < ?', [oldestRetainedDate])
    })
}

export async function getLauncherUsage(
    projectId: string,
    now = new Date()
): Promise<LauncherUsageResponse | undefined> {
    await rollupLauncherUsage(now)
    const project = await queryOne<ProjectRow>(
        'SELECT id, name, slug FROM projects WHERE id = ? AND disabled = FALSE',
        [projectId]
    )
    if (!project) return undefined

    const today = getLauncherUsageDate(now)
    const dates = buildUsageDateRange(today)
    const [historyRows] = await getPool().execute<UsageRow[]>(
        `SELECT DATE_FORMAT(usage_date, '%Y-%m-%d') AS usage_date, active_launchers
         FROM launcher_daily_usage
         WHERE project_id = ? AND usage_date >= ? AND usage_date < ?
         ORDER BY usage_date`,
        [projectId, dates[0], today]
    )
    const current = await queryOne<RowDataPacket & { active_launchers: number }>(
        `SELECT COUNT(*) AS active_launchers
         FROM launcher_daily_presence
         WHERE project_id = ? AND usage_date = ?`,
        [projectId, today]
    )
    const counts = new Map(historyRows.map(row => [row.usage_date, Number(row.active_launchers)]))
    counts.set(today, Number(current?.active_launchers ?? 0))

    return {
        project: { id: project.id, name: project.name, slug: project.slug },
        timeZone: LAUNCHER_USAGE_TIME_ZONE,
        from: dates[0],
        to: today,
        series: dates.map(date => ({ date, activeLaunchers: counts.get(date) ?? 0 }))
    }
}

export class LauncherUsageMaintenance {
    private timer: NodeJS.Timeout | undefined
    private running = false

    constructor(private readonly onError: (error: unknown) => void) {}

    start(): void {
        if (this.timer) return
        void this.run()
        this.timer = setInterval(() => void this.run(), LAUNCHER_USAGE_ROLLUP_MS)
        this.timer.unref()
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer)
        this.timer = undefined
    }

    private async run(): Promise<void> {
        if (this.running) return
        this.running = true
        try {
            await rollupLauncherUsage()
        } catch (error) {
            this.onError(error)
        } finally {
            this.running = false
        }
    }
}
