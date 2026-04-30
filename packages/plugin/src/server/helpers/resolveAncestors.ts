/**
 * Walk parent pointers in-memory to compute the ancestor chain for a
 * given node. Used by the search endpoint to return expandIds so the
 * client can auto-expand to matches.
 *
 * TODO(v0.1): port from FRAS spike search route ancestor walk.
 * Tests: tests/unit/ancestors.test.ts
 */

import type { TreeNode } from '../../shared/types'

export function resolveAncestors(
  _nodeId: string | number,
  _byId: Map<string | number, TreeNode>,
): { ancestorIds: (string | number)[]; ancestors: TreeNode[] } {
  // TODO(v0.1): implement
  return { ancestorIds: [], ancestors: [] }
}
