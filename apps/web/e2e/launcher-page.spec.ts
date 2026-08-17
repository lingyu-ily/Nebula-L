import { expect, test, type Page, type Route } from '@playwright/test'

async function fulfillJson(route: Route, value: unknown, status = 200): Promise<void> {
    await route.fulfill({
        status,
        contentType: status >= 400 ? 'application/problem+json' : 'application/json',
        body: JSON.stringify(value)
    })
}

async function mockLauncherPage(page: Page, missingImages = false): Promise<unknown[]> {
    const saves: unknown[] = []
    await page.addInitScript(() => localStorage.setItem('i18nextLng', 'en'))
    await page.route('**/api/v1/**', async route => {
        const request = route.request()
        const url = new URL(request.url())
        if (url.pathname === '/api/v1/auth/me') {
            await fulfillJson(route, {
                user: { id: 'editor-1', username: 'editor', role: 'EDITOR', status: 'ACTIVE', mustChangePassword: false },
                csrfToken: 'csrf-token'
            })
        } else if (url.pathname === '/api/v1/projects/project-1/servers/server-1' && request.method() === 'GET') {
            await fulfillJson(route, {
                project: { id: 'project-1', name: 'Test', rss: 'https://example.com/global/rss', draftRevision: 4 },
                server: {
                    id: 'server-1', serverKey: 'adventure', name: 'Adventure World', description: 'Default description',
                    minecraftVersion: '1.20.1', serverVersion: '1.0.0', address: 'localhost:25565', discord: null,
                    iconUploadId: null, forgeVersion: null, fabricVersion: null, mainServer: true, autoconnect: false,
                    sortOrder: 0, javaOptions: null, revision: 0, publishedOnce: false, createdAt: '', updatedAt: '',
                    modules: [], untrackedRules: [],
                    launcherUi: {
                        backgroundUploadId: missingImages ? 'missing-background' : null,
                        logoUploadId: missingImages ? 'missing-logo' : null,
                        eyebrow: '', title: '', tagline: '', rss: ''
                    }
                },
                directories: []
            })
        } else if (url.pathname.includes('/uploads/missing-') && url.pathname.endsWith('/content')) {
            await fulfillJson(route, { title: 'The specified key does not exist.' }, 500)
        } else if (url.pathname.endsWith('/launcher-ui') && request.method() === 'PATCH') {
            saves.push(request.postDataJSON())
            await fulfillJson(route, { updated: true, draftRevision: 5 })
        } else if (url.pathname === '/api/v1/projects/project-1' && request.method() === 'GET') {
            await fulfillJson(route, { project: { id: 'project-1', name: 'Test', draftRevision: 5 }, servers: [] })
        } else {
            await fulfillJson(route, { title: 'Not Found', status: 404 }, 404)
        }
    })
    return saves
}

test('edits and previews per-server launcher copy', async ({ page }) => {
    const saves = await mockLauncherPage(page)
    await page.goto('/projects/project-1/servers/server-1/launcher')

    await page.getByLabel('Logo eyebrow').fill('MAPLECRAFT SERVER')
    await page.getByLabel('Hero title').fill('Adventure World')
    await page.getByLabel('Hero description').fill('Build your own empire.')
    await page.getByLabel('Server update RSS URL').fill('https://example.com/adventure/rss')
    await expect(page.locator('.launcher-hero-preview')).toContainText('Adventure World')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect.poll(() => saves.length).toBe(1)
    expect(saves[0]).toMatchObject({
        revision: 4,
        backgroundUploadId: null,
        logoUploadId: null,
        eyebrow: 'MAPLECRAFT SERVER',
        title: 'Adventure World',
        tagline: 'Build your own empire.',
        rss: 'https://example.com/adventure/rss'
    })
})

test('shows a recoverable message when stored launcher images are missing', async ({ page }) => {
    await mockLauncherPage(page, true)
    await page.goto('/projects/project-1/servers/server-1/launcher')

    await expect(page.locator('.launcher-preview-missing')).toHaveText('The source image is missing. Re-upload it.')
    await expect(page.getByRole('button', { name: 'Clear image', exact: true })).toHaveCount(2)
})
