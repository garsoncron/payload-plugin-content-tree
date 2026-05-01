/**
 * Unit tests for reorderNodes.
 *
 * `payload.find` and `payload.update` are mocked — no Payload runtime is
 * loaded. Tests are hermetic and fast.
 *
 * Coverage (per issue #21 scope):
 *  1.  Happy path: move node to existing parent at index 1 → moved node
 *      updated, siblings re-numbered, returns { ok: true }
 *  2.  Move to root (newParentId: null) → parentField updated to null
 *  3.  Self-parent: nodeId === newParentId → { ok: false, error: 'a node …' }
 *  4.  Cycle detection → { ok: false, error: 'refusing move: would create a cycle' }
 *  5.  Node not found → { ok: false, error: 'node <id> not found' }
 *  6.  Ancestor-walk depth cap exceeded → { ok: false, error: 'ancestor walk exceeded depth cap' }
 *  7a. newIndex = -1  → clamped to 0 (node gets sortOrder 0)
 *  7b. newIndex = 999 → clamped to siblings.length
 *  8.  Field-name override: fields.parent = 'parentDoc' → updates use parentDoc
 *  9.  Old + new parent both re-numbered when changing parent
 * 10.  maxDepth: move that would exceed maxDepth → { ok: false, error: /maxDepth/ }
 * 11.  payload.update throws → error propagates (re-thrown)
 */

import { describe, it, expect, vi } from 'vitest'
import { reorderNodes } from '../../src/server/helpers/reorderNodes'
import type { ReorderNodesArgs } from '../../src/server/helpers/reorderNodes'
import type { ContentTreePluginOptions } from '../../src/shared/types'

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

/**
 * A doc record as returned at `depth: 0` from a `payload.find` call.
 */
type MockDoc = Record<string, unknown>

/**
 * Build a minimal mock `Payload` instance whose `find` and `update` methods
 * are vi.fn() spies.
 *
 * `findResponses` maps a JSON-serialised `where` clause to the docs that
 * `payload.find` should return. If no match is found for a given call, the
 * mock returns `{ docs: [], totalDocs: 0 }`.
 *
 * `updateSpy` is a plain vi.fn() that resolves with the data passed in.
 */
function makeMockPayload(findResponses: Array<{ docs: MockDoc[] }> = []) {
  let callCount = 0

  const find = vi.fn().mockImplementation(() => {
    const response = findResponses[callCount] ?? { docs: [], totalDocs: 0 }
    callCount++
    return Promise.resolve({
      docs: response.docs,
      totalDocs: response.docs.length,
    })
  })

  const update = vi.fn().mockResolvedValue({})

  return { find, update }
}

// ---------------------------------------------------------------------------
// Doc factories
// ---------------------------------------------------------------------------

function makeDoc(
  id: string | number,
  parentId: string | number | null,
  sortOrder = 0,
  extra: Record<string, unknown> = {},
): MockDoc {
  return { id, parent: parentId, sortOrder, title: `Node ${String(id)}`, ...extra }
}

// ---------------------------------------------------------------------------
// Arg builder
// ---------------------------------------------------------------------------

