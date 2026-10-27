import { expect, test, type Page } from '@playwright/test'

declare global {
    interface Window { nebulaTestAuroraDraws: number }
}

const project = {
    id: 'project-1', name: 'Maplecraft', slug: 'maplecraft', description: 'A world built together.',
    rss: '', discord: null, draftVersion: 3, releaseRevision: 2, published: true,
    currentPublishId: 'publish-2', launcherUrl: 'https://cdn.example.com/maplecraft/distribution.json',
    stableDistributionReady: true, disabled: false, disabledAt: null
}
const server = {
    id: 'server-1', name: 'Survival', serverKey: 'survival', minecraftVersion: '1.20.1',
    serverVersion: '1.0.0', address: 'play.maplecraft.example:25565', description: 'Explore the world.',
    discord: null, forgeVersion: null, fabricVersion: null, modules: [], untrackedRules: [],
    javaOptions: null, iconUploadId: null, mainServer: true, autoconnect: false, sortOrder: 0,
    launcherUi: { backgroundUploadId: null, logoUploadId: null, video: null, eyebrow: '', title: '', tagline: '', rss: '' },
    revision: 1, publishedOnce: true, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-27T00:00:00Z'
}

async function mockConsole(page: Page, role = 'ADMIN'): Promise<void> {
    await page.addInitScript(() => localStorage.setItem('i18nextLng', 'en'))
    await page.route('**/api/v1/**', async route => {
        const path = new URL(route.request().url()).pathname
        let value: unknown = { items: [] }
        if (path === '/api/v1/auth/me') value = { user: { id: 'user-1', username: 'stargazer', role, status: 'ACTIVE', mustChangePassword: false }, csrfToken: 'token' }
        else if (path === '/api/v1/projects') value = { items: [project, { ...project, id: 'project-2', name: 'Creative', slug: 'creative', published: false, releaseRevision: null }] }
        else if (path === '/api/v1/projects/project-1') value = { project, servers: [server] }
        else if (path === '/api/v1/projects/project-1/servers/server-1') value = { project, server, directories: [] }
        else if (path === '/api/v1/projects/project-1/launcher-usage') value = { project, timeZone: 'Asia/Taipei', from: '2026-10-01', to: '2026-10-27', series: [{ date: '2026-10-27', activeLaunchers: 42 }] }
        else if (path.includes('version-catalog')) value = { versions: [], stale: false }
        else if (path === '/api/v1/users') value = { items: [{ id: 'user-1', username: 'stargazer', role: 'ADMIN', status: 'ACTIVE', mustChangePassword: false }] }
        else if (path === '/api/v1/audit-logs') value = { items: [{ id: 1, action: 'project.publish', actorUsername: 'stargazer', result: 'SUCCESS', entityType: 'project', entityId: project.id, createdAt: '2026-10-27T00:00:00Z', before: null, after: { revision: 2 }, ip: null, errorMessage: null }] }
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) })
    })
}

test('shows real summary counts and retains project links', async ({ page }) => {
    await mockConsole(page)
    await page.goto('/projects')
    await expect(page.locator('.metric-card strong')).toHaveText(['02', '01', '01'])
    await page.getByRole('link', { name: /Maplecraft/ }).click()
    await expect(page).toHaveURL(/\/projects\/project-1$/)
    await expect(page.getByRole('button', { name: 'Publish update', exact: true })).toBeVisible()
    await expect(page.locator('.aurora-canvas')).toHaveCount(1)
})

test('preserves motion preference across reloads and honors live OS changes', async ({ page }) => {
    await mockConsole(page)
    await page.goto('/projects')
    const toggle = page.getByRole('button', { name: 'Motion effects', exact: true })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.aurora-canvas')).toHaveCount(0)
    await page.reload()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await toggle.click()
    await expect(page.locator('.aurora-canvas')).toHaveCount(1)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(toggle).toBeDisabled()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.aurora-canvas')).toHaveCount(0)
    expect(await page.locator('.page-content').evaluate(element => element.getAnimations().length)).toBe(0)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect(toggle).toBeEnabled()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
})

test('keeps management usable when WebGL is unavailable', async ({ page }) => {
    await mockConsole(page)
    await page.addInitScript(() => {
        // Simulate devices that do not provide a GPU canvas, leaving normal page APIs intact.
        Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => null })
    })
    await page.goto('/projects')
    await expect(page.locator('.aurora-canvas')).toHaveAttribute('data-renderer', 'fallback')
    await expect(page.locator('.aurora-fallback')).toBeVisible()
    await page.getByRole('link', { name: /Maplecraft/ }).click()
    await expect(page.getByRole('heading', { name: 'Maplecraft', exact: true })).toBeVisible()
})

