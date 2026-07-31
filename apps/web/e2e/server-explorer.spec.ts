import { expect, test, type Page, type Route } from '@playwright/test'

async function fulfillJson(route: Route, value: unknown, status = 200): Promise<void> {
    await route.fulfill({
        status,
        contentType: status >= 400 ? 'application/problem+json' : 'application/json',
        body: JSON.stringify(value)
    })
}

const project = {
    id: 'project-1',
    slug: 'test-project',
    name: 'Test Distribution',
    description: '',
    rss: '',
    discord: null,
    draftRevision: 3,
    activeReleaseId: null,
    disabled: false
}

const server = {
    id: 'server-1',
    projectId: 'project-1',
    serverKey: 'main',
    name: 'Main Server',
    description: 'Test server',
    minecraftVersion: '1.20.1',
    serverVersion: '1.0.0',
    address: 'localhost:25565',
    discord: null,
    iconUploadId: null,
    forgeVersion: '47.4.0',
    fabricVersion: null,
    mainServer: true,
    autoconnect: false,
    sortOrder: 0,
    javaOptions: null,
    revision: 0,
    publishedOnce: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    untrackedRules: [],
    modules: [{
        id: 'module-1',
        uploadId: 'upload-1',
        type: 'File',
        displayName: 'options.txt',
        fileName: 'options.txt',
        moduleId: null,
        relativePath: 'config/options.txt',
        optionalMode: 'REQUIRED',
        sortOrder: 0,
        needsManualFile: false,
        manualUrl: null,
        originalName: 'options.txt',
        size: 128,
        md5: 'a'.repeat(32),
        sha256: 'b'.repeat(64),
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z'
    }]
}

async function mockExplorer(page: Page, role: 'EDITOR' | 'AUDITOR' = 'EDITOR'): Promise<unknown[]> {
    const mutations: unknown[] = []
    const directories = [{
        id: 'directory-1',
        path: 'config',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z'
    }]
    await page.addInitScript(() => localStorage.setItem('i18nextLng', 'en'))
    await page.route('**/api/v1/**', async route => {
        const request = route.request()
        const url = new URL(request.url())
        if (url.pathname === '/api/v1/auth/me') {
            await fulfillJson(route, {
                user: {
                    id: 'user-1',
                    username: role.toLowerCase(),
                    role,
                    status: 'ACTIVE',
                    mustChangePassword: false
                },
                csrfToken: 'csrf-token'
            })
        } else if (url.pathname === '/api/v1/projects/project-1/servers/server-1' && request.method() === 'GET') {
            await fulfillJson(route, { project, server, directories })
        } else if (url.pathname.endsWith('/directories') && request.method() === 'POST') {
            const body = request.postDataJSON() as { path: string }
            mutations.push(body)
            directories.push({
                id: `directory-${directories.length + 1}`,
                path: body.path,
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z'
            })
            await fulfillJson(route, { id: directories.at(-1)?.id, path: body.path, draftRevision: 4 }, 201)
        } else {
            await fulfillJson(route, { title: 'Not Found', status: 404 }, 404)
        }
    })
    return mutations
}

test('opens a server-specific Explorer page and creates a real folder', async ({ page }) => {
    const mutations = await mockExplorer(page)
    await page.goto('/projects/project-1/servers/server-1/files')

    await expect(page.getByRole('heading', { name: 'Main Server' })).toBeVisible()
    await page.locator('.explorer-tree').getByRole('button', { name: /Files$/ }).click()
    await expect(page.locator('.explorer-table').getByRole('row', { name: /config Folder files\/config/ })).toBeVisible()

    page.once('dialog', dialog => dialog.accept('resourcepacks'))
    await page.getByRole('button', { name: 'New folder' }).click()
    await expect.poll(() => mutations).toContainEqual(expect.objectContaining({
        revision: 3,
        path: 'resourcepacks'
    }))
})

test('keeps the Explorer available but read-only for auditors', async ({ page }) => {
    await mockExplorer(page, 'AUDITOR')
    await page.goto('/projects/project-1/servers/server-1/files')

    await expect(page.getByRole('button', { name: 'New folder' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Upload' })).toHaveCount(0)
    await page.locator('.explorer-tree').getByRole('button', { name: /Files$/ }).click()
    await expect(page.locator('.explorer-table').getByRole('row', { name: /config Folder files\/config/ })).toBeVisible()
})
