import { expect, test, type Page, type Route } from '@playwright/test'

interface HistoryItem {
    id: string
}

async function fulfillJson(route: Route, value: unknown): Promise<void> {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) })
}

function pageItems<T extends HistoryItem>(items: T[], url: URL): {
    items: T[]
    limit: number
    offset: number
    hasMore: boolean
} {
    const limit = Number(url.searchParams.get('limit') ?? 100)
    const offset = Number(url.searchParams.get('offset') ?? 0)
    return {
        items: items.slice(offset, offset + limit),
        limit,
        offset,
        hasMore: items.length > offset + limit
    }
}

async function mockHistory(page: Page): Promise<{
    jobQueries: string[]
    retriedJobs: string[]
}> {
    const jobQueries: string[] = []
    const retriedJobs: string[] = []
    const jobs = Array.from({ length: 6 }, (_, index) => ({
        id: `job-${index + 1}`,
        kind: index % 2 === 0 ? 'PUBLISH' : 'CURSEFORGE_IMPORT',
        status: 'FAILED',
        attempts: 1,
        maxAttempts: 3,
        progress: index + 10,
        result: null,
        error: `Job record ${index + 1}` as string | null,
        createdAt: `2026-08-${String(22 - index).padStart(2, '0')}T00:00:00Z`
    }))
    await page.addInitScript(() => localStorage.setItem('i18nextLng', 'en'))
    await page.route('**/api/v1/**', async route => {
        const request = route.request()
        const url = new URL(request.url())
        const path = url.pathname
        if (path === '/api/v1/auth/me') {
            await fulfillJson(route, {
                user: { id: 'admin-1', username: 'admin', role: 'ADMIN', status: 'ACTIVE', mustChangePassword: false },
                csrfToken: 'csrf-token'
            })
        } else if (path === '/api/v1/projects/project-1') {
            await fulfillJson(route, {
                project: {
                    id: 'project-1', slug: 'history', name: 'History', description: '', rss: '', discord: null,
                    draftVersion: 20, releaseRevision: 20, published: true, currentPublishId: 'job-current',
                    launcherUrl: 'https://cdn.example.com/history/distribution.json',
                    stableDistributionReady: true, disabled: false
                },
                servers: []
            })
        } else if (path === '/api/v1/projects/project-1/jobs' && request.method() === 'GET') {
            jobQueries.push(url.search)
            await fulfillJson(route, pageItems(jobs, url))
        } else if (path === '/api/v1/jobs/job-6/retry' && request.method() === 'POST') {
            retriedJobs.push('job-6')
            const job = jobs.find(value => value.id === 'job-6')!
            job.status = 'QUEUED'
            job.error = null
            job.progress = 0
            await fulfillJson(route, { queued: true })
        } else {
            await route.fulfill({ status: 404, contentType: 'application/problem+json', body: '{"title":"Not Found"}' })
        }
    })
    return { jobQueries, retriedJobs }
}

test('paginates publish jobs in groups of five', async ({ page }) => {
    const history = await mockHistory(page)
    await page.goto('/projects/project-1')

    const jobCard = page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Background jobs' }) })
    const jobPages = jobCard.getByRole('navigation', { name: 'Background job pages' })

    await expect(jobCard.locator('.timeline-row')).toHaveCount(5)
    await expect(jobPages.getByText('Page 1')).toBeVisible()
    await expect(jobPages.getByRole('button', { name: 'Previous' })).toBeDisabled()

    await jobPages.getByRole('button', { name: 'Next' }).click()
    await expect(jobCard.getByText('Job record 6')).toBeVisible()
    await expect(jobCard.locator('.timeline-row')).toHaveCount(1)
    await expect(jobPages.getByText('Page 2')).toBeVisible()
    await expect(jobPages.getByRole('button', { name: 'Next' })).toBeDisabled()
    await expect.poll(() => history.jobQueries.some(query => query === '?view=summary&limit=5&offset=5')).toBe(true)

    await jobCard.getByRole('button', { name: 'Retry' }).click()
    await expect.poll(() => history.retriedJobs).toEqual(['job-6'])
    await expect(jobCard.getByText('QUEUED')).toBeVisible()
})