test('pauses GPU rendering while the document is hidden and resumes when visible', async ({ page }) => {
    await mockConsole(page)
    await page.addInitScript(() => {
        const target = window
        target.nebulaTestAuroraDraws = 0
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Called with an explicit WebGL context below.
        const draw = WebGL2RenderingContext.prototype.drawArrays
        WebGL2RenderingContext.prototype.drawArrays = function (this: WebGL2RenderingContext, ...args: Parameters<typeof draw>): void {
            target.nebulaTestAuroraDraws++
            draw.apply(this, args)
        }
    })
    await page.goto('/projects')
    await expect(page.locator('.aurora-canvas')).toHaveAttribute('data-renderer', 'webgl')
    await expect.poll(() => page.evaluate(() => window.nebulaTestAuroraDraws)).toBeGreaterThan(2)
    const before = await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true })
        document.dispatchEvent(new Event('visibilitychange'))
        return window.nebulaTestAuroraDraws
    })
    await expect(page.locator('.aurora-canvas')).toHaveAttribute('data-paused', 'true')
    await expect(page.locator('.cosmic-stars')).toHaveCSS('animation-play-state', 'paused')
    await page.waitForTimeout(150)
    expect(await page.evaluate(() => window.nebulaTestAuroraDraws)).toBe(before)
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false })
        document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect.poll(() => page.evaluate(() => window.nebulaTestAuroraDraws)).toBeGreaterThan(before)
})

test('mobile navigation traps focus, closes with Escape, and returns focus', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 })
    await mockConsole(page)
    await page.goto('/projects')
    const opener = page.getByRole('button', { name: 'Open navigation' })
    const dialog = page.getByRole('dialog', { name: 'Main navigation' })
    await expect(dialog).not.toBeVisible()
    await opener.click()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('link', { name: /NEBULA/ })).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('button', { name: 'Sign out' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('link', { name: /NEBULA/ })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(opener).toBeFocused()
    await opener.click()
    await dialog.getByRole('link', { name: 'Launcher analytics' }).click()
    await expect(page).toHaveURL(/\/analytics$/)
    await expect(dialog).not.toBeVisible()
    await expect(page.getByRole('heading', { name: 'Launcher analytics' })).toBeVisible()
    await opener.click()
    await dialog.getByRole('link', { name: 'Launcher analytics' }).click()
    await expect(dialog).not.toBeVisible()
})

test('keeps route state and typed form values when motion or language changes', async ({ page }) => {
    await mockConsole(page)
    await page.goto('/projects/project-1')
    const name = page.locator('input[name="name"]').first()
    await name.fill('Unsaved world')
    await page.getByRole('button', { name: 'Motion effects', exact: true }).click()
    await expect(name).toHaveValue('Unsaved world')
    await page.getByRole('button', { name: '中文', exact: true }).click()
    await expect(name).toHaveValue('Unsaved world')
    await expect(page.getByRole('button', { name: '動態效果', exact: true })).toBeVisible()
    await expect(page).toHaveURL(/\/projects\/project-1$/)
})

for (const role of ['ADMIN', 'EDITOR', 'AUDITOR']) {
    test(`keeps ${role} navigation permissions`, async ({ page }) => {
        await mockConsole(page, role)
        await page.goto('/projects')
        const accounts = page.getByRole('link', { name: 'Accounts', exact: true })
        if (role === 'ADMIN') await expect(accounts).toBeVisible()
        else await expect(accounts).toHaveCount(0)
        await expect(page.getByRole('link', { name: 'Distributions', exact: true })).toHaveAttribute('aria-current', 'page')
    })
}

for (const width of [1440, 1280, 768, 360]) {
    test(`keeps all management surfaces within the ${width}px viewport`, async ({ page }) => {
        await mockConsole(page)
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.setViewportSize({ width, height: 800 })
        const routes = ['/projects', '/projects/project-1', '/analytics', '/users', '/audit', '/projects/project-1/servers/server-1/overview', '/projects/project-1/servers/server-1/settings', '/projects/project-1/servers/server-1/launcher', '/projects/project-1/servers/server-1/files']
        for (const route of routes) {
            await page.goto(route)
            await expect(page.locator('.content h1')).toBeVisible()
            const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
            expect(size.scroll, route).toBeLessThanOrEqual(size.width)
        }
    })
}
