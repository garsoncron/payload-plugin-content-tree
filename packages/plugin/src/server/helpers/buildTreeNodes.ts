/**
 * Convert a flat list of Payload docs into nested TreeNodes.
 *
 * Reads field names from plugin config so the same logic works against
 * any consumer's collection shape. Returns both the nested roots and a
 * parent-keyed Map so the endpoint can serve lazy-load requests without
 * re-walking.
 *
 * TODO(v0.1): port from FRAS spike Section 3.11.
 * Tests: tests/unit/buildTreeNodes.test.ts
 */

import type { ContentTreePluginOptions, TreeNode } from '../../shared/types'

export function buildTreeNodes(
  _docs: Record<string, unknown>[],
  _opts: ContentTreePluginOptions,
): { roots: TreeNode[]; byParent: Map<string | number | 'ROOT', TreeNode[]> } {
  // TODO(v0.1): implement
  return { roots: [], byParent: new Map() }
}
