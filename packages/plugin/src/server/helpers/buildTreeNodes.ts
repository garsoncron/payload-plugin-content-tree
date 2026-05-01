/**
 * @description
 * Converts a flat list of Payload CMS documents into a nested `TreeNode[]`
 * suitable for the content-tree admin view.
 *
 * Two modes:
 *  - **Full-tree mode** (`parentId` omitted / null): fetches ALL docs in the
 *    collection in one query (depth 0, limit 0), then assembles the nested
 *    tree in-memory. Enforces `maxDepth` by truncating subtrees that would
 *    exceed it — setting `hasChildren: true` so the client can lazy-load.
 *  - **Lazy-load mode** (`parentId` provided): fetches only the direct
 *    children of that parent; each returned node has `children: undefined`
 *    and `hasChildren` computed via a cheap count query.
 *
 * Key features:
 *  - Field-name overrides (`opts.fields.parent`, `opts.fields.sortOrder`, …)
 *  - Handles both scalar parent IDs and Payload relationship objects
 *    (`{ relationTo, value }`) returned at depth 0
 *  - Optional fields (`slug`, `workflowState`, `lockedBy`) only set when
 *    the plugin config enables them AND the doc carries the value
 *  - Sort: primary by `sortOrder` ascending, tie-broken by `id` ascending
 *
 * @dependencies
 *  - payload: `Payload` type + `payload.find` / `payload.count`
 *  - ../../shared/types: `TreeNode`, `ContentTreePluginOptions`
 *  - ../../shared/constants: `DEFAULT_MAX_DEPTH`
 */

import type { Payload } from 'payload'
import type { ContentTreePluginOptions, TreeNode } from '../../shared/types'
import { DEFAULT_MAX_DEPTH } from '../../shared/constants'

// ---------------------------------------------------------------------------
// Public argument bag
// ---------------------------------------------------------------------------

export interface BuildTreeNodesArgs {
  /** Live Payload instance from `req.payload`. */
  payload: Payload
  /** Slug of the backing collection. */
  collectionSlug: string
  /**
   * Resolved field-name overrides. Callers should pass
   * `opts.fields ?? {}` so defaults apply.
   */
  fields: NonNullable<ContentTreePluginOptions['fields']>
  /**
   * When set, returns ONLY direct children of this parent (lazy-load).
   * When absent / null, returns the full nested tree.
   */
  parentId?: string | number | null
  /** Hard cap on nesting depth. Default `DEFAULT_MAX_DEPTH`. */
  maxDepth?: number
}

// ---------------------------------------------------------------------------
// Internal doc shape (after Payload.find returns, depth: 0)
// ---------------------------------------------------------------------------

/**
 * A single Payload document as returned at `depth: 0`.
 * The `parent` field may be a scalar ID or a relationship object.
 */
type RawDoc = Record<string, unknown>

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

/** Resolve the effective field name, falling back to the plugin default. */
function fieldName(
  fields: NonNullable<ContentTreePluginOptions['fields']>,
  key: keyof NonNullable<ContentTreePluginOptions['fields']>,
  defaultName: string,
): string {
  const override = fields[key]
  // `workflowState` and `lockedBy` can be `false` (opt-out)
  if (override === false || override === undefined) return defaultName
  return override
}

/**
 * Extract the raw parent ID from a doc's parent field value.
 *
 * At `depth: 0`, Payload returns relationship fields as scalar IDs for
 * simple single-collection relationships. However, for polymorphic
 * relationships (`relationTo: string[]`) Payload may return an object
 * `{ relationTo: string, value: string | number }` even at depth 0.
 * We normalise both forms.
 */
function extractParentId(raw: unknown): string | number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string' || typeof raw === 'number') return raw
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>
    const v = obj['value']
    if (typeof v === 'string' || typeof v === 'number') return v
  }
  return null
}

/** Compare two node IDs for ascending tie-breaking sort. */
function compareIds(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

/** Sort nodes by sortOrder ascending, then by id ascending for ties. */
function sortNodes(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    const diff = a.sortOrder - b.sortOrder
    if (diff !== 0) return diff
    return compareIds(a.id, b.id)
  })
}

// ---------------------------------------------------------------------------
// Doc → TreeNode mapping
// ---------------------------------------------------------------------------

/**
 * Map a single raw Payload doc to a flat (no children) TreeNode.
 *
 * Optional fields are only attached when:
 *  - The plugin option enables them (not `false`, not missing)
 *  - The doc actually carries a string value for that field
 */
function docToNode(doc: RawDoc, fields: NonNullable<ContentTreePluginOptions['fields']>): TreeNode {
  const parentFieldName = fieldName(fields, 'parent', 'parent')
  const sortOrderFieldName = fieldName(fields, 'sortOrder', 'sortOrder')
  const titleFieldName = fieldName(fields, 'title', 'title')
  const contentTypeFieldName = fieldName(fields, 'contentType', 'contentType')
  const slugFieldName = fieldName(fields, 'slug', 'slug')

  const id = doc['id'] as string | number
  const title = typeof doc[titleFieldName] === 'string' ? (doc[titleFieldName] as string) : ''
  const contentType =
    typeof doc[contentTypeFieldName] === 'string' ? (doc[contentTypeFieldName] as string) : ''
  const sortOrder =
    typeof doc[sortOrderFieldName] === 'number' ? (doc[sortOrderFieldName] as number) : 0
  const parent = extractParentId(doc[parentFieldName])

  const node: TreeNode = {
    id,
    title,
    contentType,
    parent,
    sortOrder,
    // hasChildren is set by the caller once children are attached
    hasChildren: false,
  }

  // Optional: slug — only include if plugin option `fields.slug` is provided
  // AND the doc has a non-empty string value for it.
  if (fields.slug !== undefined) {
    const slugVal = doc[slugFieldName]
    if (typeof slugVal === 'string' && slugVal.length > 0) {
      node.slug = slugVal
    }
  }

  // Optional: workflowState — only include if not explicitly disabled
  if (fields.workflowState !== false) {
    const wsFieldName = fieldName(fields, 'workflowState', 'workflowState')
    const wsVal = doc[wsFieldName]
    if (typeof wsVal === 'string') {
      node.workflowState = wsVal
    }
  }

  // Optional: lockedBy — only include if not explicitly disabled
  if (fields.lockedBy !== false) {
    const lbFieldName = fieldName(fields, 'lockedBy', 'lockedBy')
    const lbVal = doc[lbFieldName]
    if (typeof lbVal === 'string' || typeof lbVal === 'number' || lbVal === null) {
      node.lockedBy = lbVal
    }
  }

  return node
}

