/**
 * @description
 * Pure client-side drop-validation helper for react-arborist drag-and-drop.
 *
 * Called synchronously in the onMove handler (before the network mutation)
 * to surface actionable error messages to the user via toasts, and to prevent
 * illegal moves from ever hitting the server.
 *
 * Validation order (return on first failure):
 *  1. self-drop        — cannot drop a node onto itself
 *  2. cycle            — cannot move a node into its own descendant
 *  3. parent-illegal   — insertOptions doesn't allow this contentType here
 *  4. depth-exceeded   — move would push tree past maxDepth
 *  5. permission-denied — canPerformAction('move') returned false
 *
 * @notes
 * - This is a pure synchronous function with no side effects.
 * - The cycle-check ancestor walk is capped at 50 to guard against corrupt data.
 * - subtreeDepth counts the depth of the MOVED subtree using the in-memory
 *   TreeNode.children array (already populated by buildTreeNodes).
 * - The byId map must be pre-built from the flat node list via flattenTree
 *   (provided separately in ContentTreeView).
 */

import type { TreeNode } from '../../shared/types'

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * All possible reasons a drop can be rejected.
 *
 * These are distinct string literals so callers can branch on them without
 * parsing the human-readable `message`.
 */
export type DropRejection =
  | 'self-drop'
  | 'cycle' // dragging a node into its own descendant
  | 'depth-exceeded' // would push tree past maxDepth
  | 'parent-illegal' // insertOptions doesn't allow this contentType under that parent
  | 'permission-denied' // canPerformAction('move') returned false

export type DropValidationResult =
  | { ok: true }
  | { ok: false; reason: DropRejection; message: string }

// ─── Internal constants ───────────────────────────────────────────────────────

/** Maximum ancestor hops for cycle detection. Guards against circular refs in corrupt data. */
const ANCESTOR_WALK_CAP = 50

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Walk the ancestor chain of `startNode` upward via `byId`, looking for
 * `targetId` at any level. Returns true if `targetId` is found (cycle detected).
 *
 * Walks at most `ANCESTOR_WALK_CAP` levels to prevent infinite loops caused by
 * circular parent references in corrupt data.
 */
function hasCycle(startNode: TreeNode, targetId: string, byId: Map<string, TreeNode>): boolean {
  let current: TreeNode | undefined = startNode
  let steps = 0

  while (current !== undefined && steps < ANCESTOR_WALK_CAP) {
    if (String(current.id) === targetId) return true

    // Walk up to the parent
    const parentId = current.parent
    if (parentId === null || parentId === undefined) break
    current = byId.get(String(parentId))
    steps++
  }

  return false
}

/**
 * Compute the depth of `node` from the root by walking up via `byId`.
 * A root-level node (no parent) has depth 0.
 *
 * Capped at `ANCESTOR_WALK_CAP` to prevent infinite loops.
 */
function computeNodeDepth(node: TreeNode, byId: Map<string, TreeNode>): number {
  let current: TreeNode | undefined = node
  let depth = 0

  while (current !== undefined && depth < ANCESTOR_WALK_CAP) {
    const parentId = current.parent
    if (parentId === null || parentId === undefined) break
    current = byId.get(String(parentId))
    depth++
  }

  return depth
}

/**
 * Compute the maximum depth of the subtree rooted at `node`, measured from
 * the node itself (not from the tree root). A leaf has depth 1.
 *
 * Uses the in-memory `TreeNode.children` array — no network calls.
 *
 * Examples:
 *   leaf node                          → 1
 *   node → child                       → 2
 *   node → child → grandchild          → 3
 */
