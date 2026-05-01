/**
 * @description
 * GET /api/tree-{collectionSlug}/search?q=
 *
 * Case-insensitive partial match on `title` (always) and `slug` (when
 * `opts.fields.slug` is configured). Returns matched nodes plus the union
 * of ancestor IDs so the client can auto-expand the tree to reveal each hit.
 *
 * Response shape (locked — do NOT change without a major version bump):
 * ```ts
 * {
 *   results: TreeNode[]               // matched nodes, children: undefined
 *   expandIds: (string | number)[]   // union of all ancestor IDs, deduped
 *   total: number                    // results.length (≤ 50)
 * }
 * ```
 *
 * Guard rails:
 *  - Empty / whitespace-only `q` → 200 empty response (no DB hit).
 *  - `q` shorter than 2 chars (after trim) → 200 empty response.
 *  - `q` longer than 200 chars → 400 `{ error: 'query too long' }`.
 *  - Results hard-capped at 50 (Payload `limit: 50`).
 *    TODO: add `truncated: boolean` field once the client consumes it.
 *  - Ancestor fetch loop is capped at `opts.maxDepth ?? DEFAULT_MAX_DEPTH`
 *    iterations to avoid runaway queries on pathological data.
 *
 * @dependencies
 *  - payload: `Endpoint` type + `req.payload`
 *  - ../../shared/types: `ContentTreePluginOptions`, `TreeNode`
 *  - ../../shared/constants: `DEFAULT_MAX_DEPTH`
 *  - ../helpers/resolveAncestors: `resolveAncestors`
 *
 * @notes
 *  - `depth: 0` on all Payload queries — relationship fields come back as
 *    scalar IDs (or `{ relationTo, value }` for polymorphic). We normalise
 *    via `extractParentId` (same logic as buildTreeNodes).
 *  - `hasChildren` is computed via a `payload.count` per match. Acceptable
 *    cost because result set is capped at 50.
 */

import type { Endpoint, Where } from 'payload'
import type { ContentTreePluginOptions, TreeNode } from '../../shared/types'
import { DEFAULT_MAX_DEPTH } from '../../shared/constants'
import { resolveAncestors } from '../helpers/resolveAncestors'

// ---------------------------------------------------------------------------
// Internal raw-doc shape (depth: 0)
// ---------------------------------------------------------------------------

type RawDoc = Record<string, unknown>

// ---------------------------------------------------------------------------
// Field-resolution helpers (mirrors buildTreeNodes conventions)
// ---------------------------------------------------------------------------

/** Resolve effective field name, falling back to the plugin default. */
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
 * Extract raw parent ID from a doc's parent field value.
 * Handles scalar IDs and Payload polymorphic relationship objects
 * `{ relationTo: string, value: string | number }` at depth 0.
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

/**
 * Map a single raw Payload doc to a flat TreeNode (no children).
 * Mirrors docToNode in buildTreeNodes — same field resolution, same optional
 * field logic. `hasChildren` is filled in by the caller after a count query.
 */
function docToSearchNode(
  doc: RawDoc,
  fields: NonNullable<ContentTreePluginOptions['fields']>,
): TreeNode {
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
    hasChildren: false, // filled in after a count query
    // children: intentionally absent — search results are flat
  }

  // Optional: slug — only when plugin config enables it AND doc has a value.
  if (fields.slug !== undefined) {
    const slugVal = doc[slugFieldName]
    if (typeof slugVal === 'string' && slugVal.length > 0) {
      node.slug = slugVal
    }
  }

  // Optional: workflowState — only when not explicitly disabled.
  if (fields.workflowState !== false) {
    const wsFieldName = fieldName(fields, 'workflowState', 'workflowState')
    const wsVal = doc[wsFieldName]
    if (typeof wsVal === 'string') {
      node.workflowState = wsVal
    }
  }

  // Optional: lockedBy — only when not explicitly disabled.
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
// Ancestor-set builder
// ---------------------------------------------------------------------------

/**
 * Given a set of matched nodes, iteratively fetch all missing ancestor docs
 * until no new ancestors are needed or the depth cap is reached.
 *
 * Returns a `Map<id, TreeNode>` containing both the original match set AND
 * all ancestors found. This map is passed to `resolveAncestors`.
 *
 * Strategy:
 *  1. Seed `byId` with the match set.
 *  2. Collect parent IDs referenced by nodes in `byId` that are NOT already
 *     in `byId`.
 *  3. Fetch those docs via `payload.find({ where: { id: { in: [...] } } })`.
 *  4. Map them to TreeNodes and add to `byId`.
 *  5. Repeat until no missing parents or `maxIterations` is exhausted.
 */
