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
    draftVersion: 3,
    releaseRevision: null,
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
        validateChecksum: true,
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

async function mockExplorer(
    page: Page,
    role: 'EDITOR' | 'AUDITOR' = 'EDITOR',
    options: { failChecksumUpdate?: boolean, nestedDirectories?: boolean } = {}
): Promise<unknown[]> {
    const mutations: unknown[] = []
    const managedProject = { ...project }
    const managedServer = {
        ...server,
        modules: [...server.modules.map(module => ({ ...module })), {
            id: 'module-manual',
            uploadId: null,
            type: 'ForgeMod',
            displayName: 'manual.jar',
            fileName: 'manual.jar',
            moduleId: null,
            relativePath: null,
            optionalMode: 'REQUIRED',
            sortOrder: 1,
            validateChecksum: true,
            needsManualFile: true,
            manualUrl: 'https://example.com/manual.jar',
            originalName: null,
            size: null,
            md5: null,
            sha256: null,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z'
        }]
    }
    const directories = [{
        id: 'directory-1',
        path: 'config',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z'
    }, {
        id: 'directory-2',
        path: 'resourcepacks',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z'
    }]
    if (options.nestedDirectories) {
        directories.push({
            id: 'directory-3',
            path: 'config/client',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z'
        }, {
            id: 'directory-4',
            path: 'config/client/gui',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z'
        }, {
            id: 'directory-5',
            path: 'resourcepacks/hd',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z'
        })
    }
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
            await fulfillJson(route, { project: managedProject, server: managedServer, directories })
        } else if (url.pathname.endsWith('/modules/module-1') && request.method() === 'PATCH') {
            const body = request.postDataJSON() as { draftVersion: number, validateChecksum?: boolean }
            mutations.push(body)
            if (options.failChecksumUpdate) {
                await fulfillJson(route, {
                    title: 'Draft version conflict',
                    detail: 'Draft version changed',
                    status: 409
                }, 409)
                return
            }
            const module = managedServer.modules.find(value => value.id === 'module-1')
            if (module && typeof body.validateChecksum === 'boolean') {
                module.validateChecksum = body.validateChecksum
            }
            managedProject.draftVersion = body.draftVersion + 1
            await fulfillJson(route, { updated: true, draftVersion: managedProject.draftVersion })
        } else if (url.pathname.endsWith('/modules/module-1/download') && request.method() === 'GET') {
            await route.fulfill({
                status: 200,
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'Content-Disposition': 'attachment; filename="options.txt"'
                },
                body: 'payload'
            })
        } else if (url.pathname.endsWith('/explorer/download') && request.method() === 'POST') {
            mutations.push(request.postDataJSON())
            await route.fulfill({
                status: 200,
                headers: {
                    'Content-Type': 'application/zip',
                    'Content-Disposition': 'attachment; filename="main-selection.zip"'
                },
                body: 'PK mock zip'
            })
        } else if (url.pathname.endsWith('/explorer/move') && request.method() === 'POST') {
            const body = request.postDataJSON() as { draftVersion: number }
            mutations.push(body)
            managedProject.draftVersion = body.draftVersion + 1
            await fulfillJson(route, { updated: true, movedEntries: 2, draftVersion: managedProject.draftVersion })
        } else if (url.pathname.endsWith('/explorer/delete') && request.method() === 'POST') {
            const body = request.postDataJSON() as { draftVersion: number }
            mutations.push(body)
            managedProject.draftVersion = body.draftVersion + 1
            await fulfillJson(route, { deleted: true, deletedDirectories: 2, deletedModules: 1, draftVersion: managedProject.draftVersion })
        } else if (url.pathname.endsWith('/directories') && request.method() === 'POST') {
            const body = request.postDataJSON() as { path: string }
            mutations.push(body)
            directories.push({
                id: `directory-${directories.length + 1}`,
                path: body.path,
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z'
            })
            await fulfillJson(route, { id: directories.at(-1)?.id, path: body.path, draftVersion: 4 }, 201)
        } else {
            await fulfillJson(route, { title: 'Not Found', status: 404 }, 404)
        }
    })
    return mutations
}