function computeSubtreeDepth(node: TreeNode): number {
  if (!node.children || node.children.length === 0) {
    return 1
  }

  // Recurse into children and take the maximum depth
  let maxChildDepth = 0
  for (const child of node.children) {
    const childDepth = computeSubtreeDepth(child)
    if (childDepth > maxChildDepth) {
      maxChildDepth = childDepth
    }
  }

  return 1 + maxChildDepth
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Validate a proposed drag-and-drop move before sending it to the server.
 *
 * Returns `{ ok: true }` when the move is allowed, or
 * `{ ok: false; reason: DropRejection; message: string }` on the first failure.
 *
 * @param args.draggedNode    - The node being dragged.
 * @param args.newParent      - The proposed new parent node, or null for root.
 * @param args.byId           - Map of all known nodes keyed by String(id).
 *                              Used to walk ancestors for cycle detection and depth.
 * @param args.maxDepth       - Hard cap on tree depth from opts.maxDepth.
 * @param args.insertOptions  - Map of parent contentType → allowed child contentTypes.
 *                              Use 'root' key for root-level drops.
 * @param args.canPerformAction - Optional adapter that gates on user permissions.
 *                               When undefined, permission check is skipped (default-allow).
 */
export function validateDrop(args: {
  draggedNode: TreeNode
  newParent: TreeNode | null
  byId: Map<string, TreeNode>
  maxDepth: number
  insertOptions: Record<string, string[]>
  canPerformAction?: (action: 'move', node: TreeNode) => boolean
}): DropValidationResult {
  const { draggedNode, newParent, byId, maxDepth, insertOptions, canPerformAction } = args

  const draggedId = String(draggedNode.id)

  // ── 1. Self-drop ──────────────────────────────────────────────────────────
  //
  // Cannot drop a node onto itself. React-arborist normally prevents this at
  // the UI level, but we validate defensively here.
  if (newParent !== null && String(newParent.id) === draggedId) {
    return {
      ok: false,
      reason: 'self-drop',
      message: 'Cannot drop a node onto itself.',
    }
  }

  // ── 2. Cycle detection ───────────────────────────────────────────────────
  //
  // If `newParent` is a descendant of `draggedNode`, the move would create a
  // cycle (the dragged node would become its own ancestor).
  //
  // Walk from newParent upward through `byId`; if we encounter draggedNode.id
  // in the chain, the move is illegal.
  if (newParent !== null) {
    // Start the walk from the newParent itself (not its parent) because the
    // newParent could BE the dragged node's descendant.
    if (hasCycle(newParent, draggedId, byId)) {
      return {
        ok: false,
        reason: 'cycle',
        message: 'Cannot move a node into its own descendant.',
      }
    }
  }

  // ── 3. Parent legality check (insertOptions) ─────────────────────────────
  //
  // The consumer configures which contentTypes are allowed as children of each
  // parent contentType via `insertOptions`. If the move violates this, reject.
  const parentContentType = newParent === null ? 'root' : newParent.contentType
  const allowedChildren = insertOptions[parentContentType] ?? []

  if (allowedChildren.length === 0) {
    return {
      ok: false,
      reason: 'parent-illegal',
      message: "This parent doesn't accept any children.",
    }
  }

  if (!allowedChildren.includes(draggedNode.contentType)) {
    const parentLabel = newParent === null ? 'root' : newParent.title
    return {
      ok: false,
      reason: 'parent-illegal',
      message: `${draggedNode.contentType} isn't allowed under ${parentLabel}.`,
    }
  }

  // ── 4. Depth check ───────────────────────────────────────────────────────
  //
  // Ensure that after the move, no node in the moved subtree exceeds maxDepth.
  //
  // parentDepth: how many levels deep the new parent is from the root.
  //   - null parent → depth 0 (root-level)
  //   - non-null parent → walk up via byId
  //
  // subtreeDepth: how deep the moved subtree is (1 for a leaf).
  //
  // The deepest level after the move: parentDepth + subtreeDepth
  // (parentDepth 0 + subtreeDepth 1 = the node itself at depth 1 — the minimum)
  const parentDepth = newParent === null ? 0 : computeNodeDepth(newParent, byId) + 1
  const subtreeDepth = computeSubtreeDepth(draggedNode)
  const deepestLevel = parentDepth + subtreeDepth

  if (deepestLevel > maxDepth) {
    return {
      ok: false,
      reason: 'depth-exceeded',
      message: `Move would exceed maxDepth (${maxDepth}).`,
    }
  }

  // ── 5. Permission check ──────────────────────────────────────────────────
  //
  // If the consumer supplied a canPerformAction callback, ask it whether the
  // 'move' action is allowed for this node. When undefined, skip (default-allow).
  if (canPerformAction !== undefined && canPerformAction('move', draggedNode) === false) {
    return {
      ok: false,
      reason: 'permission-denied',
      message: "You don't have permission to move this node.",
    }
  }

  // ── All checks passed ─────────────────────────────────────────────────────
  return { ok: true }
}
