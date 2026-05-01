/**
 * Unit tests for the client-side drop-validation helper.
 *
 * All tests are purely in-memory — no DOM, no network, no Payload runtime.
 * The helper is a pure function so tests are fast and hermetic.
 *
 * Coverage goals (per issue #25 scope):
 *  1.  Happy path — valid move returns { ok: true }
 *  2.  Self-drop — dragging a node onto itself → 'self-drop'
 *  3.  Cycle — dragging a node into its own descendant → 'cycle'
 *  4.  Parent-illegal (empty allowedChildren) — no children allowed → 'parent-illegal'
 *  5.  Parent-illegal (contentType not in allowed list) → 'parent-illegal'
 *  6.  Depth-exceeded — move would exceed maxDepth → 'depth-exceeded'
 *  7.  Permission-denied — canPerformAction returns false → 'permission-denied'
 *  8.  Move to root (newParent: null) — happy path
 *  9.  Move to root (newParent: null) — root has no allowed children → 'parent-illegal'
 *  10. canPerformAction undefined — permission check skipped (default-allow)
 */

import { describe, it, expect, vi } from 'vitest'
import { validateDrop } from '../../src/client/helpers/dropValidation'
import type { TreeNode } from '../../src/shared/types'

// ---------------------------------------------------------------------------
// Node factory
// ---------------------------------------------------------------------------

let _idCounter = 0

/**
 * Create a minimal TreeNode. `parent` defaults to null (root-level).
 * `children` defaults to undefined (leaf).
 */
function makeNode(overrides: Partial<TreeNode> & { id?: string | number } = {}): TreeNode {
  const id = overrides.id ?? `node-${++_idCounter}`
  return {
    id,
    title: overrides.title ?? `Node ${String(id)}`,
    contentType: overrides.contentType ?? 'page',
    parent: overrides.parent ?? null,
    sortOrder: overrides.sortOrder ?? 0,
    hasChildren: overrides.hasChildren ?? false,
    children: overrides.children,
    workflowState: overrides.workflowState,
    lockedBy: overrides.lockedBy,
    slug: overrides.slug,
  }
}

/**
 * Build a `byId` map from an array of TreeNode. Recurses into children.
 */
function buildById(nodes: TreeNode[]): Map<string, TreeNode> {
  const map = new Map<string, TreeNode>()
  function walk(ns: TreeNode[]): void {
    for (const n of ns) {
      map.set(String(n.id), n)
      if (n.children) walk(n.children)
    }
  }
  walk(nodes)
  return map
}

/**
 * Default insertOptions for tests that don't test the parent-illegal path.
 * Allows 'page' under 'root' and under 'page'.
 */
const DEFAULT_INSERT_OPTIONS: Record<string, string[]> = {
  root: ['page'],
  page: ['page'],
}

// ---------------------------------------------------------------------------
// 1. Happy path — valid move
// ---------------------------------------------------------------------------

describe('validateDrop — happy path', () => {
  it('returns { ok: true } for a valid move into a different parent', () => {
    // Tree:
    //   root
    //     ├── parent-a (id: 'a')
    //     └── parent-b (id: 'b')
    //           └── node-1 (id: '1')
    const node1 = makeNode({ id: '1', parent: 'b', contentType: 'page' })
    const parentA = makeNode({ id: 'a', parent: null, contentType: 'page' })
    const parentB = makeNode({ id: 'b', parent: null, contentType: 'page', children: [node1] })

    const byId = buildById([node1, parentA, parentB])

    const result = validateDrop({
      draggedNode: node1,
      newParent: parentA,
      byId,
      maxDepth: 5,
      insertOptions: DEFAULT_INSERT_OPTIONS,
    })

    expect(result).toEqual({ ok: true })
  })
})

// ---------------------------------------------------------------------------
// 2. Self-drop
// ---------------------------------------------------------------------------