interface UploadMockState {
    uploadIds: string[]
    directoryBodies: Record<string, unknown>[]
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
        directoryBodies: [],
        moduleBodies: [],
        deletedUploadIds: [],
        detailRequests: 0,
        releaseFirstUpload
    }
    const detailProject = { ...project }
    const detailServer = { ...server, modules: [...server.modules] }
    const detailDirectories: { id: string, path: string, createdAt: string, updatedAt: string }[] = []
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
            await fulfillJson(route, { project: detailProject, server: detailServer, directories: detailDirectories })
        } else if (url.pathname.endsWith('/directories') && request.method() === 'POST') {
            const body = request.postDataJSON() as Record<string, unknown>
            state.directoryBodies.push(body)
            detailProject.draftVersion = Number(body.draftVersion) + 1
            detailDirectories.push({
                id: `directory-${detailDirectories.length + 1}`,
                path: String(body.path),
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z'
            })
            await fulfillJson(route, {
                id: detailDirectories.at(-1)?.id,
                path: body.path,
                draftVersion: detailProject.draftVersion
            }, 201)
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
            detailProject.draftVersion = Number(body.draftVersion) + 1
            await fulfillJson(route, {
                id: `module-${state.moduleBodies.length + 1}`,
                draftVersion: detailProject.draftVersion
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

test('expands and collapses the folder tree independently from navigation', async ({ page }) => {
    await mockExplorer(page, 'EDITOR', { nestedDirectories: true })
    await page.goto('/projects/project-1/servers/server-1/files')

    const tree = page.getByRole('complementary', { name: 'Folder navigation' })
    await expect(tree.getByRole('button', { name: 'Files', exact: true })).toBeVisible()
    await expect(tree.getByRole('button', { name: 'config', exact: true })).toHaveCount(0)
    await expect(tree.getByRole('button', { name: 'Expand Libraries folder', exact: true })).toHaveCount(0)

    await tree.getByRole('button', { name: 'Collapse Main Server folder', exact: true }).click()
    await expect(tree.getByRole('button', { name: 'Files', exact: true })).toHaveCount(0)
    await expect(page.locator('.explorer-table').getByRole('row', { name: /Files Folder/ })).toBeVisible()

    await tree.getByRole('button', { name: 'Expand Main Server folder', exact: true }).click()
    await tree.getByRole('button', { name: 'Expand Files folder', exact: true }).click()
    await expect(tree.getByRole('button', { name: 'config', exact: true })).toBeVisible()
    await expect(tree.getByRole('button', { name: 'client', exact: true })).toHaveCount(0)
    await tree.getByRole('button', { name: 'Collapse Files folder', exact: true }).click()
    await expect(tree.getByRole('button', { name: 'config', exact: true })).toHaveCount(0)
    await expect(page.locator('.explorer-table').getByRole('row', { name: /Files Folder/ })).toBeVisible()

    await tree.getByRole('button', { name: 'Files', exact: true }).click()
    await expect(tree.getByRole('button', { name: 'config', exact: true })).toBeVisible()
    await tree.getByRole('button', { name: 'config', exact: true }).click()
    await expect(tree.getByRole('button', { name: 'client', exact: true })).toBeVisible()
    await expect(tree.getByRole('button', { name: 'Files', exact: true })).not.toHaveAttribute('aria-current', 'page')
    await expect(tree.getByRole('button', { name: 'config', exact: true })).toHaveAttribute('aria-current', 'page')

    await tree.getByRole('button', { name: 'Files', exact: true }).click()
    await tree.getByRole('button', { name: 'Expand resourcepacks folder', exact: true }).click()
    await expect(tree.getByRole('button', { name: 'hd', exact: true })).toBeVisible()
    await expect(tree.getByRole('button', { name: 'client', exact: true })).toBeVisible()

    await page.reload()
    await expect(tree.getByRole('button', { name: 'Files', exact: true })).toBeVisible()
    await expect(tree.getByRole('button', { name: 'config', exact: true })).toHaveCount(0)
})

test('opens a server-specific Explorer page and creates a real folder', async ({ page }) => {
    const mutations = await mockExplorer(page)
    await page.goto('/projects/project-1/servers/server-1/files')

    await expect(page.getByRole('heading', { name: 'Main Server' })).toBeVisible()
    await page.locator('.explorer-tree').getByRole('button', { name: /Files$/ }).click()
    await expect(page.locator('.explorer-table').getByRole('row', { name: /config Folder files\/config/ })).toBeVisible()

    page.once('dialog', dialog => dialog.accept('resourcepacks'))
    await page.getByRole('button', { name: 'New folder' }).click()
    await expect.poll(() => mutations).toContainEqual(expect.objectContaining({
        draftVersion: 3,
        path: 'resourcepacks'
    }))
})

test('selects multiple Explorer entries for atomic move and delete actions', async ({ page }) => {
    const mutations = await mockExplorer(page)
    await page.goto('/projects/project-1/servers/server-1/files')
    await page.locator('.explorer-tree').getByRole('button', { name: /Files$/ }).click()

    const configRow = page.locator('.explorer-table').getByRole('row', { name: /config Folder files\/config/ })
    const resourcepacksRow = page.locator('.explorer-table').getByRole('row', { name: /resourcepacks Folder/ })
    await configRow.click()
    await resourcepacksRow.click({ modifiers: ['Control'] })
    await expect(page.getByText('2 of 2 selected')).toBeVisible()
    await resourcepacksRow.click({ modifiers: ['Control'] })
    await configRow.click()
    await resourcepacksRow.click({ modifiers: ['Shift'] })
    await expect(page.getByText('2 of 2 selected')).toBeVisible()

    page.once('dialog', dialog => dialog.accept('archive'))
    await page.getByRole('button', { name: 'Move' }).click()
    await expect.poll(() => mutations).toContainEqual(expect.objectContaining({
        draftVersion: 3,
        destinationPath: 'archive',
        entries: [
            { kind: 'directory', id: 'directory-1' },
            { kind: 'directory', id: 'directory-2' }
        ]
    }))
    await expect(page.getByText('2 of 2 selected')).toHaveCount(0)

    await page.getByRole('checkbox', { name: 'Select all visible items' }).check()
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: 'Delete' }).click()
    await expect.poll(() => mutations).toContainEqual(expect.objectContaining({
        draftVersion: 4,
        recursive: true,
        entries: [
            { kind: 'directory', id: 'directory-1' },
            { kind: 'directory', id: 'directory-2' }
        ]
    }))
})

test('downloads a selected folder as a ZIP', async ({ page }) => {
    const mutations = await mockExplorer(page, 'AUDITOR')
    await page.goto('/projects/project-1/servers/server-1/files')
    await page.locator('.explorer-tree').getByRole('button', { name: /Files$/ }).click()
    await page.getByRole('checkbox', { name: 'Select config' }).check()

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Download' }).click()
    ])

    expect(download.suggestedFilename()).toBe('main-selection.zip')
    await expect.poll(() => mutations).toContainEqual({
        entries: [{ kind: 'directory', id: 'directory-1' }]
    })
})

