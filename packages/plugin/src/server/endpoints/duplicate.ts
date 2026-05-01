/**
 * @description
 * POST /api/tree-{collectionSlug}/duplicate/{id}
 *
 * Duplicates an existing tree node (Payload document) by fetching the source,
 * stripping managed fields, adjusting the title/slug, computing a new sortOrder,
 * and creating the new document.
 *
 * Response shape:
 *  - 200: `{ ok: true, doc: <new doc> }`
 *  - 401: `{ error: 'unauthenticated' }` — no req.user
 *  - 404: `{ error: 'source not found' }` — ID does not exist in collection
 *  - 500: `{ error: '<safe message>' }` — unexpected server error (no stack in body)
 *
 * Behavior:
 *  1. Gate on req.user — unauthenticated requests return 401.
 *  2. Fetch source doc by ID at depth: 0 (scalar IDs in relationships).
 *  3. Strip Payload-managed fields: id, createdAt, updatedAt, _status.
 *  4. Append ' (copy)' to the title field (respects opts.fields.title override).
 *  5. Append '-copy-<Date.now().toString(36)>' to the slug field if configured.
 *  6. Compute new sortOrder = (max sibling sortOrder) + 10. Siblings are docs
 *     sharing the same parent field value. Falls back to 0 if no siblings exist.
 *  7. Create the new doc via payload.create.
 *  8. Return { ok: true, doc: <created doc> }.
 *
 * @dependencies
 *  - payload: `Endpoint` type
 *  - ../../shared/types: `ContentTreePluginOptions`
 */

import type { Endpoint } from 'payload'
import type { ContentTreePluginOptions } from '../../shared/types'

// ---------------------------------------------------------------------------
// Internal type: raw doc shape returned by payload.findByID at depth: 0
// ---------------------------------------------------------------------------

type RawDoc = Record<string, unknown>

// ---------------------------------------------------------------------------
// Field-name resolution (same pattern as tree.ts / search.ts)
// ---------------------------------------------------------------------------

/**
 * Resolve effective field name from opts.fields override, falling back to the
 * Payload convention default.
 */
function fieldName(
  fields: NonNullable<ContentTreePluginOptions['fields']>,
  key: keyof NonNullable<ContentTreePluginOptions['fields']>,
  defaultName: string,
): string {
  const override = fields[key]
  // workflowState and lockedBy can be `false` (opt-out); treat as disabled
  if (override === false || override === undefined) return defaultName
  return override
}

/**
 * Extract the raw parent ID from a doc's parent field value.
 * Handles scalar IDs and Payload polymorphic relationship objects at depth 0.
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

// ---------------------------------------------------------------------------
// Endpoint factory
// ---------------------------------------------------------------------------

export const duplicateEndpoint = (opts: ContentTreePluginOptions): Endpoint => ({
  path: `/tree-${opts.collectionSlug}/duplicate/:id`,
  method: 'post',
  handler: async (req) => {
    // ── 1. Auth gate ────────────────────────────────────────────────────────
    if (!req.user) {
      return Response.json({ error: 'unauthenticated' }, { status: 401 })
    }

    // ── 2. Extract ID from path params ─────────────────────────────────────
    // Payload injects route params into req.routeParams for custom endpoints.
    const rawId = (req.routeParams as Record<string, string> | undefined)?.id
    if (!rawId) {
      return Response.json({ error: 'missing id' }, { status: 400 })
    }

    // Normalise: prefer numeric ID when the value looks like an integer
    const id: string | number = /^\d+$/.test(rawId) ? Number(rawId) : rawId

    try {
      const fields = opts.fields ?? {}
      const titleField = fieldName(fields, 'title', 'title')
      const slugField = fields.slug !== undefined ? fieldName(fields, 'slug', 'slug') : null
      const parentField = fieldName(fields, 'parent', 'parent')
      const sortOrderField = fieldName(fields, 'sortOrder', 'sortOrder')

      // ── 3. Fetch source document ──────────────────────────────────────────
      let source: RawDoc | null = null
      try {
        source = (await req.payload.findByID({
          collection: opts.collectionSlug,
          id,
          depth: 0,
        })) as RawDoc
      } catch {
        // payload.findByID throws a NotFound error when the doc doesn't exist
        return Response.json({ error: 'source not found' }, { status: 404 })
      }

      if (source === null || source === undefined) {
        return Response.json({ error: 'source not found' }, { status: 404 })
      }

      // ── 4. Strip Payload-managed fields ──────────────────────────────────
      // These fields are auto-populated by Payload on create; including them
      // in the create call would conflict with Payload's internal logic.
      const MANAGED_FIELDS = new Set(['id', 'createdAt', 'updatedAt', '_status'])
      const newDoc: RawDoc = {}
      for (const [k, v] of Object.entries(source)) {
        if (!MANAGED_FIELDS.has(k)) {
          newDoc[k] = v
        }
      }

      // ── 5. Mutate title — append ' (copy)' ───────────────────────────────
      const originalTitle =
        typeof source[titleField] === 'string' ? (source[titleField] as string) : ''
      newDoc[titleField] = `${originalTitle} (copy)`

      // ── 6. Mutate slug — append '-copy-<base36 timestamp>' ───────────────
      // Only when slug is configured AND the source doc has a slug value.
      if (slugField !== null) {
        const originalSlug =
          typeof source[slugField] === 'string' ? (source[slugField] as string) : ''
        if (originalSlug.length > 0) {
          newDoc[slugField] = `${originalSlug}-copy-${Date.now().toString(36)}`
        }
      }

      // ── 7. Compute sortOrder = max sibling sortOrder + 10 ─────────────────
      // "Siblings" share the same parent field value as the source doc.
      const sourceParentId = extractParentId(source[parentField])

      let maxSiblingSort = 0
      try {
        const siblingResult = await req.payload.find({
          collection: opts.collectionSlug,
          depth: 0,
          limit: 0, // fetch all siblings
          where: {
            [parentField]: sourceParentId === null ? { equals: null } : { equals: sourceParentId },
          },
        })

        const siblingDocs = siblingResult.docs as RawDoc[]
        for (const sib of siblingDocs) {
          const sibSort =
            typeof sib[sortOrderField] === 'number' ? (sib[sortOrderField] as number) : 0
          if (sibSort > maxSiblingSort) {
            maxSiblingSort = sibSort
          }
        }
      } catch {
        // Non-fatal: fall back to 0 if sibling query fails
        maxSiblingSort = 0
      }

      newDoc[sortOrderField] = maxSiblingSort + 10

      // ── 8. Create new document ────────────────────────────────────────────
      const created = await req.payload.create({
        collection: opts.collectionSlug,
        data: newDoc as Parameters<typeof req.payload.create>[0]['data'],
      })

      return Response.json({ ok: true, doc: created })
    } catch (err) {
      // Log full error server-side; return a safe terse message to the client
      console.error('[content-tree-plugin] /api/tree/duplicate error:', err)
      const message = err instanceof Error ? err.message : 'Unknown error'
      return Response.json({ error: message }, { status: 500 })
    }
  },
})
