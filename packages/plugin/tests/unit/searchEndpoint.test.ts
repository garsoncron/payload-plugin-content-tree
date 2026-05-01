/**
 * Unit tests for the search endpoint handler.
 *
 * `payload.find` and `payload.count` are mocked — no Payload runtime is
 * loaded. The handler itself is exercised directly (we extract the `handler`
 * function from the endpoint object and call it with a fake `req`).
 *
 * Coverage goals (per issue #15):
 *  1. empty `q` → 200 empty response
 *  2. whitespace-only `q` → 200 empty response
 *  3. single-char `q` → 200 empty response
 *  4. query too long (> 200 chars) → 400 { error: 'query too long' }
 *  5. valid `q` returns matches → correct shape, correct total
 *  6. expandIds dedup: 2 matches sharing an ancestor → ancestor appears once
 *  7. ancestor-fetch round-trip: match set has parents not in results → second
 *     payload.find is called and those ancestors appear in expandIds
 *  8. title-only search when fields.slug unset → `where` has no slug branch
 *  9. title + slug search when fields.slug = 'urlPath' → both branches present
 * 10. result truncation: payload.find returns 50 docs → results.length === 50, total === 50
 * 11. payload.find throws → 500 { error: ... } and console.error called
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { searchEndpoint } from '../../src/server/endpoints/search'
import type { ContentTreePluginOptions, TreeNode } from '../../src/shared/types'

// ---------------------------------------------------------------------------
// Type shims for the endpoint handler
// ---------------------------------------------------------------------------

type Handler = (req: FakeReq) => Promise<Response>

interface FakeReq {
  url: string
  payload: FakePayload
}

interface FakePayload {
  find: ReturnType<typeof vi.fn>
  count: ReturnType<typeof vi.fn>
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeDoc(
  id: string | number,
  parentId: string | number | null,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    title: `Page ${String(id)}`,
    contentType: 'page',
    parent: parentId,
    sortOrder: 0,
    ...extra,
  }
}

function defaultOpts(overrides: Partial<ContentTreePluginOptions> = {}): ContentTreePluginOptions {
  return {
    collectionSlug: 'pages',
    ...overrides,
  }
}

/**
 * Build a minimal fake Payload instance.
 *
 * `findCalls` is a queue: the first call to `payload.find` returns
 * `findCalls[0]`, the second returns `findCalls[1]`, etc.
 * If the queue is exhausted, subsequent calls return `{ docs: [] }`.
 *
 * `countResult` is returned for every `payload.count` call (default 0).
 */
function makeFakePayload(options: {
  findCalls?: { docs: Record<string, unknown>[]; totalDocs?: number }[]
  countResult?: number
}): FakePayload {
  const queue = [...(options.findCalls ?? [])]

  return {
    find: vi.fn().mockImplementation(() => {
      const next = queue.shift()
      return Promise.resolve(next ?? { docs: [] })
    }),
    count: vi.fn().mockResolvedValue({ totalDocs: options.countResult ?? 0 }),
  }
}

/**
 * Extract and call the endpoint handler.
 *
 * The endpoint object is created fresh via `searchEndpoint(opts)` so we get
 * a real closure over `opts`. We then call `handler(fakeReq)` directly.
 */
async function callHandler(
  opts: ContentTreePluginOptions,
  payload: FakePayload,
  q: string | null,
): Promise<Response> {
  const endpoint = searchEndpoint(opts)
  const handler = endpoint.handler as Handler

  const qs = q !== null ? `?q=${encodeURIComponent(q)}` : ''
  const req: FakeReq = {
    url: `http://localhost/api/tree-pages/search${qs}`,
    payload,
  }

  return handler(req)
}

// ---------------------------------------------------------------------------
// Silence console.error in the "throws" test
// ---------------------------------------------------------------------------

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
    /* noop */
  })
})

afterEach(() => {
  errorSpy.mockRestore()
})

// ---------------------------------------------------------------------------
// 1. Empty `q`
// ---------------------------------------------------------------------------