function defaultArgs(
  overrides: Partial<ReorderNodesArgs> & Pick<ReorderNodesArgs, 'payload'>,
): ReorderNodesArgs {
  return {
    collectionSlug: 'pages',
    fields: {} satisfies NonNullable<ContentTreePluginOptions['fields']>,
    nodeId: 'node-1',
    newParentId: 'parent-a',
    newIndex: 0,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1. Happy path: move node to an existing parent at index 1
// ---------------------------------------------------------------------------

describe('reorderNodes — happy path', () => {
  it('moves the node, re-numbers siblings, and returns { ok: true }', async () => {
    // find call sequence (in order of invocation by the implementation):
    //  0: findDocById(nodeId)         → the moved node (parent: 'parent-b')
    //  1: walkAncestors - findDocById('parent-a') → parent-a doc (parent: null) — ends walk
    //  2: fetchSiblings(newParent='parent-a') → [sibling-x (sort 0), sibling-y (sort 10)]
    //  3: fetchSiblings(oldParent='parent-b') → [sibling-z (sort 0)]  (parent changed)
    //  (subtreeHeight BFS for no maxDepth — not called)

    const movedDoc = makeDoc('node-1', 'parent-b', 5)
    const parentADoc = makeDoc('parent-a', null, 0)
    const newParentSiblings: MockDoc[] = [
      makeDoc('sibling-x', 'parent-a', 0),
      makeDoc('sibling-y', 'parent-a', 10),
    ]
    const oldParentSiblings: MockDoc[] = [makeDoc('sibling-z', 'parent-b', 0)]

    // find call sequence (in order of invocation):
    //  0: findDocById('node-1')        → movedDoc
    //  1: walkAncestors findDocById('parent-a') → parentADoc (parent: null) — walk ends, depthFromStart=1
    //  2: fetchSiblings(newParent='parent-a')   → [sibling-x, sibling-y]
    //  3: fetchSiblings(oldParent='parent-b')   → [sibling-z]
    const payload = makeMockPayload([
      { docs: [movedDoc] }, // findDocById(nodeId)
      { docs: [parentADoc] }, // walkAncestors: look up parent-a (its parent is null → done)
      { docs: newParentSiblings }, // fetchSiblings(newParent)
      { docs: oldParentSiblings }, // fetchSiblings(oldParent)
    ])

    const result = await reorderNodes(
      defaultArgs({
        payload: payload as unknown as ReorderNodesArgs['payload'],
        nodeId: 'node-1',
        newParentId: 'parent-a',
        newIndex: 1, // insert at position 1 between sibling-x and sibling-y
      }),
    )

    expect(result).toEqual({ ok: true })

    // The moved node should be updated with new parent + sortOrder = 1 * 10 = 10
    const updateCalls = payload.update.mock.calls
    const movedNodeUpdate = updateCalls.find((call) => call[0].id === 'node-1')
    expect(movedNodeUpdate).toBeDefined()
    expect(movedNodeUpdate![0].data['parent']).toBe('parent-a')
    expect(movedNodeUpdate![0].data['sortOrder']).toBe(10) // index 1 * 10

    // sibling-x was at position 0 (before insert) → stays at 0 * 10 = 0 (no change, not in updates)
    // sibling-y was at position 1, now shifted to position 2 → 2 * 10 = 20
    const siblingYUpdate = updateCalls.find((call) => call[0].id === 'sibling-y')
    expect(siblingYUpdate).toBeDefined()
    expect(siblingYUpdate![0].data['sortOrder']).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// 2. Move to root (newParentId: null)
// ---------------------------------------------------------------------------

describe('reorderNodes — move to root', () => {
  it('sets parentField to null on the moved node', async () => {
    const movedDoc = makeDoc('node-1', 'parent-a', 0)
    const rootSiblings: MockDoc[] = [makeDoc('existing-root', null, 0)]
    const oldParentSiblings: MockDoc[] = []

    // No ancestor walk when newParentId is null
    const payload = makeMockPayload([
      { docs: [movedDoc] }, // findDocById(nodeId)
      { docs: rootSiblings }, // fetchSiblings(newParent=null)
      { docs: oldParentSiblings }, // fetchSiblings(oldParent='parent-a')
    ])

    const result = await reorderNodes(
      defaultArgs({
        payload: payload as unknown as ReorderNodesArgs['payload'],
        nodeId: 'node-1',
        newParentId: null,
        newIndex: 0,
      }),
    )

    expect(result).toEqual({ ok: true })

    const updateCalls = payload.update.mock.calls
    const movedNodeUpdate = updateCalls.find((call) => call[0].id === 'node-1')
    expect(movedNodeUpdate).toBeDefined()
    expect(movedNodeUpdate![0].data['parent']).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 3. Self-parent rejection
// ---------------------------------------------------------------------------

describe('reorderNodes — self-parent', () => {
  it('returns { ok: false } when nodeId === newParentId', async () => {
    const movedDoc = makeDoc('node-1', null, 0)

    const payload = makeMockPayload([
      { docs: [movedDoc] }, // findDocById(nodeId)
    ])

    const result = await reorderNodes(
      defaultArgs({
        payload: payload as unknown as ReorderNodesArgs['payload'],
        nodeId: 'node-1',
        newParentId: 'node-1', // same as nodeId
        newIndex: 0,
      }),
    )

    expect(result).toEqual({ ok: false, error: 'a node cannot be its own parent' })
    // No updates should have been issued
    expect(payload.update).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 4. Cycle detection
// ---------------------------------------------------------------------------

describe('reorderNodes — cycle detection', () => {
  it('returns { ok: false } when moving a parent under its own descendant', async () => {
    // Tree: root → parent-a → child-b
    // Move: parent-a to be a child of child-b (would create a cycle)
    //
    // nodeId = 'parent-a', newParentId = 'child-b'
    // Ancestor walk from child-b: child-b → parent → 'parent-a' (FOUND → cycle)

    const movedDoc = makeDoc('parent-a', 'root', 0)
    const childBDoc = makeDoc('child-b', 'parent-a', 0) // child-b's parent IS parent-a

    const payload = makeMockPayload([
      { docs: [movedDoc] }, // findDocById('parent-a')
      { docs: [childBDoc] }, // walkAncestors: look up 'child-b' — its parent is 'parent-a'
      // walkAncestors sees parent-a's id matches nodeId → cycleFound (no more calls)
    ])

    const result = await reorderNodes(
      defaultArgs({
        payload: payload as unknown as ReorderNodesArgs['payload'],
        nodeId: 'parent-a',
        newParentId: 'child-b',
        newIndex: 0,
      }),
    )

    expect(result).toEqual({ ok: false, error: 'refusing move: would create a cycle' })
    expect(payload.update).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 5. Node not found
// ---------------------------------------------------------------------------

describe('reorderNodes — node not found', () => {
  it('returns { ok: false, error: "node <id> not found" } when the node does not exist', async () => {
    const payload = makeMockPayload([
      { docs: [] }, // findDocById returns nothing
    ])

    const result = await reorderNodes(
      defaultArgs({
        payload: payload as unknown as ReorderNodesArgs['payload'],
        nodeId: 'ghost-99',
        newParentId: 'parent-a',
        newIndex: 0,
      }),
    )

    expect(result).toEqual({ ok: false, error: 'node ghost-99 not found' })
    expect(payload.update).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 6. Ancestor-walk depth cap exceeded
// ---------------------------------------------------------------------------

describe('reorderNodes — ancestor walk depth cap', () => {
  it('returns { ok: false } when the ancestor chain exceeds the walk cap', async () => {
    // Build a chain of documents: p1 → p2 → p3 → … → p60
    // where each pN has parent pN+1. The walk cap defaults to 50.
    // We set maxDepth: 3 so the cap becomes 3 for cleaner test setup.
    // But then we need 4+ levels. Let's use maxDepth: 2 → cap = 2.
    //
    // Chain: newParentId = 'p1', p1.parent = 'p2', p2.parent = 'p3', …
    // With cap = 2, after walking p1 and p2 we still have a non-null current
    // id (p3) but steps === cap → capExceeded.

    const movedDoc = makeDoc('node-moved', null, 0)
    // Ancestor chain of length 3 (exceeds cap of 2):
    const p1Doc = makeDoc('p1', 'p2', 0) // walk step 0: starting node p1
    const p2Doc = makeDoc('p2', 'p3', 0) // walk step 1
    // p3 still has a parent, but steps === cap (2) → capExceeded

    const payload = makeMockPayload([
      { docs: [movedDoc] }, // findDocById('node-moved')
      { docs: [p1Doc] }, // walkAncestors: look up 'p1'
      { docs: [p2Doc] }, // walkAncestors: look up 'p2'
      // After step 2, currentId = 'p3', steps = 2 = cap → return capExceeded
    ])

    const result = await reorderNodes(
      defaultArgs({
        payload: payload as unknown as ReorderNodesArgs['payload'],
        nodeId: 'node-moved',
        newParentId: 'p1',
        newIndex: 0,
        maxDepth: 2, // also sets walk cap to 2
      }),
    )

    expect(result).toEqual({ ok: false, error: 'ancestor walk exceeded depth cap' })
    expect(payload.update).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 7a. newIndex clamped when negative
// ---------------------------------------------------------------------------

describe('reorderNodes — newIndex clamping (negative)', () => {
  it('clamps newIndex = -1 to 0, placing the node first', async () => {
    const movedDoc = makeDoc('node-1', null, 99) // currently at root
    const parentADoc = makeDoc('parent-a', null, 0)
    const siblings: MockDoc[] = [makeDoc('sib-1', 'parent-a', 0)]

    // find call sequence:
    //  0: findDocById('node-1') → movedDoc (parent: null)
    //  1: walkAncestors: findDocById('parent-a') → parentADoc (parent: null) — done, depthFromStart=1
    //  2: fetchSiblings(newParent='parent-a')    → [sib-1]
    //  3: fetchSiblings(oldParent=null)          → [] (same parent check: null !== parent-a → different)
    const payload = makeMockPayload([
      { docs: [movedDoc] }, // findDocById
      { docs: [parentADoc] }, // walkAncestors: parent-a has no parent → done
      { docs: siblings }, // fetchSiblings(newParent='parent-a')
      { docs: [] }, // fetchSiblings(oldParent=null)
    ])

    const result = await reorderNodes(
      defaultArgs({
        payload: payload as unknown as ReorderNodesArgs['payload'],
        nodeId: 'node-1',
        newParentId: 'parent-a',
        newIndex: -1, // should clamp to 0
      }),
    )

    expect(result).toEqual({ ok: true })

    const movedUpdate = payload.update.mock.calls.find((c) => c[0].id === 'node-1')
    expect(movedUpdate).toBeDefined()
    expect(movedUpdate![0].data['sortOrder']).toBe(0) // 0 * 10
  })
})

// ---------------------------------------------------------------------------
// 7b. newIndex clamped when too large
// ---------------------------------------------------------------------------

describe('reorderNodes — newIndex clamping (too large)', () => {
  it('clamps newIndex = 999 to siblings.length', async () => {
    const movedDoc = makeDoc('node-1', null, 0)
    const parentADoc = makeDoc('parent-a', null, 0)
    // 2 existing siblings
    const siblings: MockDoc[] = [makeDoc('sib-1', 'parent-a', 0), makeDoc('sib-2', 'parent-a', 10)]

    // find call sequence:
    //  0: findDocById('node-1')
    //  1: walkAncestors: findDocById('parent-a') → parent-a has no parent → done, depthFromStart=1
    //  2: fetchSiblings(newParent='parent-a')
    //  3: fetchSiblings(oldParent=null) — parent changed (null → parent-a)
    const payload = makeMockPayload([
      { docs: [movedDoc] },
      { docs: [parentADoc] }, // walkAncestors: parent-a is root
      { docs: siblings }, // fetchSiblings(newParent)
      { docs: [] }, // fetchSiblings(oldParent=null)
    ])

    const result = await reorderNodes(
      defaultArgs({
        payload: payload as unknown as ReorderNodesArgs['payload'],
        nodeId: 'node-1',
        newParentId: 'parent-a',
        newIndex: 999,
      }),
    )

    expect(result).toEqual({ ok: true })

    // With 2 siblings, clampedIndex = min(999, 2) = 2
    const movedUpdate = payload.update.mock.calls.find((c) => c[0].id === 'node-1')
    expect(movedUpdate).toBeDefined()
    expect(movedUpdate![0].data['sortOrder']).toBe(20) // 2 * 10
  })
})

// ---------------------------------------------------------------------------
// 8. Field-name override
// ---------------------------------------------------------------------------

describe('reorderNodes — field-name override', () => {
  it('uses the overridden field names in find and update calls', async () => {
    // fields.parent = 'parentDoc' — all where clauses and update payloads must
    // reference 'parentDoc' rather than the default 'parent'.

    const movedDoc = {
      id: 'node-1',
      parentDoc: 'parent-a', // renamed field — old parent
      mySortOrder: 5,
      title: 'Node 1',
    }
    // parent-b is the newParentId; the ancestor walk looks it up
    const parentBDoc = { id: 'parent-b', parentDoc: null, mySortOrder: 0, title: 'Parent B' }

    // find call sequence:
    //  0: findDocById('node-1')       → movedDoc (parentDoc: 'parent-a')
    //  1: walkAncestors: findDocById('parent-b') → parentBDoc (parentDoc: null) → done, depthFromStart=1
    //  2: fetchSiblings(newParent='parent-b')    → []
    //  3: fetchSiblings(oldParent='parent-a')    → []
    const payload = makeMockPayload([
      { docs: [movedDoc] }, // findDocById(node-1)
      { docs: [parentBDoc] }, // walkAncestors: look up parent-b (newParentId)
      { docs: [] }, // fetchSiblings(newParent='parent-b') — none
      { docs: [] }, // fetchSiblings(oldParent='parent-a') — none
    ])

    const result = await reorderNodes({
      payload: payload as unknown as ReorderNodesArgs['payload'],
      collectionSlug: 'pages',
      fields: { parent: 'parentDoc', sortOrder: 'mySortOrder' },
      nodeId: 'node-1',
      newParentId: 'parent-b',
      newIndex: 0,
    })

    expect(result).toEqual({ ok: true })

    // The update on the moved node should reference the renamed fields
    const movedUpdate = payload.update.mock.calls.find((c) => c[0].id === 'node-1')
    expect(movedUpdate).toBeDefined()
    expect(movedUpdate![0].data).toHaveProperty('parentDoc', 'parent-b')
    expect(movedUpdate![0].data).toHaveProperty('mySortOrder', 0)
    expect(movedUpdate![0].data).not.toHaveProperty('parent')
    expect(movedUpdate![0].data).not.toHaveProperty('sortOrder')
  })
})

// ---------------------------------------------------------------------------
// 9. Old + new parent both re-numbered when changing parent
// ---------------------------------------------------------------------------

describe('reorderNodes — old and new parent sibling re-numbering', () => {
  it('re-numbers both old and new parent siblings when the parent changes', async () => {
    // Initial tree:
    //   parent-old: [node-1 (sort 0), sib-a (sort 10), sib-b (sort 20)]
    //   parent-new: [sib-c (sort 0)]
    //
    // Move node-1 from parent-old to parent-new at index 0.
    //
    // Expected after:
    //   parent-new: [node-1 (sort 0), sib-c (sort 10)]
    //   parent-old: [sib-a (sort 0), sib-b (sort 10)]  ← gap closed

    const movedDoc = makeDoc('node-1', 'parent-old', 0)
    const parentNewDoc = makeDoc('parent-new', null, 0)

    const newSiblings: MockDoc[] = [makeDoc('sib-c', 'parent-new', 0)]
    const oldSiblings: MockDoc[] = [
      makeDoc('sib-a', 'parent-old', 10),
      makeDoc('sib-b', 'parent-old', 20),
    ]

    // find call sequence:
    //  0: findDocById('node-1')
    //  1: walkAncestors: findDocById('parent-new') → parentNewDoc (parent: null) → done, depthFromStart=1
    //  2: fetchSiblings(newParent='parent-new')
    //  3: fetchSiblings(oldParent='parent-old')
    const payload = makeMockPayload([
      { docs: [movedDoc] }, // findDocById(node-1)
      { docs: [parentNewDoc] }, // walkAncestors: parent-new has no parent → done
      { docs: newSiblings }, // fetchSiblings(newParent='parent-new')
      { docs: oldSiblings }, // fetchSiblings(oldParent='parent-old')
    ])

    const result = await reorderNodes(
      defaultArgs({
        payload: payload as unknown as ReorderNodesArgs['payload'],
        nodeId: 'node-1',
        newParentId: 'parent-new',
        newIndex: 0,
      }),
    )

    expect(result).toEqual({ ok: true })

    const updateCalls = payload.update.mock.calls

    // node-1 → parent-new, sort 0
    const node1Update = updateCalls.find((c) => c[0].id === 'node-1')
    expect(node1Update![0].data['parent']).toBe('parent-new')
    expect(node1Update![0].data['sortOrder']).toBe(0)

    // sib-c was at sort 0, now shifted to position 1 → sort 10
    const sibCUpdate = updateCalls.find((c) => c[0].id === 'sib-c')
    expect(sibCUpdate).toBeDefined()
    expect(sibCUpdate![0].data['sortOrder']).toBe(10)

    // sib-a: was at sort 10, after gap-close is at position 0 → sort 0
    const sibAUpdate = updateCalls.find((c) => c[0].id === 'sib-a')
    expect(sibAUpdate).toBeDefined()
    expect(sibAUpdate![0].data['sortOrder']).toBe(0)

    // sib-b: was at sort 20, after gap-close is at position 1 → sort 10
    const sibBUpdate = updateCalls.find((c) => c[0].id === 'sib-b')
    expect(sibBUpdate).toBeDefined()
    expect(sibBUpdate![0].data['sortOrder']).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// 10. maxDepth: move that would exceed maxDepth
// ---------------------------------------------------------------------------

describe('reorderNodes — maxDepth check', () => {
  it('rejects a move that would place the subtree beyond maxDepth', async () => {
    // Tree structure:
    //   root (depth 1)
    //     └─ mid (depth 2)
    //          └─ node-to-move (depth 3)   ← the moved node, height=1 (leaf)
    //   deep-parent (depth 1)
    //     └─ deeper (depth 2)
    //          └─ deepest-parent (depth 3) ← newParentId
    //
    // maxDepth = 3
    // newParentId = deepest-parent (at depth 3)
    // newParentDepth = 3 (needs 3 ancestor hops to root)
    // subtreeHeight of node-to-move = 1 (it's a leaf)
    // deepestLevel = newParentDepth + subtreeHeight = 3 + 1 = 4 > maxDepth(3) → reject

    const nodeToMove = makeDoc('node-to-move', 'mid', 0) // currently under mid
    const deepestParentDoc = makeDoc('deepest-parent', 'deeper', 0) // 3 hops from root
    const deeperDoc = makeDoc('deeper', 'deep-parent', 0)
    const deepParentDoc = makeDoc('deep-parent', null, 0) // root

    const payload = makeMockPayload([
      { docs: [nodeToMove] }, // findDocById('node-to-move')
      // walkAncestors from 'deepest-parent' up (looking for node-to-move to detect cycle):
      { docs: [deepestParentDoc] }, // look up deepest-parent → parent is 'deeper'
      { docs: [deeperDoc] }, // look up deeper → parent is 'deep-parent'
      { docs: [deepParentDoc] }, // look up deep-parent → parent is null (root found)
      // walkResult.depthFromStart = 3 (3 hops: deepest-parent → deeper → deep-parent → null)
      // computeSubtreeHeight BFS for node-to-move:
      { docs: [] }, // BFS level 1: no children of node-to-move → height = 1
    ])

    const result = await reorderNodes(
      defaultArgs({
        payload: payload as unknown as ReorderNodesArgs['payload'],
        nodeId: 'node-to-move',
        newParentId: 'deepest-parent',
        newIndex: 0,
        maxDepth: 3,
      }),
    )

    expect(result).toMatchObject({ ok: false })
    expect((result as { ok: false; error: string }).error).toMatch(/maxDepth/)
    expect(payload.update).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 11. payload.update throws → error propagates
// ---------------------------------------------------------------------------

describe('reorderNodes — DB error propagation', () => {
  it('re-throws when payload.update throws', async () => {
    const movedDoc = makeDoc('node-1', 'parent-a', 0)
    const parentBDoc = makeDoc('parent-b', null, 0)

    const payload = makeMockPayload([
      { docs: [movedDoc] }, // findDocById
      { docs: [parentBDoc] }, // walkAncestors: parent-b is root
      { docs: [] }, // walkAncestors: parent-b has no parent
      { docs: [] }, // fetchSiblings(newParent)
      { docs: [] }, // fetchSiblings(oldParent)
    ])

    // Make the update explode
    payload.update.mockRejectedValueOnce(new Error('DB connection lost'))

    await expect(
      reorderNodes(
        defaultArgs({
          payload: payload as unknown as ReorderNodesArgs['payload'],
          nodeId: 'node-1',
          newParentId: 'parent-b',
          newIndex: 0,
        }),
      ),
    ).rejects.toThrow('DB connection lost')
  })
})
