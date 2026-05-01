/**
 * Unit tests for buildTreeNodes.
 *
 * The `payload.find` and `payload.count` calls are mocked with hand-rolled
 * return values — no Payload runtime is loaded. This keeps the suite fast
 * and hermetic.
 *
 * Coverage goals (per PRD §8 / issue #11):
 *  1. empty collection → { nodes: [], total: 0 }
 *  2. single root node → 1-node tree, hasChildren false
 *  3. 2-level nesting (root + 2 children) → nested correctly, sortOrder respected
 *  4. 3-level nesting with maxDepth: 2 → depth-2 leaves truncated, hasChildren: true
 *  5. field-name override (fields.parent = 'parentDoc') → reads renamed field
 *  6. optional slug set when fields.slug provided + doc has a value; absent otherwise
 *  7. lazy-load mode (parentId provided) → only direct children, children: undefined
 *  8. parent is a relationship object { relationTo, value } → value extracted correctly
 *  9. same sortOrder tie-broken by id ascending
 */

import { describe, it, expect, vi } from 'vitest'
import { buildTreeNodes } from '../../src/server/helpers/buildTreeNodes'
import type { BuildTreeNodesArgs } from '../../src/server/helpers/buildTreeNodes'
import type { ContentTreePluginOptions } from '../../src/shared/types'

// ---------------------------------------------------------------------------
// Mock Payload factory
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock `Payload` instance.
 *
 * `findDocs` is returned for every `payload.find()` call.
 * `countResult` is returned for every `payload.count()` call.
 */
function makeMockPayload(options: {
  findDocs?: Record<string, unknown>[]
  totalDocs?: number
  /** When provided, `payload.count()` returns this value. */
  countResult?: number
  /**
   * For more granular control, override with a jest-style mock fn that
   * receives the `where` clause and returns a per-call count.
   */
  countFn?: (args: { collection: string; where: Record<string, unknown> }) => number
}) {
  const docs = options.findDocs ?? []
  const totalDocs = options.totalDocs ?? docs.length

  return {
    find: vi.fn().mockResolvedValue({ docs, totalDocs }),
    count: vi
      .fn()
      .mockImplementation((args: { collection: string; where: Record<string, unknown> }) => {
        const n = options.countFn ? options.countFn(args) : (options.countResult ?? 0)
        return Promise.resolve({ totalDocs: n })
      }),
  }
}

// ---------------------------------------------------------------------------
// Default plugin opts helpers
// ---------------------------------------------------------------------------

function defaultFields(): NonNullable<ContentTreePluginOptions['fields']> {
  return {}
}

