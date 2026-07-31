import { expect, test } from '@playwright/test'

test('shows the protected Nebula sign-in surface', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Nebula/ })).toBeVisible()
    await expect(page.getByLabel(/帳號|Username/)).toBeVisible()
    await expect(page.getByLabel(/密碼|Password/)).toBeVisible()
})
