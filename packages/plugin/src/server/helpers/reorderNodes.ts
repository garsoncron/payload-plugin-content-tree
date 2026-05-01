/**
 * @description
 * Atomic parent + sortOrder update for a moved node, with full sibling
 * re-numbering on both old and new parent sides.
 *
 * Responsibilities:
 *  - Validate the move (node existence, self-parent, cycle detection, depth)
 *  - Re-number siblings of the new parent to accommodate the insertion index
 *  - Re-number siblings of the old parent to close the gap left by the move
 *  - Apply all updates via payload.update, wrapping in a Payload transaction
 *    when req is provided
 *
 * Ordering strategy:
 *  Sibling lists are always re-numbered in full with a * 10 step
 *  (i.e., 0, 10, 20, …). This keeps the model simple for v0.1.
 *  The * 10 stride leaves room for single-nudge inserts between siblings
 *  in a future optimisation without requiring a full re-number.
 *
 * @dependencies
 *  - payload: `Payload` + `PayloadRequest` types
 *  - ../../shared/types: `ContentTreePluginOptions`
 *
 * @notes
 *  - Field names are resolved from the `fields` argument, mirroring the
 *    pattern in buildTreeNodes.ts. Callers pass `opts.fields ?? {}`.
 *  - Validation failures return `{ ok: false, error }` — NOT throws.
 *    DB errors are re-thrown for the endpoint layer to translate to HTTP 500.
 *  - The ancestor-walk cap defaults to 50 iterations to guard against
 *    infinite loops caused by corrupt data (circular references in the DB).
 */

import type { Payload, PayloadRequest } from 'payload'
import type { ContentTreePluginOptions } from '../../shared/types'

// ---------------------------------------------------------------------------
// Public argument bag
// ---------------------------------------------------------------------------

export interface ReorderNodesArgs {
  /** Live Payload instance from `req.payload`. */
  payload: Payload
  /** Slug of the backing collection. */
  collectionSlug: string
  /**
   * Resolved field-name overrides. Callers should pass
   * `opts.fields ?? {}` so defaults apply inline.
   */
  fields: NonNullable<ContentTreePluginOptions['fields']>
  /** ID of the node being moved. */
  nodeId: string | number
  /** New parent ID. null = move to root. */
  newParentId: string | number | null
  /** Zero-based insertion index among the new parent's children. */
  newIndex: number
  /**
   * Optional maximum depth. When set:
   *  - The ancestor-walk cap is this value (instead of the default 50).
   *  - The depth-check is applied: if the move would put any part of the
   *    moved subtree deeper than maxDepth, the move is rejected.
   * When unset, only the raw 50-level ancestor walk cap applies.
   */
  maxDepth?: number
  /**
   * Optional Payload request object. When provided, updates run inside the
   * request's transaction context (transactionID is forwarded automatically
   * by Payload). When absent, updates are non-transactional — the endpoint
   * caller (#24) always provides req.
   */
  req?: PayloadRequest
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type ReorderNodesResult = { ok: true } | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Internal raw-doc type (depth: 0 result)
// ---------------------------------------------------------------------------

type RawDoc = Record<string, unknown>

// ---------------------------------------------------------------------------
// Field-name helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the effective parent field name.
 * Falls back to `'parent'` when no override is configured.
 */
function resolveParentField(fields: NonNullable<ContentTreePluginOptions['fields']>): string {
  return fields.parent ?? 'parent'
}

/**
 * Resolve the effective sortOrder field name.
 * Falls back to `'sortOrder'` when no override is configured.
 */
function resolveSortOrderField(fields: NonNullable<ContentTreePluginOptions['fields']>): string {
  return fields.sortOrder ?? 'sortOrder'
}

/**
 * Extract a scalar ID from a Payload relationship field at depth 0.
 *
 * At depth 0, single-collection relationships are returned as scalars.
 * Polymorphic relationships may return `{ relationTo, value }`. We handle
 * both forms, mirroring the same logic used in buildTreeNodes.ts.
 */
function extractId(raw: unknown): string | number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string' || typeof raw === 'number') return raw
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>
    const v = obj['value']
    if (typeof v === 'string' || typeof v === 'number') return v
  }
  return null
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Look up a single document by id. Returns null if not found.
 * Uses `payload.find` with a `where: { id: { equals } }` clause at depth 0
 * to avoid loading relationship sub-documents.
 */