async function buildAncestorMap(
  matchNodes: TreeNode[],
  payload: { find: (args: Record<string, unknown>) => Promise<{ docs: RawDoc[] }> },
  collectionSlug: string,
  fields: NonNullable<ContentTreePluginOptions['fields']>,
  maxIterations: number,
): Promise<Map<string | number, TreeNode>> {
  const byId = new Map<string | number, TreeNode>()

  // Seed with match set
  for (const node of matchNodes) {
    byId.set(node.id, node)
  }

  for (let i = 0; i < maxIterations; i++) {
    // Collect all parent IDs that are not yet in the map
    const missingIds: (string | number)[] = []
    for (const node of byId.values()) {
      if (node.parent !== null && !byId.has(node.parent)) {
        missingIds.push(node.parent)
      }
    }

    // Nothing left to fetch — ancestor chain is complete
    if (missingIds.length === 0) {
      break
    }

    // Fetch the missing ancestor docs in one query
    const result = await payload.find({
      collection: collectionSlug,
      depth: 0,
      // limit: 0 = no pagination cap (ancestor sets are small)
      limit: 0,
      where: {
        id: { in: missingIds },
      },
    })

    const ancestorDocs = result.docs as RawDoc[]

    if (ancestorDocs.length === 0) {
      // Payload found nothing for those IDs — orphaned references; stop.
      break
    }

    for (const doc of ancestorDocs) {
      const node = docToSearchNode(doc, fields)
      byId.set(node.id, node)
    }
  }

  return byId
}

// ---------------------------------------------------------------------------
// Endpoint factory
// ---------------------------------------------------------------------------

export const searchEndpoint = (opts: ContentTreePluginOptions): Endpoint => ({
  path: `/tree-${opts.collectionSlug}/search`,
  method: 'get',
  handler: async (req) => {
    try {
      // ── Parse and validate query string ──────────────────────────────────
      const url = new URL(req.url ?? '/', 'http://localhost')
      const rawQ = url.searchParams.get('q')

      // Normalise: treat missing/empty/whitespace-only as empty search.
      const q = (rawQ ?? '').trim()

      // Guard: empty or single-char query → return empty without hitting DB.
      if (q.length < 2) {
        return Response.json({ results: [], expandIds: [], total: 0 })
      }

      // Guard: query too long → 400.
      if (q.length > 200) {
        return Response.json({ error: 'query too long' }, { status: 400 })
      }

      // ── Resolve field names ───────────────────────────────────────────────
      const fields = opts.fields ?? {}
      const titleField = fieldName(fields, 'title', 'title')
      const parentField = fieldName(fields, 'parent', 'parent')

      // Build the `where` clause — always search title, add slug if configured.
      // Type as `Where[]` to satisfy Payload's strict Where index-signature.
      const orClauses: Where[] = [{ [titleField]: { like: q } }]

      if (fields.slug !== undefined) {
        const slugField = fieldName(fields, 'slug', 'slug')
        orClauses.push({ [slugField]: { like: q } })
      }

      const where: Where = { or: orClauses }

      // ── First query: find matching docs ──────────────────────────────────
      // Hard cap at 50. If Payload returns exactly 50 we may be truncating;
      // that's intentional — total reflects the capped count.
      // TODO: add `truncated: boolean` to the response once the client consumes it.
      const matchResult = await req.payload.find({
        collection: opts.collectionSlug,
        where,
        limit: 50,
        depth: 0,
      })

      const matchDocs = matchResult.docs as RawDoc[]

      if (matchDocs.length === 0) {
        return Response.json({ results: [], expandIds: [], total: 0 })
      }

      // ── Map matched docs to TreeNodes ─────────────────────────────────────
      const matchNodes = matchDocs.map((doc) => docToSearchNode(doc, fields))

      // ── Compute hasChildren for each match ────────────────────────────────
      // Runs one count query per match in parallel. Acceptable: capped at 50.
      await Promise.all(
        matchNodes.map(async (node) => {
          const countResult = await req.payload.count({
            collection: opts.collectionSlug,
            where: {
              [parentField]: { equals: node.id },
            },
          })
          node.hasChildren = countResult.totalDocs > 0
        }),
      )

      // ── Build ancestor map ────────────────────────────────────────────────
      const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH

      // Pass a payload-compatible object to buildAncestorMap.
      // We only need `find` there; cast narrowly to avoid importing full Payload.
      const payloadForAncestors = {
        find: (args: Record<string, unknown>) =>
          req.payload.find(args as Parameters<typeof req.payload.find>[0]),
      }

      const byId = await buildAncestorMap(
        matchNodes,
        payloadForAncestors,
        opts.collectionSlug,
        fields,
        maxDepth,
      )

      // ── Compute expandIds ─────────────────────────────────────────────────
      // Union of all ancestor IDs across all matched nodes, deduped.
      const expandIdSet = new Set<string | number>()

      for (const node of matchNodes) {
        const { ancestorIds } = resolveAncestors(node.id, byId)
        for (const id of ancestorIds) {
          expandIdSet.add(id)
        }
      }

      const expandIds = Array.from(expandIdSet)

      // ── Build response ────────────────────────────────────────────────────
      // total reflects the number of results returned (≤ 50), not the
      // uncapped DB count. See guard rail note above.
      const total = matchNodes.length

      return Response.json({ results: matchNodes, expandIds, total })
    } catch (err) {
      // Log full error server-side; return a safe terse message.
      console.error('[content-tree-plugin] /api/tree/search error:', err)
      const message = err instanceof Error ? err.message : 'Unknown error'
      return Response.json({ error: message }, { status: 500 })
    }
  },
})
