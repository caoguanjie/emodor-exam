import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // The real-API critical chain is owned by the mobile-h5 runner. Keep it out
  // of the ordinary mobile browser suite unless the runner opts in explicitly.
  testIgnore: process.env.MOBILE_E2E_CRITICAL === '1' ? [] : ['**/critical-*.spec.ts'],
  outputDir: './dist/test-results',
  reporter: 'list',
  use: {
    baseURL: process.env.MOBILE_E2E_BASE_URL || 'http://127.0.0.1:5174',
    browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_CHANNEL as 'chrome' | undefined,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: process.env.MOBILE_E2E_BASE_URL ? undefined : {
    command: 'npm run dev:h5 -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: !process.env.CI,
  },
})