async function findDocById(
  payload: Payload,
  collectionSlug: string,
  id: string | number,
  req?: PayloadRequest,
): Promise<RawDoc | null> {
  const result = await payload.find({
    collection: collectionSlug,
    where: { id: { equals: id } },
    depth: 0,
    limit: 1,
    ...(req !== undefined ? { req } : {}),
  })
  const doc = result.docs[0] as RawDoc | undefined
  return doc ?? null
}

/**
 * Walk the ancestor chain of `startId` up to `cap` steps.
 *
 * Returns:
 *  - `{ cycleFound: true }` if `targetId` appears in the chain
 *  - `{ cycleFound: false, depthFromStart: n }` where n is the number of
 *    ancestor hops (0 means startId has no parent — it is root)
 *  - `{ capExceeded: true }` if we walked `cap` steps without finding a root
 *
 * Used for two purposes:
 *  1. Cycle detection: targetId = nodeId being moved (walk from newParentId)
 *  2. Depth calculation: targetId = null sentinel (walk from newParentId
 *     to measure its depth from root)
 */
async function walkAncestors(
  payload: Payload,
  collectionSlug: string,
  startId: string | number,
  parentField: string,
  cap: number,
  targetId: string | number | null,
  req?: PayloadRequest,
): Promise<{ cycleFound: true } | { capExceeded: true } | { depthFromStart: number }> {
  let currentId: string | number | null = startId
  let steps = 0

  while (currentId !== null && steps < cap) {
    if (targetId !== null && String(currentId) === String(targetId)) {
      return { cycleFound: true }
    }

    const doc = await findDocById(payload, collectionSlug, currentId, req)
    if (doc === null) {
      // Orphaned reference — treat as root
      break
    }

    currentId = extractId(doc[parentField])
    steps++
  }

  if (currentId !== null && steps >= cap) {
    return { capExceeded: true }
  }

  return { depthFromStart: steps }
}

// ---------------------------------------------------------------------------
// Sibling re-numbering helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the current siblings of `parentId` EXCLUDING `excludeId`.
 *
 * Returns docs sorted by their current sortOrder ascending (Payload sort).
 * `limit: 0` fetches all siblings — trees are shallow enough that this is
 * fine for v0.1.
 */
async function fetchSiblings(
  payload: Payload,
  collectionSlug: string,
  parentId: string | number | null,
  parentField: string,
  sortOrderField: string,
  excludeId: string | number,
  req?: PayloadRequest,
): Promise<RawDoc[]> {
  // Build the `where` clause depending on whether parentId is null (root)
  // or a concrete value. Payload uses `equals: null` for null checks.
  const parentWhere =
    parentId === null
      ? { [parentField]: { equals: null } }
      : { [parentField]: { equals: parentId } }

  const result = await payload.find({
    collection: collectionSlug,
    where: {
      and: [parentWhere, { id: { not_equals: excludeId } }],
    },
    sort: sortOrderField,
    depth: 0,
    limit: 0, // fetch all siblings
    ...(req !== undefined ? { req } : {}),
  })

  return result.docs as RawDoc[]
}

/**
 * Compute new sortOrders for a set of siblings after inserting the moved node
 * at `insertIndex`.
 *
 * Returns an array of `{ id, newSortOrder }` pairs for ALL siblings whose
 * sort order has changed, plus the entry for the moved node itself.
 *
 * Strategy: always re-number the full list with a * 10 step:
 *   positions [0 .. insertIndex-1] → i * 10
 *   moved node                     → insertIndex * 10
 *   positions [insertIndex ..]     → (i+1) * 10
 *
 * Only includes entries where the new value differs from the current one,
 * reducing unnecessary DB writes.
 */
function computeNewSortOrders(
  siblings: RawDoc[],
  sortOrderField: string,
  nodeId: string | number,
  insertIndex: number,
): Array<{ id: string | number; newSortOrder: number }> {
  // Clamp insertIndex to [0, siblings.length]
  const clampedIndex = Math.max(0, Math.min(insertIndex, siblings.length))

  const updates: Array<{ id: string | number; newSortOrder: number }> = []

  // The moved node's new sort order
  updates.push({ id: nodeId, newSortOrder: clampedIndex * 10 })

  // Sibling sort orders: positions before the insert point keep their index,
  // positions from the insert point onward are shifted by one.
  siblings.forEach((sibling, i) => {
    const siblingId = sibling['id'] as string | number
    const siblingPosition = i < clampedIndex ? i : i + 1
    const newSortOrder = siblingPosition * 10
    const currentSortOrder =
      typeof sibling[sortOrderField] === 'number' ? (sibling[sortOrderField] as number) : -1

    // Only enqueue an update if the sort order actually changed
    if (currentSortOrder !== newSortOrder) {
      updates.push({ id: siblingId, newSortOrder })
    }
  })

  return updates
}

