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

interface UploadMockState {
    uploadIds: string[]
    moduleBodies: Record<string, unknown>[]
    deletedUploadIds: string[]
    detailRequests: number
    releaseFirstUpload: () => void
}

interface UploadMockOptions {
    failModuleAt?: number
    pauseFirstUpload?: boolean
}

async function mockExplorerUploads(page: Page, options: UploadMockOptions = {}): Promise<UploadMockState> {
    let releaseFirstUpload = (): void => undefined
    const firstUploadGate = options.pauseFirstUpload
        ? new Promise<void>(resolve => { releaseFirstUpload = resolve })
        : Promise.resolve()
    const state: UploadMockState = {
        uploadIds: [],
        moduleBodies: [],
        deletedUploadIds: [],
        detailRequests: 0,
        releaseFirstUpload
    }
    const detailProject = { ...project }
    const detailServer = { ...server, modules: [...server.modules] }
    await page.addInitScript(() => localStorage.setItem('i18nextLng', 'en'))
    await page.route('**/api/v1/**', async route => {
        const request = route.request()
        const url = new URL(request.url())
        if (url.pathname === '/api/v1/auth/me') {
            await fulfillJson(route, {
                user: {
                    id: 'user-1',
                    username: 'editor',
                    role: 'EDITOR',
                    status: 'ACTIVE',
                    mustChangePassword: false
                },
                csrfToken: 'csrf-token'
            })
        } else if (url.pathname === '/api/v1/projects/project-1/servers/server-1' && request.method() === 'GET') {
            state.detailRequests += 1
            await fulfillJson(route, { project: detailProject, server: detailServer, directories: [] })
        } else if (url.pathname === '/api/v1/projects/project-1/uploads' && request.method() === 'POST') {
            if (state.uploadIds.length === 0) await firstUploadGate
            const id = `upload-${state.uploadIds.length + 1}`
            state.uploadIds.push(id)
            await fulfillJson(route, { id }, 201)
        } else if (url.pathname === '/api/v1/projects/project-1/servers/server-1/modules' && request.method() === 'POST') {
            const body = request.postDataJSON() as Record<string, unknown>
            state.moduleBodies.push(body)
            if (state.moduleBodies.length === options.failModuleAt) {
                await fulfillJson(route, {
                    title: 'Module path already exists',
                    detail: 'Module path already exists',
                    status: 409
                }, 409)
                return
            }
            detailProject.draftRevision = Number(body.revision) + 1
            await fulfillJson(route, {
                id: `module-${state.moduleBodies.length + 1}`,
                draftRevision: detailProject.draftRevision
            }, 201)
        } else if (/^\/api\/v1\/projects\/project-1\/uploads\/[^/]+$/.test(url.pathname) && request.method() === 'DELETE') {
            state.deletedUploadIds.push(url.pathname.split('/').at(-1) ?? '')
            await fulfillJson(route, { deleted: true })
        } else {
            await fulfillJson(route, { title: 'Not Found', status: 404 }, 404)
        }
    })
    return state
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

test('uploads multiple selected files sequentially with the returned revisions', async ({ page }) => {
    const state = await mockExplorerUploads(page)
    await page.goto('/projects/project-1/servers/server-1/files')
    await page.locator('.explorer-tree').getByRole('button', { name: /Files$/ }).click()

    await page.locator('input.hidden-file-input[multiple]').setInputFiles([
        { name: 'first.txt', mimeType: 'text/plain', buffer: Buffer.from('first') },
        { name: 'second.txt', mimeType: 'text/plain', buffer: Buffer.from('second') }
    ])

    await expect(page.getByText('2 file(s) uploaded.')).toBeVisible()
    expect(state.uploadIds).toEqual(['upload-1', 'upload-2'])
    expect(state.moduleBodies).toEqual([
        expect.objectContaining({
            revision: 3,
            uploadId: 'upload-1',
            type: 'File',
            displayName: 'first.txt',
            fileName: 'first.txt',
            relativePath: 'first.txt',
            optionalMode: 'REQUIRED',
            sortOrder: 1
        }),
        expect.objectContaining({
            revision: 4,
            uploadId: 'upload-2',
            type: 'File',
            displayName: 'second.txt',
            fileName: 'second.txt',
            relativePath: 'second.txt',
            optionalMode: 'REQUIRED',
            sortOrder: 2
        })
    ])
})

test('accepts dropped files only after opening an uploadable Explorer folder', async ({ page }) => {
    const state = await mockExplorerUploads(page)
    await page.goto('/projects/project-1/servers/server-1/files')
    const explorer = page.locator('.explorer-main')
    const dataTransfer = await page.evaluateHandle(() => {
        const transfer = new DataTransfer()
        transfer.items.add(new File(['alpha'], 'alpha.txt', { type: 'text/plain' }))
        transfer.items.add(new File(['beta'], 'beta.txt', { type: 'text/plain' }))
        return transfer
    })

    await explorer.dispatchEvent('drop', { dataTransfer })
    await expect(page.getByRole('alert')).toHaveText('Open an uploadable folder before dropping files.')
    expect(state.uploadIds).toHaveLength(0)

    await page.locator('.explorer-tree').getByRole('button', { name: /Files$/ }).click()
    await explorer.dispatchEvent('dragenter', { dataTransfer })
    await expect(page.getByText('Drop files here to upload')).toBeVisible()
    await explorer.dispatchEvent('drop', { dataTransfer })

    await expect(page.getByText('2 file(s) uploaded.')).toBeVisible()
    expect(state.uploadIds).toEqual(['upload-1', 'upload-2'])
    expect(state.moduleBodies.map(body => body.relativePath)).toEqual(['alpha.txt', 'beta.txt'])
})

test('ignores another dropped batch while an upload is in progress', async ({ page }) => {
    const state = await mockExplorerUploads(page, { pauseFirstUpload: true })
    await page.goto('/projects/project-1/servers/server-1/files')
    await page.locator('.explorer-tree').getByRole('button', { name: /Files$/ }).click()
    await page.locator('input.hidden-file-input[multiple]').setInputFiles({
        name: 'pending.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('pending')
    })

    await expect(page.getByRole('button', { name: 'Upload' })).toBeDisabled()
    const dataTransfer = await page.evaluateHandle(() => {
        const transfer = new DataTransfer()
        transfer.items.add(new File(['ignored'], 'ignored.txt', { type: 'text/plain' }))
        return transfer
    })
    await page.locator('.explorer-main').dispatchEvent('drop', { dataTransfer })
    state.releaseFirstUpload()

    await expect(page.getByText('1 file(s) uploaded.')).toBeVisible()
    expect(state.uploadIds).toEqual(['upload-1'])
    expect(state.moduleBodies).toHaveLength(1)
    expect(state.moduleBodies[0]).toEqual(expect.objectContaining({ fileName: 'pending.txt' }))
})

test('stops a multi-file upload after a failure and removes the unused upload', async ({ page }) => {
    const state = await mockExplorerUploads(page, { failModuleAt: 2 })
    await page.goto('/projects/project-1/servers/server-1/files')
    await page.locator('.explorer-tree').getByRole('button', { name: /Files$/ }).click()

    await page.locator('input.hidden-file-input[multiple]').setInputFiles([
        { name: 'first.txt', mimeType: 'text/plain', buffer: Buffer.from('first') },
        { name: 'duplicate.txt', mimeType: 'text/plain', buffer: Buffer.from('duplicate') },
        { name: 'never-uploaded.txt', mimeType: 'text/plain', buffer: Buffer.from('third') }
    ])

    await expect(page.getByRole('alert')).toContainText('1/3 file(s) uploaded. duplicate.txt failed: Module path already exists')
    expect(state.uploadIds).toEqual(['upload-1', 'upload-2'])
    expect(state.moduleBodies).toHaveLength(2)
    expect(state.deletedUploadIds).toEqual(['upload-2'])
    await expect.poll(() => state.detailRequests).toBeGreaterThan(1)
})
