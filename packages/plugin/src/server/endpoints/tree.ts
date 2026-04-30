/**
 * GET /api/tree-{collectionSlug}
 *
 * Returns the full nested tree, or — when ?parentId= is set — the
 * direct children of that parent for lazy-load.
 *
 * TODO(v0.1): port from FRAS spike route handler. Once buildTreeNodes
 * is implemented, this is a 30-line wrapper.
 */

import type { Endpoint } from 'payload'
import type { ContentTreePluginOptions } from '../../shared/types'

export const treeEndpoint = (opts: ContentTreePluginOptions): Endpoint => ({
  path: `/tree-${opts.collectionSlug}`,
  method: 'get',
  handler: async (req) => {
    void req
    void opts
    // TODO(v0.1): payload.find + buildTreeNodes + branch on parentId
    return Response.json({ nodes: [], total: 0 })
  },
})