function defaultArgs(
  overrides: Partial<BuildTreeNodesArgs> & {
    payload: BuildTreeNodesArgs['payload']
  },
): BuildTreeNodesArgs {
  return {
    collectionSlug: 'pages',
    fields: defaultFields(),
    maxDepth: 5,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Doc factories
// ---------------------------------------------------------------------------

function makeDoc(
  id: string | number,
  parentId: string | number | null,
  sortOrder = 0,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    title: `Page ${id}`,
    contentType: 'page',
    parent: parentId,
    sortOrder,
    ...extra,
  }
}

// ---------------------------------------------------------------------------
// 1. Empty collection
// ---------------------------------------------------------------------------

describe('buildTreeNodes — empty collection', () => {
  it('returns { nodes: [], total: 0 } when no docs exist', async () => {
    const payload = makeMockPayload({ findDocs: [], totalDocs: 0 })
    const result = await buildTreeNodes(defaultArgs({ payload }))
    expect(result.nodes).toEqual([])
    expect(result.total).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 2. Single root node
// ---------------------------------------------------------------------------

describe('buildTreeNodes — single root node', () => {
  it('returns a 1-node tree with hasChildren false', async () => {
    const docs = [makeDoc('root-1', null, 0)]
    const payload = makeMockPayload({ findDocs: docs })

    const result = await buildTreeNodes(defaultArgs({ payload }))

    expect(result.total).toBe(1)
    expect(result.nodes).toHaveLength(1)

    const root = result.nodes[0]!
    expect(root.id).toBe('root-1')
    expect(root.parent).toBeNull()
    expect(root.hasChildren).toBe(false)
    // children should be undefined or empty
    expect(root.children === undefined || root.children.length === 0).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3. 2-level nesting — sortOrder respected
// ---------------------------------------------------------------------------

describe('buildTreeNodes — 2-level nesting', () => {
  it('nests children under their parent and sorts by sortOrder', async () => {
    const docs = [
      makeDoc('root', null, 0),
      makeDoc('child-b', 'root', 20), // higher sortOrder
      makeDoc('child-a', 'root', 10), // lower sortOrder → should come first
    ]
    const payload = makeMockPayload({ findDocs: docs })

    const result = await buildTreeNodes(defaultArgs({ payload }))

    expect(result.nodes).toHaveLength(1)
    const root = result.nodes[0]!
    expect(root.id).toBe('root')
    expect(root.hasChildren).toBe(true)
    expect(root.children).toHaveLength(2)

    // children sorted by sortOrder ascending
    expect(root.children![0]!.id).toBe('child-a')
    expect(root.children![1]!.id).toBe('child-b')
  })
})

// ---------------------------------------------------------------------------
// 4. 3-level nesting with maxDepth: 2
// ---------------------------------------------------------------------------

describe('buildTreeNodes — maxDepth enforcement', () => {
  it('truncates children at maxDepth and sets hasChildren: true', async () => {
    // depth 1: root
    // depth 2: child (at the depth cap)
    // depth 3: grandchild (beyond cap → should be truncated)
    const docs = [
      makeDoc('root', null, 0),
      makeDoc('child', 'root', 0),
      makeDoc('grandchild', 'child', 0),
    ]
    const payload = makeMockPayload({ findDocs: docs })

    const result = await buildTreeNodes(defaultArgs({ payload, maxDepth: 2 }))

    const root = result.nodes[0]!
    expect(root.hasChildren).toBe(true)

    const child = root.children![0]!
    expect(child.id).toBe('child')
    // child is AT depth 2 (the cap), so its children are truncated
    expect(child.children).toHaveLength(0)
    expect(child.hasChildren).toBe(true) // truncated but has real children
  })

  it('does not truncate children exactly at maxDepth when children are nested below', async () => {
    // root (depth 1) → mid (depth 2) → leaf (depth 3)
    // With maxDepth 3, leaf should appear normally
    const docs = [makeDoc('root', null, 0), makeDoc('mid', 'root', 0), makeDoc('leaf', 'mid', 0)]
    const payload = makeMockPayload({ findDocs: docs })

    const result = await buildTreeNodes(defaultArgs({ payload, maxDepth: 3 }))

    const root = result.nodes[0]!
    const mid = root.children![0]!
    expect(mid.id).toBe('mid')
    // leaf is at depth 3 (the cap) and has no children, so children should be empty/undefined
    const leaf = mid.children![0]!
    expect(leaf.id).toBe('leaf')
    expect(leaf.hasChildren).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 5. Field-name override: fields.parent = 'parentDoc'
// ---------------------------------------------------------------------------

describe('buildTreeNodes — field-name overrides', () => {
  it('reads the renamed parent field when fields.parent is overridden', async () => {
    const docs = [
      { id: 'root', title: 'Root', contentType: 'page', parentDoc: null, sortOrder: 0 },
      { id: 'child', title: 'Child', contentType: 'page', parentDoc: 'root', sortOrder: 0 },
    ]
    const payload = makeMockPayload({ findDocs: docs })

    const result = await buildTreeNodes(defaultArgs({ payload, fields: { parent: 'parentDoc' } }))

    expect(result.nodes).toHaveLength(1)
    const root = result.nodes[0]!
    expect(root.id).toBe('root')
    expect(root.children).toHaveLength(1)
    expect(root.children![0]!.id).toBe('child')
  })
})

// ---------------------------------------------------------------------------
// 6. Optional slug field
// ---------------------------------------------------------------------------

describe('buildTreeNodes — optional slug field', () => {
  it('sets slug on the node when fields.slug is provided and the doc has a value', async () => {
    const docs = [
      {
        id: 'root',
        title: 'Root',
        contentType: 'page',
        parent: null,
        sortOrder: 0,
        slug: 'root-page',
      },
    ]
    const payload = makeMockPayload({ findDocs: docs })

    const result = await buildTreeNodes(defaultArgs({ payload, fields: { slug: 'slug' } }))

    const root = result.nodes[0]!
    expect(root.slug).toBe('root-page')
  })

  it('does NOT set slug on the node when fields.slug is not provided in plugin opts', async () => {
    const docs = [
      {
        id: 'root',
        title: 'Root',
        contentType: 'page',
        parent: null,
        sortOrder: 0,
        slug: 'root-page',
      },
    ]
    const payload = makeMockPayload({ findDocs: docs })

    // No fields.slug in opts
    const result = await buildTreeNodes(defaultArgs({ payload, fields: {} }))

    const root = result.nodes[0]!
    expect(root.slug).toBeUndefined()
  })

  it('does NOT set slug when the doc is missing the slug field value', async () => {
    const docs = [
      {
        id: 'root',
        title: 'Root',
        contentType: 'page',
        parent: null,
        sortOrder: 0,
        // slug intentionally absent
      },
    ]
    const payload = makeMockPayload({ findDocs: docs })

    const result = await buildTreeNodes(defaultArgs({ payload, fields: { slug: 'slug' } }))

    const root = result.nodes[0]!
    expect(root.slug).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 7. Lazy-load mode — parentId provided
// ---------------------------------------------------------------------------

describe('buildTreeNodes — lazy-load mode', () => {
  it('returns only direct children of the given parentId', async () => {
    const childDocs = [makeDoc('child-1', 'root', 0), makeDoc('child-2', 'root', 1)]
    // payload.find is called with a where clause filtering by parentId
    const payload = makeMockPayload({ findDocs: childDocs, totalDocs: 2, countResult: 0 })

    const result = await buildTreeNodes(defaultArgs({ payload, parentId: 'root' }))

    expect(result.total).toBe(2)
    expect(result.nodes).toHaveLength(2)
  })

  it('sets children: undefined on each returned node in lazy-load mode', async () => {
    const childDocs = [makeDoc('child-1', 'root', 0)]
    const payload = makeMockPayload({ findDocs: childDocs, countResult: 0 })

    const result = await buildTreeNodes(defaultArgs({ payload, parentId: 'root' }))

    const node = result.nodes[0]!
    expect(node.children).toBeUndefined()
  })

  it('sets hasChildren: true for a child node that itself has children (lazy mode)', async () => {
    const childDocs = [makeDoc('child-1', 'root', 0)]
    // count query for child-1's children returns 3
    const payload = makeMockPayload({ findDocs: childDocs, countResult: 3 })

    const result = await buildTreeNodes(defaultArgs({ payload, parentId: 'root' }))

    expect(result.nodes[0]!.hasChildren).toBe(true)
  })

  it('sets hasChildren: false for a leaf node in lazy mode', async () => {
    const childDocs = [makeDoc('leaf', 'root', 0)]
    const payload = makeMockPayload({ findDocs: childDocs, countResult: 0 })

    const result = await buildTreeNodes(defaultArgs({ payload, parentId: 'root' }))

    expect(result.nodes[0]!.hasChildren).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 8. Parent as a relationship object { relationTo, value }
// ---------------------------------------------------------------------------

describe('buildTreeNodes — relationship object form', () => {
  it('extracts the value from a { relationTo, value } parent object', async () => {
    const docs = [
      {
        id: 'root',
        title: 'Root',
        contentType: 'page',
        parent: null,
        sortOrder: 0,
      },
      {
        id: 'child',
        title: 'Child',
        contentType: 'page',
        // Polymorphic relationship object — Payload's depth-0 representation
        parent: { relationTo: 'pages', value: 'root' },
        sortOrder: 0,
      },
    ]
    const payload = makeMockPayload({ findDocs: docs })

    const result = await buildTreeNodes(defaultArgs({ payload }))

    expect(result.nodes).toHaveLength(1) // only root at top level
    const root = result.nodes[0]!
    expect(root.id).toBe('root')
    expect(root.children).toHaveLength(1)
    expect(root.children![0]!.id).toBe('child')
  })
})

// ---------------------------------------------------------------------------
// 9. Tie-breaking by id when sortOrder is equal
// ---------------------------------------------------------------------------

describe('buildTreeNodes — sortOrder tie-breaking', () => {
  it('breaks ties in sortOrder by id ascending (string ids)', async () => {
    const docs = [
      makeDoc('root', null, 0),
      makeDoc('z-child', 'root', 5),
      makeDoc('a-child', 'root', 5), // same sortOrder as z-child, but id sorts earlier
    ]
    const payload = makeMockPayload({ findDocs: docs })

    const result = await buildTreeNodes(defaultArgs({ payload }))

    const children = result.nodes[0]!.children!
    expect(children[0]!.id).toBe('a-child')
    expect(children[1]!.id).toBe('z-child')
  })

  it('breaks ties in sortOrder by id ascending (numeric ids)', async () => {
    const docs = [
      makeDoc(1, null, 0),
      makeDoc(30, 1, 5),
      makeDoc(2, 1, 5), // same sortOrder, lower numeric id → should come first
    ]
    const payload = makeMockPayload({ findDocs: docs })

    const result = await buildTreeNodes(defaultArgs({ payload }))

    const children = result.nodes[0]!.children!
    expect(children[0]!.id).toBe(2)
    expect(children[1]!.id).toBe(30)
  })
})

// ---------------------------------------------------------------------------
// 10. workflowState and lockedBy optional fields
// ---------------------------------------------------------------------------

describe('buildTreeNodes — optional workflowState and lockedBy', () => {
  it('sets workflowState when the field is present and not disabled', async () => {
    const docs = [
      {
        id: 1,
        title: 'Page',
        contentType: 'page',
        parent: null,
        sortOrder: 0,
        workflowState: 'draft',
      },
    ]
    const payload = makeMockPayload({ findDocs: docs })
    const result = await buildTreeNodes(defaultArgs({ payload, fields: {} }))
    // default field name is 'workflowState', opts.fields.workflowState is not set → default behaviour
    expect(result.nodes[0]!.workflowState).toBe('draft')
  })

  it('does NOT set workflowState when fields.workflowState is false', async () => {
    const docs = [
      {
        id: 1,
        title: 'Page',
        contentType: 'page',
        parent: null,
        sortOrder: 0,
        workflowState: 'draft',
      },
    ]
    const payload = makeMockPayload({ findDocs: docs })
    const result = await buildTreeNodes(defaultArgs({ payload, fields: { workflowState: false } }))
    expect(result.nodes[0]!.workflowState).toBeUndefined()
  })

  it('sets lockedBy when the field is present and not disabled', async () => {
    const docs = [
      {
        id: 1,
        title: 'Page',
        contentType: 'page',
        parent: null,
        sortOrder: 0,
        lockedBy: 42,
      },
    ]
    const payload = makeMockPayload({ findDocs: docs })
    const result = await buildTreeNodes(defaultArgs({ payload, fields: {} }))
    expect(result.nodes[0]!.lockedBy).toBe(42)
  })

  it('does NOT set lockedBy when fields.lockedBy is false', async () => {
    const docs = [
      {
        id: 1,
        title: 'Page',
        contentType: 'page',
        parent: null,
        sortOrder: 0,
        lockedBy: 42,
      },
    ]
    const payload = makeMockPayload({ findDocs: docs })
    const result = await buildTreeNodes(defaultArgs({ payload, fields: { lockedBy: false } }))
    expect(result.nodes[0]!.lockedBy).toBeUndefined()
  })
})