// ---------------------------------------------------------------------------
// Tree assembly (full-tree mode)
// ---------------------------------------------------------------------------

/**
 * Build the full nested tree from an array of flat `TreeNode`s.
 *
 * Algorithm:
 *  1. Index all nodes by ID.
 *  2. Walk every node: find its parent in the index.
 *     - If parent exists, push to parent's `children[]`.
 *     - If no parent (null), push to roots.
 *  3. Sort children at every level.
 *  4. Enforce `maxDepth` by truncating children beyond the limit.
 *
 * Returns root-level nodes (no parent).
 */
function assembleTree(nodes: TreeNode[], maxDepth: number): TreeNode[] {
  // Index by id
  const byId = new Map<string | number, TreeNode>()
  for (const node of nodes) {
    byId.set(node.id, node)
  }

  const roots: TreeNode[] = []

  for (const node of nodes) {
    if (node.parent === null) {
      roots.push(node)
    } else {
      const parentNode = byId.get(node.parent)
      if (parentNode !== undefined) {
        if (parentNode.children === undefined) {
          parentNode.children = []
        }
        parentNode.children.push(node)
      } else {
        // Parent referenced but not in the result set (orphan) — treat as root
        roots.push(node)
      }
    }
  }

  // Sort and enforce depth recursively
  sortNodes(roots)
  enforceDepth(roots, 1, maxDepth)

  return roots
}

/**
 * Recursively sort children and enforce the `maxDepth` limit.
 *
 * If a node's children would appear at depth > maxDepth, the children array
 * is cleared but `hasChildren` is set to `true` so the client knows to
 * lazy-load them.
 *
 * @param nodes - nodes at the current depth level
 * @param currentDepth - 1-based depth of these nodes
 * @param maxDepth - hard cap
 */
function enforceDepth(nodes: TreeNode[], currentDepth: number, maxDepth: number): void {
  for (const node of nodes) {
    const hasActualChildren = Array.isArray(node.children) && node.children.length > 0
    node.hasChildren = hasActualChildren

    if (hasActualChildren) {
      if (currentDepth >= maxDepth) {
        // Truncate children — client must lazy-load at this depth
        node.children = []
        node.hasChildren = true
      } else {
        // Sort at this level and recurse
        sortNodes(node.children!)
        enforceDepth(node.children!, currentDepth + 1, maxDepth)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a nested `TreeNode[]` from a Payload collection.
 *
 * @returns `{ nodes, total }` where:
 *   - `nodes` — root-level nodes (full tree) or direct children (lazy mode)
 *   - `total` — total doc count in collection (full mode) or child count (lazy mode)
 */
export async function buildTreeNodes(args: BuildTreeNodesArgs): Promise<{
  nodes: TreeNode[]
  total: number
}> {
  const { payload, collectionSlug, fields, parentId = null, maxDepth = DEFAULT_MAX_DEPTH } = args

  // ── Lazy-load mode ───────────────────────────────────────────────────────
  if (parentId !== null && parentId !== undefined) {
    const parentFieldName = fieldName(fields, 'parent', 'parent')
    const sortOrderFieldName = fieldName(fields, 'sortOrder', 'sortOrder')

    // Fetch direct children
    const result = await payload.find({
      collection: collectionSlug,
      depth: 0,
      limit: 0, // fetch all direct children (no pagination cap for tree)
      where: {
        [parentFieldName]: { equals: parentId },
      },
      sort: sortOrderFieldName,
    })

    const rawDocs = result.docs as RawDoc[]

    // Map docs to flat TreeNodes (hasChildren will be filled below)
    const childNodes = rawDocs.map((doc) => docToNode(doc, fields))
    sortNodes(childNodes)

    // For each child, determine hasChildren via a cheap count query
    // We batch this: run one count per child in parallel
    await Promise.all(
      childNodes.map(async (node) => {
        const countResult = await payload.count({
          collection: collectionSlug,
          where: {
            [parentFieldName]: { equals: node.id },
          },
        })
        node.hasChildren = countResult.totalDocs > 0
        // Lazy-load mode: children array is intentionally undefined
      }),
    )

    return {
      nodes: childNodes,
      total: result.totalDocs,
    }
  }

  // ── Full-tree mode ───────────────────────────────────────────────────────

  const result = await payload.find({
    collection: collectionSlug,
    depth: 0,
    limit: 0, // fetch everything; tree assembly is in-memory
  })

  const rawDocs = result.docs as RawDoc[]
  const total = result.totalDocs

  if (rawDocs.length === 0) {
    return { nodes: [], total: 0 }
  }

  // Map every doc to a flat TreeNode
  const flatNodes = rawDocs.map((doc) => docToNode(doc, fields))

  // Assemble the nested tree, sort at every level, enforce maxDepth
  const roots = assembleTree(flatNodes, maxDepth)

  return { nodes: roots, total }
}
