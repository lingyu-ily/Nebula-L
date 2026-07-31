import { expect, test, type Page, type Route } from '@playwright/test'

const projectDetail = {
    project: {
        id: 'project-1',
        slug: 'test-project',
        name: 'Test Project',
        description: '',
        rss: '',
        discord: null,
        draftRevision: 1,
        activeReleaseId: null,
        disabled: false
    },
    servers: []
}

async function fulfillJson(route: Route, value: unknown, status = 200): Promise<void> {
    await route.fulfill({
        status,
        contentType: status >= 400 ? 'application/problem+json' : 'application/json',
        body: JSON.stringify(value)
    })
}

async function mockProjectPage(page: Page, catalogAvailable = true): Promise<unknown[]> {
    const savedServers: unknown[] = []
    await page.addInitScript(() => localStorage.setItem('i18nextLng', 'en'))
    await page.route('**/api/v1/**', async route => {
        const request = route.request()
        const url = new URL(request.url())
        if (url.pathname === '/api/v1/auth/me') {
            await fulfillJson(route, {
                user: {
                    id: 'editor-1',
                    username: 'editor',
                    role: 'EDITOR',
                    status: 'ACTIVE',
                    mustChangePassword: false
                },
                csrfToken: 'csrf-token'
            })
        } else if (url.pathname === '/api/v1/projects/project-1' && request.method() === 'GET') {
            await fulfillJson(route, projectDetail)
        } else if (url.pathname.endsWith('/jobs') || url.pathname.endsWith('/releases')) {
            await fulfillJson(route, { items: [] })
        } else if (url.pathname === '/api/v1/version-catalog/minecraft') {
            if (catalogAvailable) {
                await fulfillJson(route, {
                    versions: [
                        { value: '1.21.5', type: 'release', releaseTime: '2025-03-25T12:00:00Z' },
                        { value: '1.20.1', type: 'release', releaseTime: '2023-06-12T12:00:00Z' }
                    ],
                    stale: false
                })
            } else {
                await fulfillJson(route, {
                    title: 'Version catalog unavailable',
                    status: 503
                }, 503)
            }
        } else if (url.pathname === '/api/v1/version-catalog/loaders') {
            if (catalogAvailable) {
                await fulfillJson(route, {
                    loader: url.searchParams.get('loader'),
                    minecraftVersion: url.searchParams.get('minecraftVersion'),
                    versions: [
                        {
                            value: '0.16.14',
                            recommended: true,
                            latest: true,
                            stable: true
                        }
                    ],
                    stale: false
                })
            } else {
                await fulfillJson(route, {
                    title: 'Version catalog unavailable',
                    status: 503
                }, 503)
            }
        } else if (url.pathname === '/api/v1/projects/project-1/servers' && request.method() === 'POST') {
            savedServers.push(request.postDataJSON())
            await fulfillJson(route, { id: 'server-1', draftRevision: 2 }, 201)
        } else {
            await fulfillJson(route, { title: 'Not Found', status: 404 }, 404)
        }
    })
    return savedServers
}

test('selects suggestions and accepts custom Minecraft and loader versions', async ({ page }) => {
    const savedServers = await mockProjectPage(page)
    await page.goto('/projects/project-1')
    await page.getByRole('button', { name: 'Add server' }).click()

    const serverForm = page.locator('form.form-grid.inset').first()
    const minecraft = serverForm.locator('input[name="minecraftVersion"]')
    await expect(minecraft).toHaveAttribute('list', 'minecraft-version-options')
    await expect(page.locator('#minecraft-version-options option')).toHaveCount(2)
    await minecraft.fill('custom-snapshot')

    const loader = serverForm.locator('select[name="loader"]')
    const loaderVersion = serverForm.locator('input[name="loaderVersion"]')
    await loader.selectOption('forge')
    await loaderVersion.fill('47.4.0')
    await loader.selectOption('fabric')
    await expect(loaderVersion).toHaveValue('')
    await expect(page.locator('#loader-version-options option[value="0.16.14"]')).toHaveCount(1)
    await loaderVersion.fill('custom-loader')

    await serverForm.locator('input[name="serverKey"]').fill('main')
    await serverForm.locator('input[name="name"]').fill('Main Server')
    await serverForm.getByRole('button', { name: 'Save' }).click()

    await expect.poll(() => savedServers.length).toBe(1)
    expect(savedServers[0]).toMatchObject({
        minecraftVersion: 'custom-snapshot',
        forgeVersion: null,
        fabricVersion: 'custom-loader'
    })
})

test('keeps manual entry available when catalogs are offline', async ({ page }) => {
    await mockProjectPage(page, false)
    await page.goto('/projects/project-1')
    await page.getByRole('button', { name: 'Add server' }).click()

    const serverForm = page.locator('form.form-grid.inset').first()
    const minecraft = serverForm.locator('input[name="minecraftVersion"]')
    await expect(page.getByText('Suggestions unavailable. Enter a version manually.')).toBeVisible()
    await minecraft.fill('1.99-custom')
    await serverForm.locator('select[name="loader"]').selectOption('fabric')
    const loaderVersion = serverForm.locator('input[name="loaderVersion"]')
    await expect(page.getByText('Suggestions unavailable. Enter a version manually.')).toHaveCount(2)
    await expect(loaderVersion).toBeEnabled()
    await loaderVersion.fill('0.99-custom')
})
