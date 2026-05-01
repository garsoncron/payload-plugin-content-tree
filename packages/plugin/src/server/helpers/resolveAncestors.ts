/**
 * @description
 * Walk parent pointers in-memory to compute the ancestor chain for a
 * given node. Used by the search endpoint to return `expandIds` so the
 * client can auto-expand the tree to show every matched search result.
 *
 * Key features:
 *  - Root-first order: ancestors[0] is the topmost ancestor, ancestors[N-1]
 *    is the immediate parent of the requested node.
 *  - The node itself is NOT included in the result.
 *  - Cycle detection: if a node ID is visited twice, the walk stops and emits
 *    a console.warn so the operator knows data is corrupt.
 *  - Depth cap: hard limit of 50 hops (covers any sane tree; guards against
 *    pathological data). Emits console.warn when hit.
 *  - Safe on unknown IDs: returns empty result instead of throwing.
 *
 * @dependencies
 *  - ../../shared/types: `TreeNode`
 *
 * @notes
 *  - This is a pure in-memory function — no I/O. Fast for the typical
 *    ≤50-result search cap.
 *  - The caller (search endpoint) builds the `byId` Map from the match set
 *    plus any ancestor docs fetched in a follow-up query.
 */

import type { TreeNode } from '../../shared/types'

/** Hard cap on ancestor walk depth. Protects against pathological data. */
const ANCESTOR_DEPTH_CAP = 50

/**
 * Walk `byId` from `nodeId` up through parent pointers until the chain
 * reaches a root (`parent === null`), the ID is unknown, a cycle is detected,
 * or `ANCESTOR_DEPTH_CAP` hops are exhausted.
 *
 * @param nodeId - ID of the node whose ancestors we want.
 * @param byId   - In-memory index of ALL nodes available (match set + ancestor set).
 * @returns `{ ancestorIds, ancestors }` in root-first order.
 *          The node identified by `nodeId` is NOT included.
 */
export function resolveAncestors(
  nodeId: string | number,
  byId: Map<string | number, TreeNode>,
): { ancestorIds: (string | number)[]; ancestors: TreeNode[] } {
  // If the starting node is not in the map, return empty — do not throw.
  if (!byId.has(nodeId)) {
    return { ancestorIds: [], ancestors: [] }
  }

  // Collect ancestors from immediate-parent upward, then reverse for root-first.
  const chain: TreeNode[] = []
  const visited = new Set<string | number>()

  // The starting node itself is excluded — begin the walk from its parent.
  let current: TreeNode | undefined = byId.get(nodeId)

  // Mark the starting node as visited to catch direct self-loops.
  if (current !== undefined) {
    visited.add(nodeId)
  }

  while (current !== undefined) {
    const parentId = current.parent

    // Reached a root — stop cleanly.
    if (parentId === null) {
      break
    }

    // Cycle detection: if we have already visited this parent ID, stop.
    if (visited.has(parentId)) {
      console.warn(
        `[content-tree-plugin] resolveAncestors: cycle detected at node "${String(parentId)}" ` +
          `while walking ancestors of "${String(nodeId)}". ` +
          'Returning partial ancestor chain. Check for corrupt parent references in the collection.',
      )
      break
    }

    // Depth cap.
    if (chain.length >= ANCESTOR_DEPTH_CAP) {
      console.warn(
        `[content-tree-plugin] resolveAncestors: depth cap (${ANCESTOR_DEPTH_CAP}) hit ` +
          `while walking ancestors of "${String(nodeId)}". ` +
          'Returning truncated ancestor chain.',
      )
      break
    }

    const parentNode = byId.get(parentId)

    // Parent ID exists in tree node but the node itself is not in the map
    // (e.g. it was an orphan or not fetched). Stop the walk gracefully.
    if (parentNode === undefined) {
      break
    }

    visited.add(parentId)
    chain.push(parentNode)
    current = parentNode
  }

  // `chain` is in immediate-parent-first order; reverse for root-first.
  chain.reverse()

  return {
    ancestorIds: chain.map((n) => n.id),
    ancestors: chain,
  }
}
