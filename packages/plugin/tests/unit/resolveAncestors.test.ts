/**
 * Unit tests for resolveAncestors.
 *
 * The function is pure (no I/O) so tests are synchronous and hermetic —
 * just build a `Map<id, TreeNode>` and call the function.
 *
 * Coverage goals (per issue #15):
 *  1. Empty Map → { ancestorIds: [], ancestors: [] }
 *  2. Node not in Map → empty result, no throw
 *  3. Single root node (parent=null) → empty (node itself excluded)
 *  4. 3-level chain → 3 ancestors in root-first order
 *  5. Cycle (a → b → a) → stops cleanly, emits console.warn
 *  6. Depth cap (60-node chain) → truncated at 50, emits console.warn
 *  7. Order: ancestors[0] is root, ancestors[N-1] is immediate parent
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveAncestors } from '../../src/server/helpers/resolveAncestors'
import type { TreeNode } from '../../src/shared/types'

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeNode(id: string | number, parent: string | number | null): TreeNode {
  return {
    id,
    title: `Node ${String(id)}`,
    contentType: 'page',
    parent,
    sortOrder: 0,
    hasChildren: false,
  }
}

function makeMap(nodes: TreeNode[]): Map<string | number, TreeNode> {
  const m = new Map<string | number, TreeNode>()
  for (const n of nodes) {
    m.set(n.id, n)
  }
  return m
}

// ---------------------------------------------------------------------------
// Silence / capture console.warn for tests that expect it
// ---------------------------------------------------------------------------

let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
    /* noop */
  })
})

afterEach(() => {
  warnSpy.mockRestore()
})

// ---------------------------------------------------------------------------
// 1. Empty Map
// ---------------------------------------------------------------------------

describe('resolveAncestors — empty Map', () => {
  it('returns empty result when the Map is empty', () => {
    const result = resolveAncestors('any-id', new Map())
    expect(result.ancestorIds).toEqual([])
    expect(result.ancestors).toEqual([])
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 2. Node not in Map
// ---------------------------------------------------------------------------

describe('resolveAncestors — node not in Map', () => {
  it('returns empty result and does NOT throw when nodeId is absent', () => {
    const byId = makeMap([makeNode('a', null)])
    const result = resolveAncestors('does-not-exist', byId)
    expect(result.ancestorIds).toEqual([])
    expect(result.ancestors).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 3. Single root node (parent = null)
// ---------------------------------------------------------------------------

describe('resolveAncestors — single root node', () => {
  it('returns empty result (the node itself is excluded)', () => {
    const byId = makeMap([makeNode('root', null)])
    const result = resolveAncestors('root', byId)
    expect(result.ancestorIds).toEqual([])
    expect(result.ancestors).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 4. 3-level chain: great-grand → grand → parent → me
// ---------------------------------------------------------------------------

describe('resolveAncestors — 3-level chain', () => {
  it('returns 3 ancestors in root-first order', () => {
    const greatGrand = makeNode('gg', null)
    const grand = makeNode('grand', 'gg')
    const parent = makeNode('parent', 'grand')
    const me = makeNode('me', 'parent')

    const byId = makeMap([greatGrand, grand, parent, me])
    const result = resolveAncestors('me', byId)

    expect(result.ancestorIds).toEqual(['gg', 'grand', 'parent'])
    expect(result.ancestors.map((n) => n.id)).toEqual(['gg', 'grand', 'parent'])
  })

  it('ancestors[0] is the root, ancestors[last] is the immediate parent', () => {
    const root = makeNode('root', null)
    const mid = makeNode('mid', 'root')
    const child = makeNode('child', 'mid')

    const byId = makeMap([root, mid, child])
    const result = resolveAncestors('child', byId)

    expect(result.ancestors[0]!.id).toBe('root')
    expect(result.ancestors[result.ancestors.length - 1]!.id).toBe('mid')
  })
})

// ---------------------------------------------------------------------------
// 5. Cycle detection: a → b → a
// ---------------------------------------------------------------------------

describe('resolveAncestors — cycle detection', () => {
  it('stops cleanly and warns when a cycle is detected', () => {
    // a points to b, b points to a → infinite loop without guard
    const a = makeNode('a', 'b')
    const b = makeNode('b', 'a')

    const byId = makeMap([a, b])
    const result = resolveAncestors('a', byId)

    // Should NOT throw, and should have returned a partial result
    expect(Array.isArray(result.ancestorIds)).toBe(true)

    // warn should have been called once with a cycle-related message
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0]![0]).toMatch(/cycle/i)
  })
})

// ---------------------------------------------------------------------------
// 6. Depth cap at 50
// ---------------------------------------------------------------------------

describe('resolveAncestors — depth cap', () => {
  it('truncates the chain at 50 and emits a warning for a 60-node chain', () => {
    // Build a linear chain of 61 nodes: 0 is root, 60 is the query target.
    const nodes: TreeNode[] = []
    for (let i = 0; i <= 60; i++) {
      nodes.push(makeNode(i, i === 0 ? null : i - 1))
    }
    const byId = makeMap(nodes)

    const result = resolveAncestors(60, byId)

    // There are 60 real ancestors (nodes 0–59), but cap is 50.
    expect(result.ancestorIds.length).toBe(50)

    // warn should have been called once for the depth cap
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0]![0]).toMatch(/depth cap/i)
  })
})
