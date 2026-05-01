/**
 * Unit tests for the reorder endpoint handler.
 *
 * `reorderNodes` is stubbed via vi.mock so no Payload runtime is loaded.
 * The handler is exercised by extracting the `handler` function from the
 * endpoint object and calling it with a fake `req`.
 *
 * Coverage goals (per issue #24 scope):
 *  1. Happy path → 200 { ok: true }
 *  2. 401 when req.user is null (unauthenticated)
 *  3. Malformed body — missing newIndex → 400 { error: 'invalid request body' }
 *  4. Malformed body — wrong type for nodeId → 400 { error: 'invalid request body' }
 *  5. Helper returns { ok: false, error: 'a node cannot be its own parent' } → 400 forwarded
 *  6. Helper returns { ok: false, error: 'refusing move: would create a cycle' } → 400 forwarded
 *  7. Helper throws → 500 logged to console.error
 *  8. newParentId: null (move to root) → helper called with null
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock reorderNodes BEFORE importing the endpoint
// ---------------------------------------------------------------------------
// vi.mock is hoisted to the top of the file by Vitest. The factory function
// must NOT reference outer variables declared with const/let (temporal dead
// zone). We return a fresh vi.fn() here; the actual spy is accessed via
// vi.mocked(reorderNodes) after import.
vi.mock('../../src/server/helpers/reorderNodes', () => ({
  reorderNodes: vi.fn(),
}))

import { reorderEndpoint } from '../../src/server/endpoints/reorder'
import { reorderNodes } from '../../src/server/helpers/reorderNodes'
import type { ContentTreePluginOptions } from '../../src/shared/types'

// Typed reference to the auto-mock for spy configuration in tests
const mockReorderNodes = vi.mocked(reorderNodes)

// ---------------------------------------------------------------------------
// Type shims
// ---------------------------------------------------------------------------

type Handler = (req: FakeReq) => Promise<Response>

interface FakeUser {
  id: string | number
}

interface FakePayload {
  find: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}

interface FakeReq {
  user: FakeUser | null
  payload: FakePayload
  json: () => Promise<unknown>
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function defaultOpts(overrides: Partial<ContentTreePluginOptions> = {}): ContentTreePluginOptions {
  return {
    collectionSlug: 'pages',
    ...overrides,
  }
}

function makeFakePayload(): FakePayload {
  return {
    find: vi.fn().mockResolvedValue({ docs: [] }),
    update: vi.fn().mockResolvedValue({}),
  }
}

function makeReq(overrides: Partial<FakeReq> & { body?: unknown } = {}): FakeReq {
  const body = overrides.body ?? {
    nodeId: 'node-1',
    newParentId: 'parent-a',
    newIndex: 0,
  }

  return {
    user: overrides.user !== undefined ? overrides.user : { id: 'user-1' },
    payload: overrides.payload ?? makeFakePayload(),
    json: vi.fn().mockResolvedValue(body),
  }
}

async function callHandler(
  opts: ContentTreePluginOptions,
  req: FakeReq,
): Promise<{ status: number; body: unknown }> {
  const endpoint = reorderEndpoint(opts)
  const handler = endpoint.handler as unknown as Handler
  const response = await handler(req)
  const body: unknown = await response.json()
  return { status: response.status, body }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reorderEndpoint', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockReorderNodes.mockReset()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  // ── 1. Happy path ─────────────────────────────────────────────────────────

  it('returns 200 { ok: true } on a successful reorder', async () => {
    mockReorderNodes.mockResolvedValue({ ok: true })

    const { status, body } = await callHandler(
      defaultOpts(),
      makeReq({ body: { nodeId: 'node-1', newParentId: 'parent-a', newIndex: 1 } }),
    )

    expect(status).toBe(200)
    const b = body as { ok: boolean }
    expect(b.ok).toBe(true)
    expect(mockReorderNodes).toHaveBeenCalledOnce()
  })

  // ── 2. Unauthenticated ───────────────────────────────────────────────────

  it('returns 401 when req.user is null', async () => {
    const { status, body } = await callHandler(defaultOpts(), makeReq({ user: null }))

    expect(status).toBe(401)
    const b = body as { error: string }
    expect(b.error).toBe('unauthenticated')

    // reorderNodes should never be called when unauthenticated
    expect(mockReorderNodes).not.toHaveBeenCalled()
  })

  // ── 3. Malformed body — missing newIndex ─────────────────────────────────

  it('returns 400 invalid request body when newIndex is missing', async () => {
    const { status, body } = await callHandler(
      defaultOpts(),
      makeReq({ body: { nodeId: 'node-1', newParentId: 'parent-a' } }),
    )

    expect(status).toBe(400)
    const b = body as { error: string }
    expect(b.error).toBe('invalid request body')
    expect(mockReorderNodes).not.toHaveBeenCalled()
  })

  // ── 4. Malformed body — wrong type for nodeId ────────────────────────────

  it('returns 400 invalid request body when nodeId is null', async () => {
    const { status, body } = await callHandler(
      defaultOpts(),
      makeReq({ body: { nodeId: null, newParentId: 'parent-a', newIndex: 0 } }),
    )

    expect(status).toBe(400)
    const b = body as { error: string }
    expect(b.error).toBe('invalid request body')
    expect(mockReorderNodes).not.toHaveBeenCalled()
  })

  // ── 5. Helper returns validation error: self-parent ──────────────────────

  it('forwards { ok: false, error } from helper as 400', async () => {
    mockReorderNodes.mockResolvedValue({
      ok: false,
      error: 'a node cannot be its own parent',
    })

    const { status, body } = await callHandler(
      defaultOpts(),
      makeReq({ body: { nodeId: 'node-1', newParentId: 'node-1', newIndex: 0 } }),
    )

    expect(status).toBe(400)
    const b = body as { error: string }
    expect(b.error).toBe('a node cannot be its own parent')
  })

  // ── 6. Helper returns validation error: cycle ─────────────────────────────

  it('forwards cycle error from helper as 400', async () => {
    mockReorderNodes.mockResolvedValue({
      ok: false,
      error: 'refusing move: would create a cycle',
    })

    const { status, body } = await callHandler(
      defaultOpts(),
      makeReq({ body: { nodeId: 'node-1', newParentId: 'child-1', newIndex: 0 } }),
    )

    expect(status).toBe(400)
    const b = body as { error: string }
    expect(b.error).toBe('refusing move: would create a cycle')
  })

  // ── 7. Helper throws → 500 ────────────────────────────────────────────────

  it('returns 500 and calls console.error when reorderNodes throws', async () => {
    mockReorderNodes.mockRejectedValue(new Error('DB connection lost'))

    const { status, body } = await callHandler(
      defaultOpts(),
      makeReq({ body: { nodeId: 'node-1', newParentId: 'parent-a', newIndex: 0 } }),
    )

    expect(status).toBe(500)
    const b = body as { error: string }
    expect(b.error).toBe('DB connection lost')
    expect(consoleErrorSpy).toHaveBeenCalledOnce()
  })

  // ── 8. newParentId: null (move to root) ───────────────────────────────────

  it('forwards newParentId: null correctly to reorderNodes', async () => {
    mockReorderNodes.mockResolvedValue({ ok: true })

    const { status } = await callHandler(
      defaultOpts(),
      makeReq({ body: { nodeId: 'node-1', newParentId: null, newIndex: 0 } }),
    )

    expect(status).toBe(200)

    // Verify that reorderNodes was called with newParentId: null
    const callArgs = mockReorderNodes.mock.calls[0][0] as {
      nodeId: string
      newParentId: null
      newIndex: number
    }
    expect(callArgs.newParentId).toBeNull()
    expect(callArgs.nodeId).toBe('node-1')
    expect(callArgs.newIndex).toBe(0)
  })
})
