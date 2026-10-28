import { expect, test, type Page } from '@playwright/test'

const projectId = 'versions-project'
const groupId = '07c30729-b9cd-44c3-a2ac-7f36009bce31'
const stableId = 'a1ce3d4a-df36-4822-966f-7e319d6d4311'
const betaId = 'b1ce3d4a-df36-4822-966f-7e319d6d4312'
const copiedId = 'c1ce3d4a-df36-4822-966f-7e319d6d4313'

async function setup(page: Page, role = 'EDITOR'): Promise<{ changes: { method: string, path: string, body: Record<string, unknown> }[] }> {
    const changes: { method: string, path: string, body: Record<string, unknown> }[] = []
    let draftVersion = 7
    let defaultVersionId = stableId
    let versions = [
        { id: stableId, versionName: 'Stable', enabled: true, minecraftVersion: '1.20.1', forgeVersion: '47.4.0', fabricVersion: null, sortOrder: 0 },
        { id: betaId, versionName: 'Beta', enabled: true, minecraftVersion: '1.21.1', forgeVersion: null, fabricVersion: '0.16.0', sortOrder: 1 }
    ]
    const project = (): Record<string, unknown> => ({ id: projectId, name: 'Version project', slug: 'versions', description: '', rss: '', discord: null, draftVersion, published: false, releaseRevision: null, disabled: false })
    const servers = (): Record<string, unknown>[] => versions.map(version => ({
        ...version, groupId, defaultVersionId, name: 'Survival', description: '', serverKey: `v-${version.id}`,
        serverVersion: '1.0.0', address: 'localhost:25565', mainServer: version.id === defaultVersionId,
        discord: null, iconUploadId: null, launcherUi: { backgroundUploadId: null, logoUploadId: null, video: null, eyebrow: '', title: '', tagline: '', rss: '' },
        javaOptions: null, publishedOnce: true, modules: [], untrackedRules: [], revision: 0,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'
    }))
    await page.addInitScript(() => localStorage.setItem('i18nextLng', 'en'))
    await page.route('**/api/v1/**', async route => {
        const request = route.request()
        const path = new URL(request.url()).pathname
        const method = request.method()
        const respond = (value: unknown): Promise<void> => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) })
        if (path === '/api/v1/auth/me') return respond({ user: { id: 'editor', username: 'Editor', role, mustChangePassword: false }, csrfToken: 'csrf' })
        if (path === `/api/v1/projects/${projectId}`) return respond({ project: project(), servers: servers() })
        if (path === `/api/v1/projects/${projectId}/server-groups` && method === 'GET') return respond([{ id: groupId, name: 'Survival', description: '', mainServer: true, sortOrder: 0, defaultVersionId, versions }])
        if (method === 'GET' && path.includes('/servers/')) {
            const id = path.split('/').at(-1)
            return respond({ project: project(), server: servers().find(server => server.id === id), directories: [] })
        }
        if (path.includes('/server-groups/') && method !== 'GET') {
            const body = request.postDataJSON() as Record<string, unknown>
            changes.push({ method, path, body })
            expect(body.draftVersion).toBe(draftVersion)
            if (path.endsWith('/versions') && method === 'POST') {
                versions.push({ ...versions[0], id: copiedId, versionName: String(body.versionName), sortOrder: 2 })
                draftVersion++
                return respond({ id: copiedId, draftVersion })
            }
            if (method === 'PUT' && path.endsWith(groupId)) defaultVersionId = String(body.defaultVersionId)
            if (method === 'PATCH') versions = versions.map(version => version.id === path.split('/').at(-1) ? { ...version, ...body } : version)
            if (method === 'DELETE') versions = versions.filter(version => version.id !== path.split('/').at(-1))
            draftVersion++
            return respond({ updated: true, draftVersion })
        }
        if (path.includes('/version-catalog/')) return respond({ versions: [], stale: false })
        if (path.endsWith('/jobs')) return respond({ items: [] })
        return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
    })
    return { changes }
}