test('keeps the Explorer available but read-only for auditors', async ({ page }) => {
    await mockExplorer(page, 'AUDITOR')
    await page.goto('/projects/project-1/servers/server-1/files')

    await expect(page.getByRole('button', { name: 'New folder' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Upload' })).toHaveCount(0)
    await page.locator('.explorer-tree').getByRole('button', { name: /Files$/ }).click()
    const folderRow = page.locator('.explorer-table').getByRole('row', { name: /config Folder files\/config/ })
    await expect(folderRow).toBeVisible()
    await folderRow.click()
    const downloadButton = page.getByRole('button', { name: 'Download' })
    await expect(downloadButton).toBeEnabled()

    await page.locator('.explorer-tree').getByRole('button', { name: /config$/ }).click()
    await page.locator('.explorer-table').getByRole('row', { name: /options\.txt/ }).click()
    const validationSwitch = page.getByRole('switch', { name: 'Validate options.txt' })
    await expect(validationSwitch).toBeChecked()
    await expect(validationSwitch).toBeDisabled()
    await expect(downloadButton).toBeEnabled()
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        downloadButton.click()
    ])
    expect(download.suggestedFilename()).toBe('options.txt')

    await page.locator('.explorer-tree').getByRole('button', { name: /Forge Mods$/ }).click()
    await page.locator('.explorer-tree').getByRole('button', { name: /Required$/ }).click()
    await page.locator('.explorer-table').getByRole('row', { name: /manual\.jar/ }).click()
    await expect(page.getByText('Always on')).toBeVisible()
    await expect(downloadButton).toBeDisabled()
})

test('updates checksum validation for a File module', async ({ page }) => {
    const mutations = await mockExplorer(page)
    await page.goto('/projects/project-1/servers/server-1/files')
    await page.locator('.explorer-tree').getByRole('button', { name: /Files$/ }).click()
    await page.locator('.explorer-tree').getByRole('button', { name: /config$/ }).click()

    const validationSwitch = page.getByRole('switch', { name: 'Validate options.txt' })
    await expect(validationSwitch).toBeChecked()
    await validationSwitch.click()

    await expect.poll(() => mutations).toContainEqual(expect.objectContaining({
        draftVersion: 3,
        validateChecksum: false
    }))
    await expect(validationSwitch).not.toBeChecked()
})

test('keeps checksum validation unchanged when the draft version conflicts', async ({ page }) => {
    await mockExplorer(page, 'EDITOR', { failChecksumUpdate: true })
    await page.goto('/projects/project-1/servers/server-1/files')
    await page.locator('.explorer-tree').getByRole('button', { name: /Files$/ }).click()
    await page.locator('.explorer-tree').getByRole('button', { name: /config$/ }).click()

    const validationSwitch = page.getByRole('switch', { name: 'Validate options.txt' })
    await validationSwitch.click()

    await expect(page.getByRole('alert')).toContainText('Draft version changed')
    await expect(validationSwitch).toBeChecked()
})

test('uploads multiple selected files sequentially with the returned draft versions', async ({ page }) => {
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
            draftVersion: 3,
            uploadId: 'upload-1',
            type: 'File',
            displayName: 'first.txt',
            fileName: 'first.txt',
            relativePath: 'first.txt',
            optionalMode: 'REQUIRED',
            sortOrder: 1
        }),
        expect.objectContaining({
            draftVersion: 4,
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
    await expect(page.getByText('Drop files or folders here to upload')).toBeVisible()
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

    await expect(page.getByRole('alert')).toContainText('1/3 file(s) uploaded. first.txt failed: Module path already exists')
    expect(state.uploadIds).toEqual(['upload-1', 'upload-2'])
    expect(state.moduleBodies).toHaveLength(2)
    expect(state.deletedUploadIds).toEqual(['upload-2'])
    await expect.poll(() => state.detailRequests).toBeGreaterThan(1)
})
