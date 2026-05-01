/**
 * Phase 3 gate test (PRD §14, issue #18).
 *
 * Verifies the integrated tree + search feature against a real Payload
 * server with real data:
 *
 *   1. tree-renders-with-data — full tree fetches and renders rows
 *   2. search-finds-and-expands — typing in the search input fires the
 *      search endpoint, the matching row is highlighted, and ancestor
 *      folders are auto-expanded so the match is visible.
 *
 * Fixtures are created via Payload's REST API in `beforeAll` and cleaned
 * up in `afterAll`. The test is idempotent across runs — if a previous
 * run left fixtures behind (afterAll didn't fire), the create-step
 * tolerates duplicates by reading the existing pages back.
 */

import { test, expect, type APIRequestContext } from '@playwright/test'

const BASE_URL = 'http://localhost:3000'
const EMAIL = 'e2e@test.local'
const PASSWORD = 'e2e-pass-12345'

/**
 * The fixture tree we'll seed. Slug fields keep the identifiers stable
 * across runs so cleanup can target them without guessing IDs.
 *
 *   Engineering           (folder)
 *     └── Handbook        (folder)
 *           └── Onboarding Guide  (page) — search target: "Onboarding"
 */
const FIXTURES = [
  { slug: 'e2e-engineering', title: 'Engineering', contentType: 'folder', parentSlug: null },
  { slug: 'e2e-handbook', title: 'Handbook', contentType: 'folder', parentSlug: 'e2e-engineering' },
  {
    slug: 'e2e-onboarding-guide',
    title: 'Onboarding Guide',
    contentType: 'page',
    parentSlug: 'e2e-handbook',
  },
] as const

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
    // Reuse if already there (idempotent across stale runs)
    const existing = await findBySlug(request, f.slug)
    if (existing) {
      slugToId.set(f.slug, existing.id)
      continue
    }
    const parent = f.parentSlug ? slugToId.get(f.parentSlug) : null
    const res = await request.post(`${BASE_URL}/api/pages`, {
      data: {
        title: f.title,
        slug: f.slug,
        contentType: f.contentType,
        parent,
        sortOrder: i,
      },
    })
    if (!res.ok()) {
      throw new Error(`Failed to create fixture "${f.slug}": ${res.status()} ${await res.text()}`)
    }
    const body = (await res.json()) as { doc?: { id: string | number } }
    if (!body.doc) throw new Error(`Create "${f.slug}" returned no doc`)
    slugToId.set(f.slug, body.doc.id)
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
    await request.delete(`${BASE_URL}/api/pages/${id}`)
  }
}

let createdIds: Map<string, string | number>

test.describe('Phase 3 — tree + search', () => {
  test.beforeAll(async ({ request }) => {
    await ensureAuth(request)
    createdIds = await seedFixtures(request)
  })

  test.afterAll(async ({ request }) => {
    if (createdIds) await cleanupFixtures(request, createdIds)
  })

  test('tree-renders-with-data: rows appear after fetch', async ({ page, request }) => {
    await ensureAuth(request)
    await page.goto('/admin/tree')

    // The tree pane is mounted; rows render once /api/tree-pages resolves.
    await expect(page.getByTestId('tree-pane')).toBeVisible()
    // At least the root folder ("Engineering") should be rendered.
    await expect(
      page.getByTestId('content-tree-row').filter({ hasText: 'Engineering' }),
    ).toBeVisible({
      timeout: 10_000,
    })
    // Edit pane shows the empty state until the user picks a node.
    await expect(page.getByTestId('edit-pane-empty')).toBeVisible()
  })

  test('search-finds-and-expands: query auto-expands ancestors and highlights match', async ({
    page,
    request,
  }) => {
    await ensureAuth(request)
    await page.goto('/admin/tree')
    await expect(page.getByTestId('tree-pane')).toBeVisible()

    const searchInput = page.getByTestId('content-tree-search')
    await searchInput.fill('Onboarding')

    // Debounce + fetch + expand. Give it a generous window for slow CI.
    const handbookId = createdIds.get('e2e-handbook')
    const onboardingId = createdIds.get('e2e-onboarding-guide')
    if (handbookId === undefined || onboardingId === undefined) {
      throw new Error('Fixture IDs missing — seeding likely failed.')
    }

    // The matching leaf row should appear (auto-expanded ancestors made it visible).
    await expect(
      page.getByTestId('content-tree-row').filter({ hasText: 'Onboarding Guide' }),
    ).toBeVisible({ timeout: 10_000 })

    // The matching row is highlighted (.ct-row--highlighted class).
    const matchRow = page.locator(
      `[data-testid="content-tree-row"][data-node-id="${String(onboardingId)}"]`,
    )
    await expect(matchRow).toHaveClass(/ct-row--highlighted/)

    // Clearing the search drops the highlight but does not collapse the tree.
    await searchInput.fill('')
    await expect(matchRow).not.toHaveClass(/ct-row--highlighted/, { timeout: 5_000 })
    // Onboarding row remains visible — expand state was not reset.
    await expect(matchRow).toBeVisible()
  })
})