test('shows each server once and opens its versions page', async ({ page }) => {
    await setup(page)
    await page.goto(`/projects/${projectId}`)
    await expect(page.locator('.server-row')).toHaveCount(1)
    await expect(page.getByText('2 versions', { exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Manage', exact: true }).click()
    await page.getByRole('link', { name: 'Versions', exact: true }).click()
    await expect(page.locator('.version-row')).toHaveCount(2)
    await expect(page.getByText('Editing version: Stable', { exact: false })).toBeVisible()
})

test('copies a named version and opens the new independent settings', async ({ page }) => {
    const { changes } = await setup(page)
    await page.goto(`/projects/${projectId}/servers/${stableId}/versions`)
    await page.getByRole('combobox', { name: 'Copy from', exact: true }).selectOption(stableId)
    await page.getByLabel('Version name', { exact: true }).last().fill('New pack')
    await page.getByRole('button', { name: 'Copy version', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`${copiedId}/settings$`))
    expect(changes[0].body).toMatchObject({ versionName: 'New pack', sourceVersionId: stableId, draftVersion: 7 })
    await expect(page.getByText('Editing version: New pack', { exact: false })).toBeVisible()
})

test('creates an empty version with independent Minecraft and connection settings', async ({ page }) => {
    const { changes } = await setup(page)
    await page.goto(`/projects/${projectId}/servers/${stableId}/versions`)
    await page.getByLabel('Version name', { exact: true }).last().fill('New vanilla')
    await page.getByRole('combobox', { name: /^Minecraft/ }).fill('1.21.1')
    await page.getByLabel('Address', { exact: true }).fill('new.example.com:25565')
    await page.getByRole('button', { name: 'Save', exact: true }).last().click()
    await expect(page).toHaveURL(new RegExp(`${copiedId}/settings$`))
    expect(changes[0].body).toMatchObject({
        versionName: 'New vanilla', server: { name: 'Survival', minecraftVersion: '1.21.1', address: 'new.example.com:25565', forgeVersion: null, fabricVersion: null, untrackedRules: [] }
    })
})

test('requires a replacement default before disabling and typed confirmation before deleting', async ({ page }) => {
    const { changes } = await setup(page)
    await page.goto(`/projects/${projectId}/servers/${stableId}/versions`)
    const stable = page.locator('.version-row').filter({ has: page.getByRole('heading', { name: 'Stable', exact: true }) })
    const beta = page.locator('.version-row').filter({ has: page.getByRole('heading', { name: 'Beta', exact: true }) })
    await expect(stable.getByRole('button', { name: 'Disable', exact: true })).toBeDisabled()
    await beta.getByRole('button', { name: 'Set as default', exact: true }).click()
    await expect(stable.getByRole('button', { name: 'Disable', exact: true })).toBeEnabled()
    await stable.getByRole('button', { name: 'Disable', exact: true }).click()
    await expect(stable.getByText('Disabled', { exact: true })).toBeVisible()
    await stable.getByRole('button', { name: 'Permanently delete version', exact: true }).click()
    await expect(stable.getByRole('button', { name: 'Permanently delete version', exact: true }).last()).toBeDisabled()
    await stable.getByLabel(/Type Stable/).fill('Stable')
    await stable.getByRole('button', { name: 'Permanently delete version', exact: true }).last().click()
    await expect(page).toHaveURL(new RegExp(`${betaId}/versions$`))
    await expect(page.locator('.version-row')).toHaveCount(1)
    expect(changes.map(change => change.method)).toEqual(['PUT', 'PATCH', 'DELETE'])
    expect(changes[2].body).toMatchObject({ confirmName: 'Stable', draftVersion: 9 })
})

test('auditors can inspect versions without management controls', async ({ page }) => {
    await setup(page, 'AUDITOR')
    await page.goto(`/projects/${projectId}/servers/${stableId}/versions`)
    await expect(page.locator('.version-row')).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'Set as default', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Add version', exact: true })).toHaveCount(0)
})
