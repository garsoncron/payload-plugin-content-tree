/**
 * Unit tests for the duplicate endpoint handler.
 *
 * `payload.findByID`, `payload.find`, and `payload.create` are mocked —
 * no Payload runtime is loaded. The handler is exercised by extracting the
 * `handler` function from the endpoint object and calling it with a fake `req`.
 *
 * Coverage goals (per issue #20):
 *  1. Happy path: source found → new doc created with ' (copy)' title suffix
 *     and bumped sortOrder (max sibling + 10)
 *  2. Source not found (findByID throws) → 404 { error: 'source not found' }
 *  3. Unauthenticated (no req.user) → 401 { error: 'unauthenticated' }
 *  4. Field-name override: opts.fields.title = 'name' → reads source.name,
 *     writes 'name (copy)' in create data
 *  5. Slug bump: source has slug "foo" → new doc slug is 'foo-copy-<base36>'
 *  6. No siblings → new sortOrder is 0 + 10 = 10
 *  7. payload.create throws → 500 { error: '<message>' } and console.error called
 *  8. Numeric ID in path params is normalised to a number before findByID call
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { duplicateEndpoint } from '../../src/server/endpoints/duplicate'
import type { ContentTreePluginOptions } from '../../src/shared/types'

// ---------------------------------------------------------------------------
// Type shims
// ---------------------------------------------------------------------------

type Handler = (req: FakeReq) => Promise<Response>

interface FakeUser {
  id: string | number
}

interface FakePayload {
  findByID: ReturnType<typeof vi.fn>
  find: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
}

interface FakeReq {
  user: FakeUser | null
  routeParams: Record<string, string>
  payload: FakePayload
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeSourceDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'abc123',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    title: 'My Page',
    slug: 'my-page',
    contentType: 'page',
    parent: null,
    sortOrder: 10,
    ...overrides,
  }
}

function makeSiblingDoc(sortOrder: number): Record<string, unknown> {
  return {
    id: `sibling-${sortOrder}`,
    title: `Sibling ${sortOrder}`,
    contentType: 'page',
    parent: null,
    sortOrder,
  }
}

function defaultOpts(overrides: Partial<ContentTreePluginOptions> = {}): ContentTreePluginOptions {
  return {
    collectionSlug: 'pages',
    fields: { slug: 'slug' },
    ...overrides,
  }
}

function makeFakePayload(options: {
  sourceDoc?: Record<string, unknown> | null
  findByIDThrows?: boolean
  siblings?: Record<string, unknown>[]
  createdDoc?: Record<string, unknown>
  createThrows?: boolean
}): FakePayload {
  const {
    sourceDoc = makeSourceDoc(),
    findByIDThrows = false,
    siblings = [makeSiblingDoc(10)],
    createdDoc = { id: 'new-doc', ...makeSourceDoc() },
    createThrows = false,
  } = options

  return {
    findByID: vi.fn().mockImplementation(() => {
      if (findByIDThrows) return Promise.reject(new Error('Not Found'))
      if (sourceDoc === null) return Promise.resolve(null)
      return Promise.resolve(sourceDoc)
    }),
    find: vi.fn().mockResolvedValue({ docs: siblings }),
    create: vi.fn().mockImplementation(() => {
      if (createThrows) return Promise.reject(new Error('DB write failed'))
      return Promise.resolve(createdDoc)
    }),
  }
}

async function callHandler(
  opts: ContentTreePluginOptions,
  req: FakeReq,
): Promise<{ status: number; body: unknown }> {
  const endpoint = duplicateEndpoint(opts)
  const handler = endpoint.handler as unknown as Handler
  const response = await handler(req)
  const body: unknown = await response.json()
  return { status: response.status, body }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('duplicateEndpoint', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  // 1. Happy path
  it('happy path: creates a doc with title suffix and bumped sortOrder', async () => {
    const siblings = [makeSiblingDoc(10), makeSiblingDoc(20)]
    const payload = makeFakePayload({ siblings })

    const { status, body } = await callHandler(defaultOpts(), {
      user: { id: 'user-1' },
      routeParams: { id: 'abc123' },
      payload,
    })

    expect(status).toBe(200)
    const b = body as { ok: boolean; doc: Record<string, unknown> }
    expect(b.ok).toBe(true)

    // Verify create was called with expected data
    const createArg = payload.create.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(createArg.data['title']).toBe('My Page (copy)')
    // sortOrder should be max(10, 20) + 10 = 30
    expect(createArg.data['sortOrder']).toBe(30)
    // id, createdAt, updatedAt should be stripped
    expect(createArg.data).not.toHaveProperty('id')
    expect(createArg.data).not.toHaveProperty('createdAt')
    expect(createArg.data).not.toHaveProperty('updatedAt')
  })

  // 2. Source not found (findByID throws)
  it('returns 404 when findByID throws (source not found)', async () => {
    const payload = makeFakePayload({ findByIDThrows: true })

    const { status, body } = await callHandler(defaultOpts(), {
      user: { id: 'user-1' },
      routeParams: { id: 'nonexistent' },
      payload,
    })

    expect(status).toBe(404)
    const b = body as { error: string }
    expect(b.error).toBe('source not found')
  })

  // 3. Unauthenticated
  it('returns 401 when req.user is null', async () => {
    const payload = makeFakePayload({})

    const { status, body } = await callHandler(defaultOpts(), {
      user: null,
      routeParams: { id: 'abc123' },
      payload,
    })

    expect(status).toBe(401)
    const b = body as { error: string }
    expect(b.error).toBe('unauthenticated')

    // findByID should never be called when unauthenticated
    expect(payload.findByID).not.toHaveBeenCalled()
  })

  // 4. Field-name override: opts.fields.title = 'name'
  it('respects fields.title override — reads source.name and writes name (copy)', async () => {
    const sourceDoc = makeSourceDoc({ name: 'Custom Name', title: undefined })
    const payload = makeFakePayload({ sourceDoc, siblings: [] })

    const { status } = await callHandler(defaultOpts({ fields: { title: 'name', slug: 'slug' } }), {
      user: { id: 'user-1' },
      routeParams: { id: 'abc123' },
      payload,
    })

    expect(status).toBe(200)
    const createArg = payload.create.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(createArg.data['name']).toBe('Custom Name (copy)')
    // The default 'title' field should not be set with the (copy) suffix
    expect(createArg.data['title']).toBeUndefined()
  })

  // 5. Slug bump
  it('appends -copy-<base36> to the slug when fields.slug is configured', async () => {
    const sourceDoc = makeSourceDoc({ slug: 'my-page' })
    const payload = makeFakePayload({ sourceDoc, siblings: [] })

    const { status } = await callHandler(defaultOpts({ fields: { slug: 'slug' } }), {
      user: { id: 'user-1' },
      routeParams: { id: 'abc123' },
      payload,
    })

    expect(status).toBe(200)
    const createArg = payload.create.mock.calls[0][0] as { data: Record<string, unknown> }
    const newSlug = createArg.data['slug'] as string
    // Should start with 'my-page-copy-' followed by a base36 timestamp
    expect(newSlug).toMatch(/^my-page-copy-[0-9a-z]+$/)
  })

  // 6. No siblings → sortOrder = 10
  it('sets sortOrder to 10 when there are no siblings', async () => {
    const payload = makeFakePayload({ siblings: [] })

    const { status } = await callHandler(defaultOpts(), {
      user: { id: 'user-1' },
      routeParams: { id: 'abc123' },
      payload,
    })

    expect(status).toBe(200)
    const createArg = payload.create.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(createArg.data['sortOrder']).toBe(10)
  })

  // 7. payload.create throws → 500
  it('returns 500 and calls console.error when payload.create throws', async () => {
    const payload = makeFakePayload({ createThrows: true, siblings: [] })

    const { status, body } = await callHandler(defaultOpts(), {
      user: { id: 'user-1' },
      routeParams: { id: 'abc123' },
      payload,
    })

    expect(status).toBe(500)
    const b = body as { error: string }
    expect(b.error).toBe('DB write failed')
    expect(consoleErrorSpy).toHaveBeenCalledOnce()
  })

  // 8. Numeric ID normalisation
  it('passes a numeric id to findByID when the path param looks like an integer', async () => {
    const payload = makeFakePayload({ siblings: [] })

    await callHandler(defaultOpts(), {
      user: { id: 'user-1' },
      routeParams: { id: '42' },
      payload,
    })

    // findByID should be called with numeric 42, not string '42'
    const findByIDCall = payload.findByID.mock.calls[0][0] as { id: number | string }
    expect(findByIDCall.id).toBe(42)
    expect(typeof findByIDCall.id).toBe('number')
  })
})
