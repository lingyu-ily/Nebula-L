import { expect, test, type Page, type Route } from '@playwright/test'

const project = {
    id: 'project-1',
    slug: 'ordered-distribution',
    name: 'Ordered Distribution',
    description: '',
    rss: '',
    discord: null,
    draftRevision: 7,
    activeReleaseId: null,
    launcherUrl: 'https://cdn.example.com/ordered-distribution/distribution.json',
    stableDistributionReady: false,
    disabled: false
}

const servers = [
    {
        id: '9fb8ad8a-4d47-4dd8-85f7-07059f4ef4c8',
        serverKey: 'alpha',
        name: 'Alpha',
        minecraftVersion: '1.20.1',
        serverVersion: '1.0.0',
        address: 'alpha.example.com',
        forgeVersion: null,
        fabricVersion: null,
        mainServer: false,
        sortOrder: 2
    },
    {
        id: '0d4b42c8-45ec-4bbc-9ca1-80901de7b38d',
        serverKey: 'beta',
        name: 'Beta',
        minecraftVersion: '1.21.1',
        serverVersion: '2.0.0',
        address: 'beta.example.com',
        forgeVersion: '52.0.1',
        fabricVersion: null,
        mainServer: true,
        sortOrder: 9
    },
    {
        id: '15560bba-d040-4a1f-a3b3-11ca28e3ef15',
        serverKey: 'gamma',
        name: 'Gamma',
        minecraftVersion: '1.19.4',
        serverVersion: '3.0.0',
        address: 'gamma.example.com',
        forgeVersion: null,
        fabricVersion: '0.16.0',
        mainServer: false,
        sortOrder: 4
    }
]

async function fulfillJson(route: Route, value: unknown): Promise<void> {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) })
}

async function mockProject(page: Page, options: {
    role?: 'ADMIN' | 'EDITOR' | 'AUDITOR'
    rejectOrder?: boolean
} = {}): Promise<{ orderUpdates: unknown[], serverCreates: unknown[] }> {
    const role = options.role ?? 'EDITOR'
    const orderUpdates: unknown[] = []
    const serverCreates: unknown[] = []
    let revision = project.draftRevision
    let orderedServers = [...servers]
    await page.addInitScript(() => localStorage.setItem('i18nextLng', 'en'))
    await page.route('**/api/v1/**', async route => {
        const request = route.request()
        const path = new URL(request.url()).pathname
        if (path === '/api/v1/auth/me') {
            await fulfillJson(route, {
                user: { id: 'user-1', username: role.toLowerCase(), role, status: 'ACTIVE', mustChangePassword: false },
                csrfToken: 'csrf-token'
            })
        } else if (path === '/api/v1/projects/project-1' && request.method() === 'GET') {
            await fulfillJson(route, { project: { ...project, draftRevision: revision }, servers: orderedServers })
        } else if (path === '/api/v1/projects/project-1/servers/order' && request.method() === 'PUT') {
            const body = request.postDataJSON() as { serverIds: string[] }
            orderUpdates.push(body)
            if (options.rejectOrder) {
                await route.fulfill({
                    status: 409,
                    contentType: 'application/problem+json',
                    body: JSON.stringify({ title: 'Draft changed', detail: 'Reload the project before saving' })
                })
                return
            }
            const byId = new Map(orderedServers.map(server => [server.id, server]))
            orderedServers = body.serverIds.flatMap((id, sortOrder) => {
                const server = byId.get(id)
                return server ? [{ ...server, sortOrder }] : []
            })
            revision += 1
            await fulfillJson(route, { updated: true, draftRevision: revision })
        } else if (path === '/api/v1/projects/project-1/servers' && request.method() === 'POST') {
            serverCreates.push(request.postDataJSON())
            await fulfillJson(route, { id: '68fc3c94-96c3-4b03-87d2-46f85e661aae', draftRevision: revision + 1 })
        } else if (path === '/api/v1/version-catalog/minecraft') {
            await fulfillJson(route, { versions: [], stale: false })
        } else if (path.endsWith('/jobs') || path.endsWith('/releases')) {
            await fulfillJson(route, { items: [] })
        } else {
            await route.fulfill({ status: 404, contentType: 'application/problem+json', body: '{"title":"Not Found"}' })
        }
    })
    return { orderUpdates, serverCreates }
}

test('lets an editor reorder repeatedly and save one normalized ID list', async ({ page }) => {
    const { orderUpdates } = await mockProject(page)
    await page.goto('/projects/project-1')

    const saveOrder = page.getByRole('button', { name: 'Save order' })
    await expect(saveOrder).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Move Alpha up' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Move Gamma down' })).toBeDisabled()

    await page.getByRole('button', { name: 'Move Beta down' }).click()
    await page.getByRole('button', { name: 'Move Alpha down' }).click()
    await expect.poll(() => page.locator('.server-row h3').allTextContents()).toEqual(['Gamma', 'Alpha', 'Beta'])
    expect(orderUpdates).toHaveLength(0)

    await saveOrder.click()
    await expect.poll(() => orderUpdates).toHaveLength(1)
    expect(orderUpdates[0]).toEqual({
        revision: 7,
        serverIds: [servers[2].id, servers[0].id, servers[1].id]
    })
    await expect(saveOrder).toBeDisabled()
})

test('gives admins the ordering controls and keeps auditors read only', async ({ browser }) => {
    for (const role of ['ADMIN', 'AUDITOR'] as const) {
        const page = await browser.newPage()
        await mockProject(page, { role })
        await page.goto('/projects/project-1')
        if (role === 'ADMIN') {
            await expect(page.getByRole('button', { name: 'Save order' })).toBeVisible()
            await expect(page.getByRole('button', { name: 'Move Beta up' })).toBeEnabled()
        } else {
            await expect(page.getByRole('button', { name: 'Save order' })).toHaveCount(0)
            await expect(page.getByRole('button', { name: 'Move Beta up' })).toHaveCount(0)
            await expect(page.getByLabel('Position 1')).toBeVisible()
        }
        await page.close()
    }
})

test('preserves the pending screen order when the revision conflicts', async ({ page }) => {
    await mockProject(page, { rejectOrder: true })
    await page.goto('/projects/project-1')

    await page.getByRole('button', { name: 'Move Alpha down' }).click()
    await page.getByRole('button', { name: 'Save order' }).click()

    await expect(page.getByRole('alert')).toContainText('Reload the project before saving')
    await expect.poll(() => page.locator('.server-row h3').allTextContents()).toEqual(['Beta', 'Alpha', 'Gamma'])
    await expect(page.getByRole('button', { name: 'Save order' })).toBeEnabled()
})

test('hides the numeric order field and appends a manually created server', async ({ page }) => {
    const { serverCreates } = await mockProject(page)
    await page.goto('/projects/project-1/servers/new')

    await expect(page.locator('input[name="sortOrder"]')).toHaveCount(0)
    await page.getByLabel('Server ID').fill('delta')
    await page.getByLabel('Name').fill('Delta')
    await page.getByLabel('Minecraft').fill('1.21.1')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect.poll(() => serverCreates).toHaveLength(1)
    expect(serverCreates[0]).toMatchObject({ revision: 7, serverKey: 'delta', sortOrder: 10 })
})
