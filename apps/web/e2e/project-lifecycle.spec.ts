import { expect, test, type Page, type Route } from '@playwright/test'

type Role = 'ADMIN' | 'EDITOR' | 'AUDITOR'

interface MockDeletion {
    id: string
    status: 'QUEUED' | 'RUNNING' | 'FAILED'
    attempts: number
    maxAttempts: number
    error: string | null
    requestedAt: string
}

interface MockProject {
    id: string
    slug: string
    name: string
    description: string
    rss: string
    discord: null
    draftVersion: number
    releaseRevision: null
    published: false
    currentPublishId: null
    launcherUrl: string
    disabled: boolean
    disabledAt: string | null
    deletion?: MockDeletion | null
}

async function fulfillJson(route: Route, value: unknown, status = 200): Promise<void> {
    await route.fulfill({
        status,
        contentType: status >= 400 ? 'application/problem+json' : 'application/json',
        body: JSON.stringify(value)
    })
}

function project(id: string, name: string, deletion: MockDeletion | null = null): MockProject {
    return {
        id,
        slug: id,
        name,
        description: '',
        rss: '',
        discord: null,
        draftVersion: 7,
        releaseRevision: null,
        published: false,
        currentPublishId: null,
        launcherUrl: `https://cdn.example.com/${id}/distribution.json`,
        disabled: true,
        disabledAt: '2026-08-23T01:00:00Z',
        deletion
    }
}

async function mockLifecycle(page: Page, role: Role): Promise<{
    restoreBodies: unknown[]
    purgeBodies: unknown[]
    retryBodies: unknown[]
    disabledRequests: () => number
}> {
    const restoreBodies: unknown[] = []
    const purgeBodies: unknown[] = []
    const retryBodies: unknown[] = []
    let disabledRequestCount = 0
    let purgePolls: number | null = null
    const activeProjects: MockProject[] = []
    let disabledProjects = [
        project('restore-me', 'Restore Me'),
        project('purge-me', 'Purge Me'),
        project('failed-delete', 'Failed Delete', {
            id: 'deletion-failed', status: 'FAILED', attempts: 3, maxAttempts: 3,
            error: 'RustFS unavailable', requestedAt: '2026-08-23T01:10:00Z'
        }),
        project('running-delete', 'Running Delete', {
            id: 'deletion-running', status: 'RUNNING', attempts: 1, maxAttempts: 3,
            error: null, requestedAt: '2026-08-23T01:20:00Z'
        })
    ]

    await page.addInitScript(() => localStorage.setItem('i18nextLng', 'en'))
    await page.route('**/api/v1/**', async route => {
        const request = route.request()
        const url = new URL(request.url())
        const path = url.pathname
        if (path === '/api/v1/auth/me') {
            await fulfillJson(route, {
                user: { id: `${role.toLowerCase()}-1`, username: role.toLowerCase(), role, status: 'ACTIVE', mustChangePassword: false },
                csrfToken: 'csrf-token'
            })
        } else if (path === '/api/v1/projects' && request.method() === 'GET') {
            await fulfillJson(route, { items: activeProjects })
        } else if (path === '/api/v1/projects/disabled' && request.method() === 'GET') {
            disabledRequestCount += 1
            if (purgePolls != null) {
                purgePolls += 1
                if (purgePolls >= 2) {
                    disabledProjects = disabledProjects.filter(value => value.id !== 'purge-me')
                    purgePolls = null
                }
            }
            await fulfillJson(route, { items: disabledProjects })
        } else if (path === '/api/v1/projects/restore-me/restore' && request.method() === 'POST') {
            restoreBodies.push(request.postDataJSON())
            const restored = disabledProjects.find(value => value.id === 'restore-me')!
            restored.disabled = false
            restored.disabledAt = null
            activeProjects.push(restored)
            disabledProjects = disabledProjects.filter(value => value.id !== restored.id)
            await fulfillJson(route, { restored: true })
        } else if (path === '/api/v1/projects/purge-me/purge' && request.method() === 'POST') {
            purgeBodies.push(request.postDataJSON())
            const target = disabledProjects.find(value => value.id === 'purge-me')!
            target.deletion = {
                id: 'deletion-new', status: 'QUEUED', attempts: 0, maxAttempts: 3,
                error: null, requestedAt: '2026-08-23T02:00:00Z'
            }
            purgePolls = 0
            await fulfillJson(route, { queued: true, deletionId: 'deletion-new' }, 202)
        } else if (path === '/api/v1/projects/failed-delete/purge/retry' && request.method() === 'POST') {
            retryBodies.push(request.postDataJSON())
            const target = disabledProjects.find(value => value.id === 'failed-delete')!
            target.deletion = { ...target.deletion!, status: 'QUEUED', attempts: 0, error: null }
            await fulfillJson(route, { queued: true, deletionId: 'deletion-failed' }, 202)
        } else {
            await fulfillJson(route, { title: 'Not Found', status: 404 }, 404)
        }
    })

    return { restoreBodies, purgeBodies, retryBodies, disabledRequests: () => disabledRequestCount }
}