/**
 * Re-number siblings of `parentId` after the moved node has been removed
 * from that parent (old parent cleanup path).
 *
 * Unlike `computeNewSortOrders`, there is no insertion — the remaining
 * siblings are simply packed into a clean 0, 10, 20, … sequence.
 */
function computeOldSiblingOrders(
  oldSiblings: RawDoc[],
  sortOrderField: string,
): Array<{ id: string | number; newSortOrder: number }> {
  const updates: Array<{ id: string | number; newSortOrder: number }> = []

  oldSiblings.forEach((sibling, i) => {
    const siblingId = sibling['id'] as string | number
    const newSortOrder = i * 10
    const currentSortOrder =
      typeof sibling[sortOrderField] === 'number' ? (sibling[sortOrderField] as number) : -1

    if (currentSortOrder !== newSortOrder) {
      updates.push({ id: siblingId, newSortOrder })
    }
  })

  return updates
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Atomically move `nodeId` to a new parent at a specific insertion index.
 *
 * Validation is performed before any DB writes. If validation fails, the
 * function returns `{ ok: false, error: '<message>' }` without throwing.
 *
 * DB failures mid-operation are re-thrown. When `req` carries a Payload
 * transaction ID, Payload's transaction layer rolls back automatically on
 * error propagation.
 *
 * @returns `{ ok: true }` on success, `{ ok: false, error }` on validation failure.
 */
export async function reorderNodes(args: ReorderNodesArgs): Promise<ReorderNodesResult> {
  const { payload, collectionSlug, fields, nodeId, newParentId, newIndex, maxDepth, req } = args

  // ── Resolve field names ────────────────────────────────────────────────────
  const parentField = resolveParentField(fields)
  const sortOrderField = resolveSortOrderField(fields)

  // The ancestor-walk cap. When maxDepth is set, use it as the cap so that
  // the depth check and cycle detection share the same bound. Otherwise
  // default to 50, which is generous for any realistic content tree.
  const walkCap = maxDepth ?? 50

  // ── 1. Look up the moved node ──────────────────────────────────────────────
  const movedDoc = await findDocById(payload, collectionSlug, nodeId, req)
  if (movedDoc === null) {
    return { ok: false, error: `node ${String(nodeId)} not found` }
  }

  const oldParentId = extractId(movedDoc[parentField])

  // ── 2. Self-parent check ───────────────────────────────────────────────────
  if (newParentId !== null && String(nodeId) === String(newParentId)) {
    return { ok: false, error: 'a node cannot be its own parent' }
  }

  // ── 3. Cycle detection ─────────────────────────────────────────────────────
  if (newParentId !== null) {
    const walkResult = await walkAncestors(
      payload,
      collectionSlug,
      newParentId,
      parentField,
      walkCap,
      nodeId, // look for nodeId in the ancestor chain of newParentId
      req,
    )

    if ('cycleFound' in walkResult) {
      return { ok: false, error: 'refusing move: would create a cycle' }
    }
    if ('capExceeded' in walkResult) {
      return { ok: false, error: 'ancestor walk exceeded depth cap' }
    }

    // ── 4. Depth check ───────────────────────────────────────────────────────
    if (maxDepth !== undefined) {
      // walkResult.depthFromStart is the number of hops from newParentId to root.
      // newParentDepth = depthFromStart (root is depth 0, so 1 hop = depth 1, etc.)
      const newParentDepth = walkResult.depthFromStart

      // The moved node would land at depth newParentDepth + 1.
      // We also need the height of the moved subtree to check that no descendant
      // exceeds maxDepth. Computing the full subtree height requires another
      // recursive query; for v0.1 we conservatively compute this using a single
      // BFS-like fan-out. To keep things simple, compute subtreeHeight via
      // a recursive helper.
      const subtreeHeight = await computeSubtreeHeight(
        payload,
        collectionSlug,
        nodeId,
        parentField,
        req,
      )

      // Deepest level that would exist after the move:
      //   newParentDepth (0-based depth of newParent from root)
      //   + 1 (the moved node itself)
      //   + (subtreeHeight - 1) (the moved subtree's own depth beyond the moved node)
      // Simplifies to: newParentDepth + subtreeHeight
      const deepestLevel = newParentDepth + subtreeHeight

      if (deepestLevel > maxDepth) {
        return { ok: false, error: `move would exceed maxDepth (${String(maxDepth)})` }
      }
    }
  }

  // ── 5. Compute sort-order updates for the new parent's siblings ────────────
  const newSiblings = await fetchSiblings(
    payload,
    collectionSlug,
    newParentId,
    parentField,
    sortOrderField,
    nodeId,
    req,
  )

  const newSiblingUpdates = computeNewSortOrders(newSiblings, sortOrderField, nodeId, newIndex)

  // ── 6. Compute sort-order updates for the old parent's siblings ────────────
  // Only needed when the node is actually changing parents; if the parent is
  // the same the new-sibling re-numbering already covers the full list.
  let oldSiblingUpdates: Array<{ id: string | number; newSortOrder: number }> = []

  const isSameParent =
    (oldParentId === null && newParentId === null) ||
    (oldParentId !== null && newParentId !== null && String(oldParentId) === String(newParentId))

  if (!isSameParent) {
    const oldSiblings = await fetchSiblings(
      payload,
      collectionSlug,
      oldParentId,
      parentField,
      sortOrderField,
      nodeId,
      req,
    )
    oldSiblingUpdates = computeOldSiblingOrders(oldSiblings, sortOrderField)
  }

  // ── 7. Apply all updates ───────────────────────────────────────────────────
  // Update the moved node itself: new parent + new sortOrder.
  // The clampedIndex here must match what computeNewSortOrders used.
  const clampedIndex = Math.max(0, Math.min(newIndex, newSiblings.length))

  await payload.update({
    collection: collectionSlug,
    id: nodeId,
    data: {
      [parentField]: newParentId,
      [sortOrderField]: clampedIndex * 10,
    } as Record<string, unknown>,
    ...(req !== undefined ? { req } : {}),
  })

  // Update new-parent siblings (excludes the moved node itself — handled above)
  for (const { id, newSortOrder } of newSiblingUpdates) {
    // Skip the moved node entry (already applied above)
    if (String(id) === String(nodeId)) continue

    await payload.update({
      collection: collectionSlug,
      id,
      data: { [sortOrderField]: newSortOrder } as Record<string, unknown>,
      ...(req !== undefined ? { req } : {}),
    })
  }

  // Update old-parent siblings
  for (const { id, newSortOrder } of oldSiblingUpdates) {
    await payload.update({
      collection: collectionSlug,
      id,
      data: { [sortOrderField]: newSortOrder } as Record<string, unknown>,
      ...(req !== undefined ? { req } : {}),
    })
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Subtree-height helper (used only by the depth check)
// ---------------------------------------------------------------------------

/**
 * Compute the height of the subtree rooted at `nodeId`.
 *
 * Height is defined as the number of levels in the subtree, including the
 * root node itself. A leaf node has height 1.
 *
 * Uses BFS via repeated `payload.find` calls. This is O(n) in the number of
 * descendants — acceptable for v0.1 because trees are shallow by design.
 *
 * Example:
 *   node (height 1, leaf)
 *   node → child (height 2)
 *   node → child → grandchild (height 3)
 */
async function computeSubtreeHeight(
  payload: Payload,
  collectionSlug: string,
  rootId: string | number,
  parentField: string,
  req?: PayloadRequest,
): Promise<number> {
  // BFS queue: start with the root node's id
  let currentLevelIds: Array<string | number> = [rootId]
  let height = 0

  while (currentLevelIds.length > 0) {
    height++

    // Fetch all direct children of every node at the current level in one query
    const result = await payload.find({
      collection: collectionSlug,
      where: {
        [parentField]: { in: currentLevelIds },
      },
      depth: 0,
      limit: 0,
      ...(req !== undefined ? { req } : {}),
    })

    const childDocs = result.docs as RawDoc[]
    currentLevelIds = childDocs.map((doc) => doc['id'] as string | number)
  }

  return height
}
