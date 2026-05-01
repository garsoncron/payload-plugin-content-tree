/**
 * Accessibility gate test — Phase 7 (PRD §14, issue #32).
 *
 * Asserts zero axe-core violations on the rendered content-tree view.
 *
 * Scope design:
 *   `.include('[data-testid="page-content-tree"]')` limits the axe scan to
 *   the plugin's own DOM. Payload's admin chrome (sidebar, navbar, etc.) is
 *   deliberately excluded — a11y issues in Payload's shell are not this
 *   plugin's concern to gate.
 *
 * Fixtures:
 *   2-3 pages are seeded so axe sees a populated tree (not just the empty
 *   state). Uses the `e2e-a11y-` slug prefix to avoid collisions with other
 *   suites. Seeds in beforeAll, tears down in afterAll. If seeding fails the
 *   test still runs on whatever content is already in the DB.
 *
 * Auth:
 *   Same REST-API pattern as admin-smoke.spec.ts — POST /api/users/first-register
 *   (fresh DB), fall back to POST /api/users/login.
 */

import { test, expect, type APIRequestContext } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// ─── Auth config ──────────────────────────────────────────────────────────────

const BASE_URL = 'http://localhost:3000'
const EMAIL = 'e2e@test.local'
const PASSWORD = 'e2e-pass-12345'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * Small fixture tree so axe sees rendered rows, not just the empty-state div.
 *
 *   Company          (folder)
 *     └── About Us   (page)
 *     └── Products   (page)
 */
const FIXTURES = [
  { slug: 'e2e-a11y-company', title: 'Company', contentType: 'folder', parentSlug: null },
  {
    slug: 'e2e-a11y-about',
    title: 'About Us',
    contentType: 'page',
    parentSlug: 'e2e-a11y-company',
  },
  {
    slug: 'e2e-a11y-products',
    title: 'Products',
    contentType: 'page',
    parentSlug: 'e2e-a11y-company',
  },
] as const

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function ensureAuth(request: APIRequestContext): Promise<void> {
  const reg = await request.post(`${BASE_URL}/api/users/first-register`, {
    data: { email: EMAIL, password: PASSWORD },
  })
  if (reg.ok()) return

  const login = await request.post(`${BASE_URL}/api/users/login`, {
    data: { email: EMAIL, password: PASSWORD },
  })
  if (!login.ok()) {
    throw new Error(`Login failed: ${login.status()} ${await login.text()}`)
  }
}

/** Look up an existing fixture page by slug. Returns null if not present. */
async function findBySlug(
  request: APIRequestContext,
  slug: string,
): Promise<{ id: string | number } | null> {
  const res = await request.get(
    `${BASE_URL}/api/pages?where[slug][equals]=${encodeURIComponent(slug)}&limit=1`,
  )
  if (!res.ok()) return null
  const body = (await res.json()) as { docs?: Array<{ id: string | number }> }
  return body.docs?.[0] ?? null
}

async function seedFixtures(request: APIRequestContext): Promise<Map<string, string | number>> {
  const slugToId = new Map<string, string | number>()

  for (const [i, f] of FIXTURES.entries()) {
    // Reuse existing docs so the test is idempotent across stale runs.
    const existing = await findBySlug(request, f.slug)
    if (existing) {
      slugToId.set(f.slug, existing.id)
      continue
    }

    const parent = f.parentSlug !== null ? slugToId.get(f.parentSlug) : null
    const res = await request.post(`${BASE_URL}/api/pages`, {
      data: {
        title: f.title,
        slug: f.slug,
        contentType: f.contentType,
        parent: parent ?? null,
        sortOrder: i * 10,
      },
    })

    if (!res.ok()) {
      // Graceful degradation: log and continue — the axe test will still run
      // on whatever is in the DB.
      console.warn(`[a11y] Could not seed fixture "${f.slug}": ${res.status()} ${await res.text()}`)
      continue
    }

    const body = (await res.json()) as { doc?: { id: string | number } }
    if (body.doc) slugToId.set(f.slug, body.doc.id)
  }

  return slugToId
}

async function cleanupFixtures(
  request: APIRequestContext,
  slugToId: Map<string, string | number>,
): Promise<void> {
  // Delete leaves first to avoid relationship constraint errors.
  const reverse = [...FIXTURES].reverse()
  for (const f of reverse) {
    const id = slugToId.get(f.slug)
    if (id === undefined) continue
    // Best-effort cleanup — if this fails, the next run's seed step is idempotent.
    await request.delete(`${BASE_URL}/api/pages/${id}`)
  }
}

// ─── Module-level state ───────────────────────────────────────────────────────

let seededIds: Map<string, string | number>

// ─── Test suite ───────────────────────────────────────────────────────────────

test.describe('a11y — content-tree view', () => {
  test.beforeAll(async ({ request }) => {
    // Auth first, then seed. Graceful: if auth or seed fails the test still
    // runs — it just may see an empty tree or the login redirect.
    try {
      await ensureAuth(request)
      seededIds = await seedFixtures(request)
    } catch (err) {
      console.warn('[a11y] beforeAll setup error (test will still run):', err)
      seededIds = new Map()
    }
  })

  test.afterAll(async ({ request }) => {
    if (!seededIds || seededIds.size === 0) return
    try {
      await ensureAuth(request)
      await cleanupFixtures(request, seededIds)
    } catch (err) {
      console.warn('[a11y] afterAll cleanup error:', err)
    }
  })

  test('zero axe-core violations on the rendered tree view', async ({ page, request }) => {
    // Re-auth so the page session is valid.
    await ensureAuth(request)

    // Navigate to the tree view and wait for the plugin root to mount.
    await page.goto('/admin/tree')
    await expect(page.getByTestId('page-content-tree')).toBeVisible({ timeout: 15_000 })

    // Wait for the tree pane to settle (data fetch resolves or empty-state shows).
    // Either tree-loading disappears or tree-pane is visible.
    await expect(page.getByTestId('tree-pane')).toBeVisible({ timeout: 10_000 })

    // ── axe scan (scoped to the plugin's own DOM) ──────────────────────────
    //
    // .include('[data-testid="page-content-tree"]') restricts the scan to the
    // plugin's rendered subtree. Payload's admin sidebar, topbar, and other
    // chrome are excluded — violations there are not this plugin's responsibility.
    const results = await new AxeBuilder({ page })
      .include('[data-testid="page-content-tree"]')
      .analyze()

    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
  })
})
