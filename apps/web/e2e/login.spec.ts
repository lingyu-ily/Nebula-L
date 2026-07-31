import { expect, test } from '@playwright/test'

test('shows the protected Nebula sign-in surface', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Nebula/ })).toBeVisible()
    await expect(page.getByLabel(/帳號|Username/)).toBeVisible()
    await expect(page.getByLabel(/密碼|Password/)).toBeVisible()
})

for (const viewport of [
    { width: 1366, height: 768 },
    { width: 900, height: 600 },
    { width: 480, height: 640 },
    { width: 360, height: 640 }
]) {
    test(`keeps the ${viewport.width}x${viewport.height} login viewport free of page scrolling`, async ({ page }) => {
        await page.setViewportSize(viewport)
        await page.goto('/')

        const metrics = await page.evaluate(() => ({
            viewportHeight: document.documentElement.clientHeight,
            documentHeight: document.scrollingElement?.scrollHeight ?? 0
        }))
        expect(metrics.documentHeight).toBeLessThanOrEqual(metrics.viewportHeight)
        await expect(page.getByLabel(/帳號|Username/)).toBeVisible()
        await expect(page.getByLabel(/密碼|Password/)).toBeVisible()
        await expect(page.getByRole('button', { name: /登入|Sign in/ })).toBeVisible()
    })
}

test('keeps every login control reachable in an extremely short viewport', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 320 })
    await page.goto('/')

    const panel = page.locator('.login-panel')
    const metrics = await panel.evaluate(element => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflowY: getComputedStyle(element).overflowY
    }))
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)
    expect(metrics.overflowY).toBe('auto')

    const submit = page.getByRole('button', { name: /登入|Sign in/ })
    await submit.scrollIntoViewIfNeeded()
    await expect(submit).toBeVisible()
})

test('returns to the sign-in page after logout', async ({ page }) => {
    let loggedIn = true
    await page.addInitScript(() => localStorage.setItem('i18nextLng', 'en'))
    await page.route('**/api/v1/**', async route => {
        const request = route.request()
        const url = new URL(request.url())
        if (url.pathname === '/api/v1/auth/me') {
            if (!loggedIn) {
                await route.fulfill({
                    status: 401,
                    contentType: 'application/problem+json',
                    body: JSON.stringify({ title: 'Unauthorized', status: 401 })
                })
                return
            }
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    user: {
                        id: 'editor-1',
                        username: 'editor',
                        role: 'EDITOR',
                        status: 'ACTIVE',
                        mustChangePassword: false
                    },
                    csrfToken: 'csrf-token'
                })
            })
        } else if (url.pathname === '/api/v1/auth/logout' && request.method() === 'POST') {
            loggedIn = false
            await route.fulfill({ status: 204 })
        } else if (url.pathname === '/api/v1/projects') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ items: [] })
            })
        } else {
            await route.fulfill({
                status: 404,
                contentType: 'application/problem+json',
                body: JSON.stringify({ title: 'Not Found', status: 404 })
            })
        }
    })

    await page.goto('/projects')
    await page.getByRole('button', { name: 'Sign out' }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})
