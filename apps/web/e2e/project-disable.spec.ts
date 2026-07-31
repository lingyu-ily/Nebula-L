import { expect, test, type Page, type Route } from '@playwright/test'

type Role = 'ADMIN' | 'EDITOR' | 'AUDITOR'

const project = {
    id: 'project-1',
    slug: 'test-project',
    name: 'Test Project',
    description: '',
    rss: '',
    discord: null,
    draftRevision: 7,
    activeReleaseId: null,
    disabled: false
}

async function fulfillJson(route: Route, value: unknown, status = 200): Promise<void> {
    await route.fulfill({
        status,
        contentType: status >= 400 ? 'application/problem+json' : 'application/json',
        body: JSON.stringify(value)
    })
}

async function mockProjectPage(
    page: Page,
    role: Role,
    deleteResponses: number[] = [200]
): Promise<{ deleteBodies: unknown[] }> {
    const deleteBodies: unknown[] = []
    await page.addInitScript(() => localStorage.setItem('i18nextLng', 'en'))
    await page.route('**/api/v1/**', async route => {
        const request = route.request()
        const url = new URL(request.url())
        if (url.pathname === '/api/v1/auth/me') {
            await fulfillJson(route, {
                user: {
                    id: `${role.toLowerCase()}-1`,
                    username: role.toLowerCase(),
                    role,
                    status: 'ACTIVE',
                    mustChangePassword: false
                },
                csrfToken: 'csrf-token'
            })
        } else if (url.pathname === '/api/v1/projects/project-1' && request.method() === 'GET') {
            await fulfillJson(route, { project, servers: [] })
        } else if (url.pathname === '/api/v1/projects/project-1' && request.method() === 'DELETE') {
            deleteBodies.push(request.postDataJSON())
            const status = deleteResponses.shift() ?? 200
            if (status === 200) {
                await fulfillJson(route, { disabled: true })
            } else {
                await fulfillJson(route, {
                    title: 'Draft changed',
                    detail: 'Reload the project before saving',
                    status
                }, status)
            }
        } else if (url.pathname === '/api/v1/projects' && request.method() === 'GET') {
            await fulfillJson(route, { items: [] })
        } else if (url.pathname.endsWith('/jobs') || url.pathname.endsWith('/releases')) {
            await fulfillJson(route, { items: [] })
        } else {
            await fulfillJson(route, { title: 'Not Found', status: 404 }, 404)
        }
    })
    return { deleteBodies }
}

function acceptDisableDialogs(page: Page, name = project.name): void {
    page.on('dialog', async dialog => {
        if (dialog.type() === 'confirm') {
            await dialog.accept()
        } else if (dialog.type() === 'prompt') {
            await dialog.accept(name)
        } else {
            await dialog.accept()
        }
    })
}

test('allows an administrator to disable a distribution with the current revision', async ({ page }) => {
    const { deleteBodies } = await mockProjectPage(page, 'ADMIN')
    acceptDisableDialogs(page)
    await page.goto('/projects/project-1')

    await page.getByRole('button', { name: 'Disable distribution' }).click()

    await expect.poll(() => deleteBodies).toEqual([{ revision: 7 }])
    await expect(page).toHaveURL(/\/projects$/)
    await expect(page.getByText('No distributions yet.')).toBeVisible()
})

test('does not disable when the first confirmation is cancelled', async ({ page }) => {
    const { deleteBodies } = await mockProjectPage(page, 'ADMIN')
    page.once('dialog', dialog => dialog.dismiss())
    await page.goto('/projects/project-1')

    await page.getByRole('button', { name: 'Disable distribution' }).click()

    await expect.poll(() => deleteBodies.length).toBe(0)
    await expect(page).toHaveURL(/\/projects\/project-1$/)
})

test('does not disable when the typed distribution name does not match', async ({ page }) => {
    const { deleteBodies } = await mockProjectPage(page, 'ADMIN')
    acceptDisableDialogs(page, 'Wrong Project')
    await page.goto('/projects/project-1')

    await page.getByRole('button', { name: 'Disable distribution' }).click()

    await expect.poll(() => deleteBodies.length).toBe(0)
    await expect(page).toHaveURL(/\/projects\/project-1$/)
})

for (const role of ['EDITOR', 'AUDITOR'] as const) {
    test(`does not show the disable action to ${role.toLowerCase()} accounts`, async ({ page }) => {
        await mockProjectPage(page, role)
        await page.goto('/projects/project-1')

        await expect(page.getByRole('button', { name: 'Disable distribution' })).toHaveCount(0)
    })
}

test('shows revision conflicts and allows the administrator to retry', async ({ page }) => {
    const { deleteBodies } = await mockProjectPage(page, 'ADMIN', [409, 200])
    acceptDisableDialogs(page)
    await page.goto('/projects/project-1')
    const disableButton = page.getByRole('button', { name: 'Disable distribution' })

    await disableButton.click()
    await expect(page.getByText('Reload the project before saving')).toBeVisible()
    await expect(page).toHaveURL(/\/projects\/project-1$/)
    await expect(disableButton).toBeEnabled()

    await disableButton.click()
    await expect.poll(() => deleteBodies).toEqual([{ revision: 7 }, { revision: 7 }])
    await expect(page).toHaveURL(/\/projects$/)
})
