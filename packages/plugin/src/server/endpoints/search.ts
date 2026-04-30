/**
 * GET /api/tree-{collectionSlug}/search?q=
 *
 * Case-insensitive partial match on title + slug, returns matches plus
 * the union of ancestor IDs so the client can auto-expand to matches.
 *
 * TODO(v0.1): port from FRAS spike search route. Use resolveAncestors.
 */

import type { Endpoint } from 'payload'
import type { ContentTreePluginOptions } from '../../shared/types'

export const searchEndpoint = (opts: ContentTreePluginOptions): Endpoint => ({
  path: `/tree-${opts.collectionSlug}/search`,
  method: 'get',
  handler: async (req) => {
    void req
    void opts
    // TODO(v0.1): implement
    return Response.json({ results: [], expandIds: [], total: 0 })
  },
})
