import { expect, test, type Page, type Route } from '@playwright/test'

const project = {
    id: 'project-1',
    slug: 'published-distribution',
    name: 'Published Distribution',
    description: '',
    rss: '',
    discord: null,
    draftRevision: 3,
    activeReleaseId: 'release-1',
    launcherUrl: 'https://cdn.example.com/published-distribution/distribution.json',
    stableDistributionReady: true,
    disabled: false
}

const server = {
    id: 'server-1',
    serverKey: 'published-server',
    name: 'Published Server',
    description: '',
    minecraftVersion: '1.20.1',
    serverVersion: '1.0.0',
    address: 'localhost:25565',
    discord: null,
    iconUploadId: null,
    forgeVersion: null,
    fabricVersion: null,
    mainServer: true,
    autoconnect: false,
    sortOrder: 0,
    javaOptions: null,
    revision: 0,
    publishedOnce: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    modules: [],
    untrackedRules: []
}

async function fulfillJson(route: Route, value: unknown): Promise<void> {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) })
}

async function mockPublishedSettings(page: Page): Promise<{
    projectUpdates: unknown[]
    serverUpdates: unknown[]
}> {
    const projectUpdates: unknown[] = []
    const serverUpdates: unknown[] = []
    await page.addInitScript(() => localStorage.setItem('i18nextLng', 'en'))
    await page.route('**/api/v1/**', async route => {
        const request = route.request()
        const path = new URL(request.url()).pathname
        if (path === '/api/v1/auth/me') {
            await fulfillJson(route, {
                user: { id: 'editor-1', username: 'editor', role: 'EDITOR', status: 'ACTIVE', mustChangePassword: false },
                csrfToken: 'csrf-token'
            })
        } else if (path === '/api/v1/projects/project-1' && request.method() === 'GET') {
            await fulfillJson(route, { project, servers: [server] })
        } else if (path === '/api/v1/projects/project-1' && request.method() === 'PUT') {
            projectUpdates.push(request.postDataJSON())
            await fulfillJson(route, { updated: true, draftRevision: 4 })
        } else if (path === '/api/v1/projects/project-1/servers/server-1' && request.method() === 'GET') {
            await fulfillJson(route, { project, server, directories: [] })
        } else if (path === '/api/v1/projects/project-1/servers/server-1' && request.method() === 'PUT') {
            serverUpdates.push(request.postDataJSON())
            await fulfillJson(route, { updated: true, draftRevision: 4 })
        } else if (path === '/api/v1/version-catalog/minecraft') {
            await fulfillJson(route, { versions: [], stale: false })
        } else if (path.endsWith('/jobs') || path.endsWith('/releases')) {
            await fulfillJson(route, { items: [] })
        } else {
            await route.fulfill({ status: 404, contentType: 'application/problem+json', body: '{"title":"Not Found"}' })
        }
    })
    return { projectUpdates, serverUpdates }
}

test('keeps the published distribution slug when saving other settings', async ({ page }) => {
    const { projectUpdates } = await mockPublishedSettings(page)
    await page.goto('/projects/project-1')

    const settingsForm = page.locator('form').filter({ has: page.locator('input[name="slug"]') })
    await expect(settingsForm.locator('input[name="slug"]')).toBeDisabled()
    await settingsForm.locator('input[name="name"]').fill('Updated Distribution')
    await settingsForm.getByRole('button', { name: 'Save' }).click()

    await expect.poll(() => projectUpdates).toHaveLength(1)
    expect(projectUpdates[0]).toMatchObject({
        revision: 3,
        name: 'Updated Distribution',
        slug: 'published-distribution'
    })
})

test('keeps the published server ID when saving other settings', async ({ page }) => {
    const { serverUpdates } = await mockPublishedSettings(page)
    await page.goto('/projects/project-1/servers/server-1/settings')

    const settingsForm = page.locator('form.server-settings-form')
    await expect(settingsForm.locator('input[name="serverKey"]')).toBeDisabled()
    await settingsForm.locator('input[name="name"]').fill('Updated Server')
    await settingsForm.getByRole('button', { name: 'Save' }).click()

    await expect.poll(() => serverUpdates).toHaveLength(1)
    expect(serverUpdates[0]).toMatchObject({
        revision: 3,
        name: 'Updated Server',
        serverKey: 'published-server'
    })
})
