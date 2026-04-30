/**
 * Atomic parent + sortOrder update for a moved node.
 *
 * Naive approach (v0.1): single PATCH that updates parent + sortOrder.
 * Sibling sortOrder gaps grow over time. Acceptable for v0.1.
 *
 * Proper approach (v0.2): bulk-update siblings to renumber to a clean
 * 0..N-1 range. Requires transactional adapter support.
 *
 * TODO(v0.1): implement the naive path.
 * Tests: tests/unit/reorder.test.ts
 */

import type { Payload } from 'payload'

export interface ReorderInput {
  collectionSlug: string
  parentField: string
  sortField: string
  nodeId: string | number
  newParentId: string | number | null
  newIndex: number
}

export async function reorderNode(
  _payload: Payload,
  _input: ReorderInput,
): Promise<void> {
  // TODO(v0.1): implement
}
