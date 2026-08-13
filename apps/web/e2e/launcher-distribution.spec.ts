import { expect, test, type Page, type Route } from '@playwright/test'

const launcherUrl = 'http://s3.gfscs.com/maplecraftlauncher/public/maplecraftlauncher/distribution.json'

async function fulfillJson(route: Route, value: unknown): Promise<void> {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) })
}

async function mockDistribution(page: Page, ready: boolean): Promise<void> {
    await page.addInitScript(() => {
        localStorage.setItem('i18nextLng', 'en')
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: (value: string) => {
                    ;(window as unknown as { copiedLauncherUrl: string }).copiedLauncherUrl = value
                    return Promise.resolve()
                }
            }
        })
    })
    await page.route('**/api/v1/**', async route => {
        const path = new URL(route.request().url()).pathname
        if (path === '/api/v1/auth/me') {
            await fulfillJson(route, {
                user: { id: 'admin-1', username: 'admin', role: 'ADMIN', status: 'ACTIVE', mustChangePassword: false },
                csrfToken: 'csrf-token'
            })
        } else if (path === '/api/v1/projects/project-1') {
            await fulfillJson(route, {
                project: {
                    id: 'project-1', slug: 'maplecraftlauncher', name: 'MapleCraft', description: '', rss: '', discord: null,
                    draftRevision: 3, activeReleaseId: 'release-1', launcherUrl, stableDistributionReady: ready, disabled: false
                },
                servers: []
            })
        } else if (path.endsWith('/jobs') || path.endsWith('/releases')) {
            await fulfillJson(route, { items: [] })
        } else {
            await route.fulfill({ status: 404, contentType: 'application/problem+json', body: '{"title":"Not Found"}' })
        }
    })
}

test('shows and copies the stable launcher distribution URL', async ({ page }) => {
    await mockDistribution(page, true)
    await page.goto('/projects/project-1')

    await expect(page.getByText(launcherUrl)).toBeVisible()
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()
    await expect(page.getByText('release-1')).toBeVisible()
    await page.getByRole('button', { name: 'Copy URL' }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { copiedLauncherUrl?: string }).copiedLauncherUrl))
        .toBe(launcherUrl)
})

test('warns when the stable object does not match the active release', async ({ page }) => {
    await mockDistribution(page, false)
    await page.goto('/projects/project-1')

    await expect(page.getByText('Stable file mismatch')).toBeVisible()
})
