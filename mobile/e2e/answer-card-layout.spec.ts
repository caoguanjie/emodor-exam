import { expect, test } from '@playwright/test'

for (const width of [320, 414, 440]) {
  test(`answer-card cells remain square with consistent corners at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 956 })
    await page.goto('/mobile/#/pages/exam/take?scenario=exam-single')
    await page.getByRole('radio', { name: '选项 A', exact: true }).click()
    await page.getByRole('button', { name: '打开答题卡', exact: true }).click()
    const cells = page.locator('.answer-card__cell')
    await expect(cells).toHaveCount(20)
    const sizes = await cells.evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect()
      return { width: rect.width, height: rect.height, radius: getComputedStyle(node).borderRadius }
    }))
    for (const size of sizes) {
      expect(Math.abs(size.width - size.height)).toBeLessThan(1)
      expect(Math.abs(size.width - sizes[0]!.width)).toBeLessThan(1)
      expect(size.radius).toBe('12px')
      expect(size.width).toBeGreaterThanOrEqual(44)
    }
    if (width === 414) expect(Math.abs(sizes[0]!.width - 54)).toBeLessThan(1)
    await expect(page.locator('.answer-card')).toBeInViewport({ ratio: 1 })
    await page.screenshot({ path: `/tmp/ruleexam-answer-card-${width}.png` })
    await page.getByRole('button', { name: '跳转第 11 题', exact: true }).click()
    await expect(page.getByText('多选题 · 请选择所有符合的选项')).toBeVisible()
    await page.getByRole('button', { name: '打开答题卡', exact: true }).click()
    await page.getByRole('button', { name: '跳转第 1 题', exact: true }).click()
    await expect(page.getByRole('radio', { name: '选项 A', exact: true })).toHaveAttribute('aria-checked', 'true')
  })
}
