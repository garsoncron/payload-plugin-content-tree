/**
 * Smoke test: admin boots and /admin/tree mounts.
 *
 * Covers Phase 1 gate (PRD §14, issue #9).
 *
 * Idempotency strategy: use Payload's REST auth API directly rather than
 * the UI form. This avoids flakiness from translation string differences
 * and React hydration timing.
 *
 *   1. Try POST /api/users/first-register (fresh DB)
 *   2. If that fails (409 or user exists), try POST /api/users/login
 *   3. Set the payload-token cookie on the page so the admin considers
 *      the browser authenticated.
 *
 * The test does NOT delete dev.db — it's idempotent across runs.
 */

import { test, expect } from '@playwright/test'

const EMAIL = 'e2e@test.local'
const PASSWORD = 'e2e-pass-12345'

/**
 * Ensure the test user exists and return a valid Payload auth token.
 * Uses page.request so any Set-Cookie headers are shared with the browser.
 */
async function ensureAuthCookie(
  request: Parameters<Parameters<typeof test>[1]>[0]['request'],
  baseURL: string,
): Promise<string> {
  // Attempt first-user registration (works on a fresh DB)
  const registerRes = await request.post(`${baseURL}/api/users/first-register`, {
    data: { email: EMAIL, password: PASSWORD },
  })

  if (registerRes.ok()) {
    const body = (await registerRes.json()) as { token?: string }
    if (body.token) return body.token
  }

  // If registration failed (user already exists), log in instead
  const loginRes = await request.post(`${baseURL}/api/users/login`, {
    data: { email: EMAIL, password: PASSWORD },
  })
  if (!loginRes.ok()) {
    throw new Error(`Login failed: ${loginRes.status()} ${await loginRes.text()}`)
  }
  const body = (await loginRes.json()) as { token?: string }
  if (!body.token) throw new Error('Login response missing token')
  return body.token
}

test('smoke: admin boots and /admin/tree mounts', async ({ page, request }) => {
  const baseURL = 'http://localhost:3000'

  // Collect page-level JS errors and console errors before any navigation.
  const pageErrors: Error[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (err) => pageErrors.push(err))
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  // ── Step 1: authenticate via REST API ─────────────────────────────────
  // page.request shares cookies with the page context, so any Set-Cookie
  // from the login response will apply to subsequent page.goto() calls.
  await ensureAuthCookie(request, baseURL)

  // ── Step 2: navigate to /admin ─────────────────────────────────────────
  // With a valid session cookie set, this should land on the dashboard.
  await page.goto('/admin')
  await page.waitForLoadState('domcontentloaded')
  // After auth, Payload should redirect away from login/create-first-user
  const adminUrl = page.url()
  expect(adminUrl, 'Expected /admin dashboard, not a redirect to auth page').not.toContain('/login')
  expect(adminUrl).not.toContain('/create-first-user')

  // ── Step 3: navigate to /admin/tree ───────────────────────────────────
  await page.goto('/admin/tree')
  await page.waitForLoadState('domcontentloaded')

  // ── Step 4: assert the view mounted ───────────────────────────────────
  // URL must settle on /admin/tree (not redirect to login or an error page)
  await expect(page).toHaveURL(/\/admin\/tree/)

  // The stub ContentTreeView renders this sentinel element (ContentTreeView.tsx).
  await expect(page.getByTestId('page-content-tree')).toBeVisible({ timeout: 15_000 })

  // ── Step 5: no JS errors ──────────────────────────────────────────────
  expect(
    pageErrors,
    `Unexpected page errors: ${pageErrors.map((e) => e.message).join(', ')}`,
  ).toHaveLength(0)
  expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join(', ')}`).toHaveLength(0)
})