describe('searchEndpoint — empty q', () => {
  it('returns 200 empty response when q is an empty string', async () => {
    const payload = makeFakePayload({})
    const res = await callHandler(defaultOpts(), payload, '')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { results: TreeNode[]; expandIds: unknown[]; total: number }
    expect(body.results).toEqual([])
    expect(body.expandIds).toEqual([])
    expect(body.total).toBe(0)
    // Should NOT hit the DB
    expect(payload.find).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 2. Whitespace-only `q`
// ---------------------------------------------------------------------------

describe('searchEndpoint — whitespace-only q', () => {
  it('returns 200 empty response for whitespace-only q', async () => {
    const payload = makeFakePayload({})
    const res = await callHandler(defaultOpts(), payload, '   ')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { results: unknown[] }
    expect(body.results).toEqual([])
    expect(payload.find).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 3. Single-char `q`
// ---------------------------------------------------------------------------

describe('searchEndpoint — single-char q', () => {
  it('returns 200 empty response for a single-character query', async () => {
    const payload = makeFakePayload({})
    const res = await callHandler(defaultOpts(), payload, 'a')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { results: unknown[] }
    expect(body.results).toEqual([])
    expect(payload.find).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 4. Query too long
// ---------------------------------------------------------------------------

describe('searchEndpoint — query too long', () => {
  it('returns 400 with { error: "query too long" } when q > 200 chars', async () => {
    const payload = makeFakePayload({})
    const longQ = 'a'.repeat(201)
    const res = await callHandler(defaultOpts(), payload, longQ)

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('query too long')
    expect(payload.find).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 5. Valid q returns matches → correct shape and total
// ---------------------------------------------------------------------------

describe('searchEndpoint — valid q with matches', () => {
  it('returns matched nodes with correct TreeNode shape and total', async () => {
    const doc = makeDoc('page-1', null)
    const payload = makeFakePayload({
      findCalls: [
        // First call: match query
        { docs: [doc] },
        // Second call: ancestor fetch (no ancestors needed — parent is null)
      ],
      countResult: 0,
    })

    const res = await callHandler(defaultOpts(), payload, 'Page')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { results: TreeNode[]; expandIds: unknown[]; total: number }

    expect(body.total).toBe(1)
    expect(body.results).toHaveLength(1)

    const node = body.results[0]!
    expect(node.id).toBe('page-1')
    expect(node.title).toBe('Page page-1')
    expect(node.contentType).toBe('page')
    expect(node.parent).toBeNull()
    expect(typeof node.hasChildren).toBe('boolean')
    // children should NOT be present on search results
    expect(node.children).toBeUndefined()

    // No ancestors → expandIds empty
    expect(body.expandIds).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 6. expandIds dedup: 2 matches sharing an ancestor
// ---------------------------------------------------------------------------

describe('searchEndpoint — expandIds dedup', () => {
  it('deduplicates ancestor IDs when two matches share the same ancestor', async () => {
    const ancestor = makeDoc('ancestor', null)
    const child1 = makeDoc('child-1', 'ancestor')
    const child2 = makeDoc('child-2', 'ancestor')

    const payload = makeFakePayload({
      findCalls: [
        // First call: match query returns both children
        { docs: [child1, child2] },
        // Second call: ancestor fetch for 'ancestor'
        { docs: [ancestor] },
        // Third call: ancestor of 'ancestor' (parent is null, nothing to fetch)
        // (our loop will exit after one successful fetch since ancestor.parent = null)
      ],
      countResult: 0,
    })

    const res = await callHandler(defaultOpts(), payload, 'child')
    const body = (await res.json()) as { expandIds: (string | number)[] }

    // 'ancestor' should appear exactly once even though both matches share it
    expect(body.expandIds.filter((id) => id === 'ancestor')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 7. Ancestor-fetch round-trip
// ---------------------------------------------------------------------------

describe('searchEndpoint — ancestor fetch round-trip', () => {
  it('fetches missing parent docs and includes their IDs in expandIds', async () => {
    // Match: child whose parent is not in the result set
    const child = makeDoc('child', 'parent-not-in-results')
    const parentDoc = makeDoc('parent-not-in-results', null)

    const payload = makeFakePayload({
      findCalls: [
        // First call: the search match
        { docs: [child] },
        // Second call: ancestor fetch — returns the parent
        { docs: [parentDoc] },
        // Third call: ancestor of parentDoc (parent is null — nothing to return)
        { docs: [] },
      ],
      countResult: 0,
    })

    const res = await callHandler(defaultOpts(), payload, 'child')
    const body = (await res.json()) as { expandIds: (string | number)[] }

    expect(body.expandIds).toContain('parent-not-in-results')
  })
})

// ---------------------------------------------------------------------------
// 8. Title-only search when fields.slug is unset
// ---------------------------------------------------------------------------

describe('searchEndpoint — title-only where clause', () => {
  it('builds a where clause with only the title branch when fields.slug is not set', async () => {
    const doc = makeDoc('p1', null)
    const payload = makeFakePayload({
      findCalls: [{ docs: [doc] }],
      countResult: 0,
    })

    // No fields.slug configured
    await callHandler(defaultOpts(), payload, 'home')

    const findCall = payload.find.mock.calls[0] as [{ where: { or: unknown[] } }][]
    const whereClause = findCall[0]!.where
    // Should have exactly 1 branch in `or` (title only)
    expect(whereClause.or).toHaveLength(1)
    expect(Object.keys(whereClause.or[0]!)).toEqual(['title'])
  })
})

// ---------------------------------------------------------------------------
// 9. Title + slug search when fields.slug = 'urlPath'
// ---------------------------------------------------------------------------

describe('searchEndpoint — title + slug where clause', () => {
  it('builds a where clause with title AND renamed slug branch', async () => {
    const doc = makeDoc('p1', null, { urlPath: '/home' })
    const payload = makeFakePayload({
      findCalls: [{ docs: [doc] }],
      countResult: 0,
    })

    await callHandler(defaultOpts({ fields: { slug: 'urlPath' } }), payload, 'home')

    const findCall = payload.find.mock.calls[0] as [{ where: { or: unknown[] } }][]
    const whereClause = findCall[0]!.where
    // Should have 2 branches: title + urlPath
    expect(whereClause.or).toHaveLength(2)

    const fieldNames = (whereClause.or as Record<string, unknown>[]).map(
      (clause) => Object.keys(clause)[0],
    )
    expect(fieldNames).toContain('title')
    expect(fieldNames).toContain('urlPath')
  })
})

// ---------------------------------------------------------------------------
// 10. Result truncation — 50 docs in, 50 out
// ---------------------------------------------------------------------------

describe('searchEndpoint — result truncation', () => {
  it('returns exactly 50 results and total=50 when payload returns 50 docs', async () => {
    // Generate 50 docs (the max Payload is asked for)
    const docs = Array.from({ length: 50 }, (_, i) => makeDoc(`p-${i}`, null))
    const payload = makeFakePayload({
      findCalls: [{ docs, totalDocs: 50 }],
      countResult: 0,
    })

    const res = await callHandler(defaultOpts(), payload, 'page')
    const body = (await res.json()) as { results: unknown[]; total: number }

    expect(body.results).toHaveLength(50)
    expect(body.total).toBe(50)
  })
})

// ---------------------------------------------------------------------------
// 11. payload.find throws → 500
// ---------------------------------------------------------------------------

describe('searchEndpoint — payload.find throws', () => {
  it('returns 500 with { error: message } and logs via console.error', async () => {
    const payload = makeFakePayload({})
    payload.find.mockRejectedValue(new Error('DB is down'))

    const res = await callHandler(defaultOpts(), payload, 'anything')

    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('DB is down')
    expect(errorSpy).toHaveBeenCalledOnce()
  })
})
