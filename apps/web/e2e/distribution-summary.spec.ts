import { expect, test, type Page, type Route } from '@playwright/test'
import type { JobSummary } from '../src/api.js'

async function fulfillJson(route: Route, value: unknown): Promise<void> {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) })
}

async function mockSummary(page: Page): Promise<{
    projectQueries: string[]
    jobQueries: string[]
    jobs: JobSummary[]
    currentPublishId: string
    revision: number
}> {
    const state = {
        projectQueries: [] as string[],
        jobQueries: [] as string[],
        jobs: [{
            id: 'publish-3', kind: 'PUBLISH', status: 'SUCCEEDED', attempts: 1, maxAttempts: 3,
            progress: 100, error: null, createdAt: '2026-10-28T00:00:00Z'
        }] as JobSummary[],
        currentPublishId: 'publish-3',
        revision: 3
    }
    await page.addInitScript(() => {
        localStorage.setItem('i18nextLng', 'en')
        localStorage.setItem('nebula.motion', 'off')
    })
    await page.route('**/api/v1/**', async route => {
        const request = route.request()
        const url = new URL(request.url())
        if (url.pathname === '/api/v1/auth/me') {
            await fulfillJson(route, {
                user: { id: 'editor-1', username: 'editor', role: 'EDITOR', status: 'ACTIVE', mustChangePassword: false },
                csrfToken: 'csrf'
            })
        } else if (url.pathname === '/api/v1/projects/project-1') {
            state.projectQueries.push(url.search)
            await fulfillJson(route, {
                project: {
                    id: 'project-1', slug: 'summary', name: 'Summary Distribution', description: '', rss: '', discord: null,
                    draftVersion: 7, releaseRevision: state.revision, published: true,
                    currentPublishId: state.currentPublishId, launcherUrl: 'https://cdn.example.com/distribution.json',
                    stableDistributionReady: true, disabled: false
                },
                servers: []
            })
        } else if (url.pathname === '/api/v1/projects/project-1/jobs') {
            state.jobQueries.push(url.search)
            const offset = Number(url.searchParams.get('offset') ?? 0)
            await fulfillJson(route, {
                items: state.jobs.slice(offset, offset + 5), limit: 5, offset, hasMore: state.jobs.length > offset + 5
            })
        } else if (url.pathname === '/api/v1/projects/project-1/publish' && request.method() === 'POST') {
            expect(request.postDataJSON()).toEqual({ draftVersion: 7 })
            state.jobs.unshift({
                id: 'publish-4', kind: 'PUBLISH', status: 'RUNNING', attempts: 1, maxAttempts: 3,
                progress: 25, error: null, createdAt: '2026-10-28T01:00:00Z'
            })
            await route.fulfill({ status: 202, contentType: 'application/json', body: '{"jobId":"publish-4"}' })
        } else {
            await route.fulfill({ status: 404, contentType: 'application/problem+json', body: '{"title":"Not Found"}' })
        }
    })
    return state
}

test('loads one project summary, polls three times, and refetches only summaries on focus', async ({ page }) => {
    await page.clock.install()
    const state = await mockSummary(page)
    await page.goto('/projects/project-1')
    await expect(page.getByText('SUCCEEDED', { exact: true })).toBeVisible()
    expect(state.projectQueries).toEqual(['?view=summary'])
    const initialPolls = state.jobQueries.length

    for (let round = 1; round <= 3; round++) {
        await page.clock.fastForward(3000)
        await expect.poll(() => state.jobQueries.length).toBe(initialPolls + round)
        expect(state.projectQueries).toHaveLength(1)
    }
    expect(state.jobQueries.every(query => query === '?view=summary&limit=5&offset=0')).toBe(true)

    await page.clock.fastForward(1100)
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
    await expect.poll(() => state.projectQueries.length).toBe(2)
    expect(state.projectQueries).toEqual(['?view=summary', '?view=summary'])
})

test('refreshes the summary once after a newly queued publish succeeds', async ({ page }) => {
    await page.clock.install()
    const state = await mockSummary(page)
    await page.goto('/projects/project-1')
    await expect(page.getByText('SUCCEEDED', { exact: true })).toBeVisible()
    page.on('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: 'Publish update' }).click()
    await expect(page.getByText('25%', { exact: true })).toBeVisible()
    expect(state.projectQueries).toHaveLength(1)

    state.jobs[0].progress = 75
    await page.clock.fastForward(3000)
    await expect(page.getByText('75%', { exact: true })).toBeVisible()
    expect(state.projectQueries).toHaveLength(1)

    state.jobs[0].status = 'SUCCEEDED'
    state.jobs[0].progress = 100
    state.currentPublishId = 'publish-4'
    state.revision = 4
    await page.clock.fastForward(3000)
    await expect(page.locator('header.project-header')).toContainText('Revision 4')
    expect(state.projectQueries).toHaveLength(2)
    for (let round = 0; round < 3; round++) {
        const previousPolls = state.jobQueries.length
        await page.clock.fastForward(3000)
        await expect.poll(() => state.jobQueries.length).toBe(previousPolls + 1)
        expect(state.projectQueries).toHaveLength(2)
    }
})

test('does not poll historical jobs or refresh the project for older successes', async ({ page }) => {
    await page.clock.install()
    const state = await mockSummary(page)
    state.jobs = Array.from({ length: 6 }, (_, index) => ({ ...state.jobs[0], id: `publish-${3 - index}` }))
    await page.goto('/projects/project-1')
    const pagination = page.getByRole('navigation', { name: 'Background job pages' })
    await expect(pagination).toBeVisible()
    await pagination.getByRole('button', { name: 'Next' }).click()
    await expect(pagination).toContainText('Page 2')
    await expect(page.locator('.timeline-row')).toHaveCount(1)
    expect(state.projectQueries).toHaveLength(1)
    const historicalPolls = state.jobQueries.length
    await page.clock.fastForward(9000)
    expect(state.jobQueries).toHaveLength(historicalPolls)
    expect(state.projectQueries).toHaveLength(1)

    await pagination.getByRole('button', { name: 'Previous' }).click()
    await expect(page.locator('.timeline-row')).toHaveCount(5)
    const firstPagePolls = state.jobQueries.length
    await page.clock.fastForward(3000)
    await expect.poll(() => state.jobQueries.length).toBe(firstPagePolls + 1)
    expect(state.projectQueries).toHaveLength(1)
})