test('administrator can restore a disabled distribution', async ({ page }) => {
    const lifecycle = await mockLifecycle(page, 'ADMIN')
    page.on('dialog', dialog => void dialog.accept())
    await page.goto('/projects')

    await page.getByText('Disabled distributions (4)').click()
    const card = page.locator('.disabled-project-card').filter({ hasText: 'Restore Me' })
    await card.getByRole('button', { name: 'Restore' }).click()

    await expect.poll(() => lifecycle.restoreBodies).toEqual([{ draftVersion: 7 }])
    await expect(card).toHaveCount(0)
    await expect(page.locator('.project-card').getByRole('heading', { name: 'Restore Me' })).toBeVisible()
})

test('permanent deletion requires the exact name and disappears after background cleanup', async ({ page }) => {
    const lifecycle = await mockLifecycle(page, 'ADMIN')
    page.on('dialog', dialog => {
        if (dialog.type() === 'prompt') void dialog.accept('Purge Me')
        else void dialog.accept()
    })
    await page.goto('/projects')
    await page.getByText('Disabled distributions (4)').click()
    const card = page.locator('.disabled-project-card').filter({ hasText: 'Purge Me' })

    await card.getByRole('button', { name: 'Permanently delete' }).click()

    await expect.poll(() => lifecycle.purgeBodies).toEqual([{ draftVersion: 7, confirmationName: 'Purge Me' }])
    await expect(card.getByText('Deletion queued')).toBeVisible()
    await expect(card.getByRole('button', { name: 'Restore' })).toHaveCount(0)
    await expect(card).toHaveCount(0, { timeout: 7000 })
})

test('failed permanent deletion can only be retried', async ({ page }) => {
    const lifecycle = await mockLifecycle(page, 'ADMIN')
    await page.goto('/projects')
    await page.getByText('Disabled distributions (4)').click()
    const card = page.locator('.disabled-project-card').filter({ hasText: 'Failed Delete' })

    await expect(card.getByText('RustFS unavailable')).toBeVisible()
    await expect(card.getByRole('button', { name: 'Restore' })).toHaveCount(0)
    await card.getByRole('button', { name: 'Retry permanent deletion' }).click()

    await expect.poll(() => lifecycle.retryBodies).toEqual([{ draftVersion: 7 }])
    await expect(card.getByText('Deletion queued')).toBeVisible()
})

for (const role of ['EDITOR', 'AUDITOR'] as const) {
    test(`${role.toLowerCase()} cannot see or request the disabled distribution inventory`, async ({ page }) => {
        const lifecycle = await mockLifecycle(page, role)
        await page.goto('/projects')

        await expect(page.getByText(/Disabled distributions/)).toHaveCount(0)
        expect(lifecycle.disabledRequests()).toBe(0)
    })
}
