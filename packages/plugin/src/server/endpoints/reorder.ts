/**
 * @description
 * POST /api/tree-{collectionSlug}/reorder
 *
 * Moves a tree node to a new parent at a specific insertion index. Delegates
 * the actual DB work to `reorderNodes`, which handles cycle detection, depth
 * checks, and sibling re-numbering atomically.
 *
 * Request body shape:
 *   {
 *     nodeId: string | number     // moved node
 *     newParentId: string | number | null  // new parent; null = move to root
 *     newIndex: number            // zero-based insertion index
 *   }
 *
 * Response shape:
 *  - 200: `{ ok: true }`
 *  - 400: `{ error: '<validation or helper error>' }`
 *  - 401: `{ error: 'unauthenticated' }` — no req.user
 *  - 500: `{ error: '<safe message>' }` — unexpected server error (no stack in body)
 *
 * @dependencies
 *  - payload: `Endpoint` type
 *  - ../../shared/types: `ContentTreePluginOptions`
 *  - ../helpers/reorderNodes: `reorderNodes`
 *  - ../../shared/constants: `DEFAULT_MAX_DEPTH`
 */

import type { Endpoint } from 'payload'
import type { ContentTreePluginOptions } from '../../shared/types'
import { reorderNodes } from '../helpers/reorderNodes'
import { DEFAULT_MAX_DEPTH } from '../../shared/constants'

// ---------------------------------------------------------------------------
// Request body type (after JSON parse + validation)
// ---------------------------------------------------------------------------

interface ReorderBody {
  nodeId: string | number
  newParentId: string | number | null
  newIndex: number
}

// ---------------------------------------------------------------------------
// Body validation helper
// ---------------------------------------------------------------------------

/**
 * Parse and validate the request body for the reorder endpoint.
 *
 * Returns a `ReorderBody` when valid, or a string describing the validation
 * error when invalid.
 *
 * Rules:
 *  - `nodeId` must be a non-empty string or a number
 *  - `newParentId` must be a non-empty string, a number, or exactly null
 *  - `newIndex` must be a number (integers expected; floats are coerced by
 *    `reorderNodes` via Math.max/min clamping)
 */
function validateBody(raw: unknown): ReorderBody | string {
  if (typeof raw !== 'object' || raw === null) {
    return 'invalid request body'
  }

  const body = raw as Record<string, unknown>

  // ── nodeId ────────────────────────────────────────────────────────────────
  const nodeId = body['nodeId']
  if (
    nodeId === undefined ||
    nodeId === null ||
    (typeof nodeId !== 'string' && typeof nodeId !== 'number') ||
    (typeof nodeId === 'string' && nodeId.trim().length === 0)
  ) {
    return 'invalid request body'
  }

  // ── newParentId ───────────────────────────────────────────────────────────
  // null is explicitly allowed (move to root); undefined is not.
  const newParentId = body['newParentId']
  if (
    newParentId !== null &&
    (newParentId === undefined ||
      (typeof newParentId !== 'string' && typeof newParentId !== 'number') ||
      (typeof newParentId === 'string' && newParentId.trim().length === 0))
  ) {
    return 'invalid request body'
  }

  // ── newIndex ──────────────────────────────────────────────────────────────
  const newIndex = body['newIndex']
  if (typeof newIndex !== 'number') {
    return 'invalid request body'
  }

  return {
    nodeId: nodeId as string | number,
    newParentId: newParentId as string | number | null,
    newIndex,
  }
}

// ---------------------------------------------------------------------------
// Endpoint factory
// ---------------------------------------------------------------------------

/**
 * Build the POST /api/tree-{collectionSlug}/reorder Payload endpoint.
 *
 * @param opts - Plugin options. Uses `opts.collectionSlug`, `opts.fields`,
 *   and `opts.maxDepth`.
 */
export const reorderEndpoint = (opts: ContentTreePluginOptions): Endpoint => ({
  path: `/tree-${opts.collectionSlug}/reorder`,
  method: 'post',
  handler: async (req) => {
    // ── 1. Auth gate ──────────────────────────────────────────────────────────
    if (!req.user) {
      return Response.json({ error: 'unauthenticated' }, { status: 401 })
    }

    // ── 2. Parse + validate body ──────────────────────────────────────────────
    // PayloadRequest extends Partial<Request>, so req.json is optional at the
    // type level. In custom endpoints Payload does not pre-populate req.data,
    // so we must call req.json() ourselves. Guard the optional call and catch
    // any parse errors (malformed JSON / missing content-type).
    let rawBody: unknown
    try {
      if (typeof req.json !== 'function') {
        return Response.json({ error: 'invalid request body' }, { status: 400 })
      }
      rawBody = await req.json()
    } catch {
      return Response.json({ error: 'invalid request body' }, { status: 400 })
    }

    const validated = validateBody(rawBody)
    if (typeof validated === 'string') {
      return Response.json({ error: validated }, { status: 400 })
    }

    const { nodeId, newParentId, newIndex } = validated

    // ── 3. Delegate to reorderNodes ────────────────────────────────────────────
    try {
      const result = await reorderNodes({
        payload: req.payload,
        collectionSlug: opts.collectionSlug,
        fields: opts.fields ?? {},
        nodeId,
        newParentId,
        newIndex,
        maxDepth: opts.maxDepth ?? DEFAULT_MAX_DEPTH,
        req,
      })

      // ── 4. Map result ──────────────────────────────────────────────────────
      if (result.ok) {
        return Response.json({ ok: true }, { status: 200 })
      }

      // Helper returned a validation error — forward verbatim
      return Response.json({ error: result.error }, { status: 400 })
    } catch (err) {
      // Unexpected DB or runtime error — log full details server-side
      console.error('[content-tree-plugin] /api/tree/reorder error:', err)
      const message = err instanceof Error ? err.message : 'Unknown error'
      return Response.json({ error: message }, { status: 500 })
    }
  },
})
