import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  // Smoke tests run chromium only. WebKit/Firefox are deferred to Phase 7.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Generate the Payload importMap before booting the dev server so that
    // the ContentTreeView component is resolved at startup, not lazily.
    command:
      'pnpm --filter examples-basic exec payload generate:importmap && pnpm --filter examples-basic dev',
    url: 'http://localhost:3000/admin',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