describe('validateDrop — self-drop', () => {
  it('rejects when dragged node is dropped onto itself', () => {
    const node = makeNode({ id: 'n1', contentType: 'page' })
    const byId = buildById([node])

    const result = validateDrop({
      draggedNode: node,
      newParent: node, // same node as both drag source and drop target
      byId,
      maxDepth: 5,
      insertOptions: DEFAULT_INSERT_OPTIONS,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('self-drop')
      expect(result.message).toContain('onto itself')
    }
  })
})

// ---------------------------------------------------------------------------
// 3. Cycle detection
// ---------------------------------------------------------------------------

describe('validateDrop — cycle', () => {
  it('rejects when the new parent is a descendant of the dragged node', () => {
    // Tree:
    //   root
    //     └── parent (id: 'p')
    //           └── child (id: 'c')  ← trying to make parent a child of child
    const child = makeNode({ id: 'c', parent: 'p', contentType: 'page' })
    const parent = makeNode({ id: 'p', parent: null, contentType: 'page', children: [child] })

    const byId = buildById([parent, child])

    // Move: drag 'parent' and drop onto 'child' (would create p → c → p cycle)
    const result = validateDrop({
      draggedNode: parent,
      newParent: child,
      byId,
      maxDepth: 5,
      insertOptions: DEFAULT_INSERT_OPTIONS,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('cycle')
      expect(result.message).toContain('descendant')
    }
  })
})

// ---------------------------------------------------------------------------
// 4. Parent-illegal — no children allowed
// ---------------------------------------------------------------------------

describe('validateDrop — parent-illegal (no children allowed)', () => {
  it('rejects when the parent contentType has no allowed children in insertOptions', () => {
    const dragged = makeNode({ id: 'd1', contentType: 'page' })
    // 'section' contentType has no entry in insertOptions → allowedChildren = []
    const parent = makeNode({ id: 'p1', contentType: 'section' })

    const byId = buildById([dragged, parent])

    const result = validateDrop({
      draggedNode: dragged,
      newParent: parent,
      byId,
      maxDepth: 5,
      insertOptions: { root: ['page'] }, // 'section' not configured as a parent
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('parent-illegal')
      expect(result.message).toContain("doesn't accept any children")
    }
  })
})

// ---------------------------------------------------------------------------
// 5. Parent-illegal — contentType not in allowed list
// ---------------------------------------------------------------------------

describe('validateDrop — parent-illegal (contentType not allowed)', () => {
  it('rejects when draggedNode.contentType is not in the allowed child list', () => {
    // 'article' is not in the allowed children for 'page' parents
    const dragged = makeNode({ id: 'd1', contentType: 'article' })
    const parent = makeNode({ id: 'p1', title: 'My Page', contentType: 'page' })

    const byId = buildById([dragged, parent])

    const result = validateDrop({
      draggedNode: dragged,
      newParent: parent,
      byId,
      maxDepth: 5,
      insertOptions: { root: ['page'], page: ['page'] }, // only 'page' allowed under 'page'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('parent-illegal')
      // Message uses draggedNode.contentType and parent's title
      expect(result.message).toContain('article')
      expect(result.message).toContain('My Page')
    }
  })
})

// ---------------------------------------------------------------------------
// 6. Depth-exceeded
// ---------------------------------------------------------------------------

describe('validateDrop — depth-exceeded', () => {
  it('rejects when the move would push the deepest node past maxDepth', () => {
    // maxDepth = 2
    // Tree structure:
    //   root (depth 0)
    //     └── parent (depth 1, id: 'p')
    //           └── grandchild-of-parent (depth 2) ← this would be the landing spot
    //
    // Dragged node: dragged (leaf, subtreeDepth = 1)
    // If dropped under 'grandchild' (depth 2):
    //   parentDepth = 3 (grandchild is at depth 2, parent IS the grandchild so depth+1 = 3)
    //   subtreeDepth = 1
    //   deepestLevel = 3 + 1 = 4 > maxDepth(2) → reject
    //
    // Simpler setup: maxDepth=2, drop under a node already at depth 2
    const root = makeNode({ id: 'root', parent: null, contentType: 'page' })
    const level1 = makeNode({ id: 'l1', parent: 'root', contentType: 'page' })
    const level2 = makeNode({ id: 'l2', parent: 'l1', contentType: 'page' })
    const dragged = makeNode({ id: 'drag', parent: null, contentType: 'page' })

    const byId = buildById([root, level1, level2, dragged])

    // Drop 'dragged' under 'level2' → level2 is at depth 2, so dragged would land at depth 3 > maxDepth(2)
    const result = validateDrop({
      draggedNode: dragged,
      newParent: level2,
      byId,
      maxDepth: 2,
      insertOptions: { root: ['page'], page: ['page'] },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('depth-exceeded')
      expect(result.message).toContain('maxDepth')
      expect(result.message).toContain('2')
    }
  })
})

// ---------------------------------------------------------------------------
// 7. Permission-denied
// ---------------------------------------------------------------------------

describe('validateDrop — permission-denied', () => {
  it('rejects when canPerformAction returns false for move', () => {
    const dragged = makeNode({ id: 'd1', contentType: 'page' })
    const parent = makeNode({ id: 'p1', contentType: 'page' })

    const byId = buildById([dragged, parent])

    const canPerformAction = vi.fn().mockReturnValue(false)

    const result = validateDrop({
      draggedNode: dragged,
      newParent: parent,
      byId,
      maxDepth: 5,
      insertOptions: DEFAULT_INSERT_OPTIONS,
      canPerformAction,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('permission-denied')
      expect(result.message).toContain('permission')
    }

    expect(canPerformAction).toHaveBeenCalledWith('move', dragged)
  })
})

// ---------------------------------------------------------------------------
// 8. Move to root — happy path
// ---------------------------------------------------------------------------

describe('validateDrop — move to root (happy path)', () => {
  it('allows a valid move to root when insertOptions.root allows the contentType', () => {
    const dragged = makeNode({ id: 'd1', parent: 'p1', contentType: 'page' })
    const parent = makeNode({ id: 'p1', contentType: 'page' })

    const byId = buildById([dragged, parent])

    // newParent: null = drop to root
    const result = validateDrop({
      draggedNode: dragged,
      newParent: null,
      byId,
      maxDepth: 5,
      insertOptions: { root: ['page'] },
    })

    expect(result).toEqual({ ok: true })
  })
})

// ---------------------------------------------------------------------------
// 9. Move to root — parent-illegal
// ---------------------------------------------------------------------------

describe('validateDrop — move to root (parent-illegal)', () => {
  it('rejects when root does not allow the dragged contentType', () => {
    const dragged = makeNode({ id: 'd1', contentType: 'footer' }) // 'footer' not in root

    const byId = buildById([dragged])

    const result = validateDrop({
      draggedNode: dragged,
      newParent: null,
      byId,
      maxDepth: 5,
      insertOptions: { root: ['page'] }, // only 'page' allowed at root
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('parent-illegal')
      // Should mention 'root' as the parent label
      expect(result.message).toContain('root')
    }
  })
})

// ---------------------------------------------------------------------------
// 10. canPerformAction undefined — permission check skipped
// ---------------------------------------------------------------------------

describe('validateDrop — canPerformAction undefined (default-allow)', () => {
  it('skips permission check and returns { ok: true } when canPerformAction is not provided', () => {
    const dragged = makeNode({ id: 'd1', contentType: 'page' })
    const parent = makeNode({ id: 'p1', contentType: 'page' })

    const byId = buildById([dragged, parent])

    // No canPerformAction provided → default-allow
    const result = validateDrop({
      draggedNode: dragged,
      newParent: parent,
      byId,
      maxDepth: 5,
      insertOptions: DEFAULT_INSERT_OPTIONS,
      // canPerformAction: undefined (omitted)
    })

    expect(result).toEqual({ ok: true })
  })
})
