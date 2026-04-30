/**
 * Sitecore-style insert-options resolution.
 *
 * Given a parent node and the plugin's configured insertOptions table,
 * return the labelled list of child contentTypes the user is allowed to
 * insert under it. Also enforces the maxDepth cap.
 *
 * TODO(v0.1): port logic from FRAS spike. Tests live in
 * tests/unit/insertOptions.test.ts.
 */

import type { TreeNode } from './types'

export interface LabelledOption {
  value: string
  label: string
}

/** Resolve allowed child contentTypes for a given parent node. */
export function getAllowedInserts(
  _node: TreeNode | null,
  _config: {
    insertOptions: Record<string, string[]>
    maxDepth: number
    nodeDepth: number
  },
): string[] {
  // TODO(v0.1): implement
  // - if nodeDepth >= maxDepth → return []
  // - if node === null → return config.insertOptions.root ?? []
  // - else → return config.insertOptions[node.contentType] ?? []
  throw new Error('NOT_IMPLEMENTED: getAllowedInserts')
}

/** Convenience helper — returns labelled options for the menu UI. */
export function getInsertOptionsLabelled(
  _node: TreeNode | null,
  _config: {
    insertOptions: Record<string, string[]>
    contentTypeLabels: Record<string, string>
    maxDepth: number
    nodeDepth: number
  },
): LabelledOption[] {
  // TODO(v0.1): wrap getAllowedInserts and map to {value, label}
  throw new Error('NOT_IMPLEMENTED: getInsertOptionsLabelled')
}
