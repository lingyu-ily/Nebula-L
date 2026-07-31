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
