import { expect, test, type Page, type Route } from '@playwright/test'

async function fulfillJson(route: Route, value: unknown): Promise<void> {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) })
}

function usage(projectId: string, name: string, today: number): unknown {
    const series = Array.from({ length: 30 }, (_, index) => ({
        date: `2026-08-${String(index + 1).padStart(2, '0')}`,
        activeLaunchers: index === 29 ? today : index % 5
    }))
    return {
        project: { id: projectId, name, slug: projectId },
        timeZone: 'Asia/Taipei',
        from: '2026-08-01',
        to: '2026-08-30',
        series
    }
}

async function mockAnalytics(page: Page): Promise<void> {
    await page.addInitScript(() => localStorage.setItem('i18nextLng', 'en'))
    await page.route('**/api/v1/**', async route => {
        const path = new URL(route.request().url()).pathname
        if (path === '/api/v1/auth/me') {
            await fulfillJson(route, {
                user: { id: 'auditor-1', username: 'auditor', role: 'AUDITOR', status: 'ACTIVE', mustChangePassword: false },
                csrfToken: 'csrf-token'
            })
        } else if (path === '/api/v1/projects') {
            await fulfillJson(route, { items: [
                { id: 'project-1', slug: 'one', name: 'First Distribution', published: true },
                { id: 'project-2', slug: 'two', name: 'Second Distribution', published: true }
            ] })
        } else if (path === '/api/v1/projects/project-1/launcher-usage') {
            await fulfillJson(route, usage('project-1', 'First Distribution', 4))
        } else if (path === '/api/v1/projects/project-2/launcher-usage') {
            await fulfillJson(route, usage('project-2', 'Second Distribution', 7))
        } else {
            await route.fulfill({ status: 404, contentType: 'application/problem+json', body: '{"title":"Not Found"}' })
        }
    })
}

test('shows a private 30-day Launcher trend and switches distributions', async ({ page }) => {
    await mockAnalytics(page)
    await page.goto('/analytics')

    await expect(page.getByRole('heading', { name: 'Launcher analytics' })).toBeVisible()
    await expect(page.locator('.usage-today strong')).toHaveText('4')
    await expect(page.locator('svg.usage-chart')).toBeVisible()
    await expect(page.locator('circle.usage-point')).toHaveCount(30)

    await page.getByLabel('Distribution').selectOption('project-2')
    await expect(page.locator('.usage-today strong')).toHaveText('7')
    await page.getByText('View daily data').click()
    await expect(page.locator('.usage-table tbody tr')).toHaveCount(30)
    await expect(page.locator('.usage-table tbody tr').first()).toContainText('7')
})
