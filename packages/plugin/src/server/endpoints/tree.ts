/**
 * @description
 * GET /api/tree-{collectionSlug}
 *
 * Returns the full nested tree (default) or the direct children of a given
 * parent node when the `?parentId=` query param is present (lazy-load mode).
 *
 * Query parameters:
 *  - `parentId` (optional) — ID of the parent node to lazy-load children for.
 *    Omit to get the full nested tree.
 *
 * Response shape:
 *  - Success: `{ nodes: TreeNode[], total: number }`
 *  - Error:   `{ error: string }` with HTTP 500 (stack trace NOT included)
 *
 * @dependencies
 *  - payload: `Endpoint` type
 *  - ../../shared/types: `ContentTreePluginOptions`
 *  - ../../shared/constants: `DEFAULT_MAX_DEPTH`
 *  - ../helpers/buildTreeNodes: `buildTreeNodes`
 */

import type { Endpoint } from 'payload'
import type { ContentTreePluginOptions } from '../../shared/types'
import { DEFAULT_MAX_DEPTH } from '../../shared/constants'
import { buildTreeNodes } from '../helpers/buildTreeNodes'

export const treeEndpoint = (opts: ContentTreePluginOptions): Endpoint => ({
  path: `/tree-${opts.collectionSlug}`,
  method: 'get',
  handler: async (req) => {
    try {
      // Parse optional parentId from the query string.
      // req.url may be undefined in some Payload versions; fall back gracefully.
      const url = new URL(req.url ?? '/', 'http://localhost')
      const rawParentId = url.searchParams.get('parentId')

      // Normalise: empty string → null (full-tree mode)
      const parentId =
        rawParentId !== null && rawParentId.trim() !== ''
          ? // Prefer numeric IDs when the value looks like an integer
            /^\d+$/.test(rawParentId)
            ? Number(rawParentId)
            : rawParentId
          : null

      const result = await buildTreeNodes({
        payload: req.payload,
        collectionSlug: opts.collectionSlug,
        fields: opts.fields ?? {},
        parentId,
        maxDepth: opts.maxDepth ?? DEFAULT_MAX_DEPTH,
      })

      return Response.json(result)
    } catch (err) {
      // Log the full error server-side but only return a safe message
      console.error('[content-tree-plugin] /api/tree error:', err)
      const message = err instanceof Error ? err.message : 'Unknown error'
      return Response.json({ error: message }, { status: 500 })
    }
  },
})
