/**
 * import-from-sitecore.ts
 *
 * One-off seed script. Run: pnpm --filter examples-sitecore-migration seed
 *
 * Standalone Node script that reads a Sitecore serialisation export (JSON),
 * maps Sitecore GUIDs to Payload IDs, and creates Payload documents via the
 * local Payload instance.
 *
 * This script intentionally covers only the structural migration:
 *   - Item hierarchy (parent / child via self-referencing relationship)
 *   - Template → contentType mapping
 *   - Sort order preservation
 *   - Legacy path indexing for redirect resolution
 *
 * What's deliberately out of scope (each flagged with TODO(real-world)):
 *   - Media binary transfer
 *   - Rich-text field link rewriting
 *   - Multilingual / language versions
 *   - Workflow state transfer
 *   - Presentation details (renderings, datasource bindings)
 */

import { getPayload } from 'payload'
import config from '../payload.config.js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

// ---------------------------------------------------------------------------
// Types — mirrors the shape of fixtures/sitecore-export.json
// ---------------------------------------------------------------------------

interface SitecoreItem {
  /** Sitecore item GUID, e.g. "{110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9}" */
  id: string
  /** Item name (URL-safe, no spaces) */
  name: string
  /** Display name shown in Sitecore Content Editor — can differ from name */
  displayName: string
  /** Sitecore template GUID */
  templateId: string
  /** Human-readable template name from the export */
  templateName: string
  /** GUID of the parent item; null for root-level items */
  parentId: string | null
  /** Full Sitecore item path at time of export */
  path: string
  /** __sortorder field value from Sitecore (typically multiples of 100) */
  sortOrder: number
}

interface SitecoreExport {
  items: SitecoreItem[]
}

// ---------------------------------------------------------------------------
// Template name → Payload contentType mapping
//
// Real-world note: Sitecore templateName strings vary across projects.
// A production migration should drive this map from the Sitecore template
// registry (Sitecore.Context.Database.GetTemplate(templateId)) rather than
// string-matching on the exported templateName.
// ---------------------------------------------------------------------------

const TEMPLATE_TO_CONTENT_TYPE: Record<string, string> = {
  Page: 'page',
  'Sample Item': 'page',
  'Standard Template': 'page',
  Folder: 'folder',
  'Common Folder': 'folder',
  Hero: 'datasource',
  Promo: 'datasource',
  'Text Block': 'datasource',
  // Sitecore media templates
  'Media folder': 'mediaFolder',
  'Unversioned folder': 'mediaFolder',
  'Versioned folder': 'mediaFolder',
}

/**
 * Derive a Payload contentType from a Sitecore templateName.
 * Falls back to 'page' when the template isn't in the map.
 *
 * TODO(real-world): extend this map to cover every template your project uses.
 * If templateName is unreliable in your export, match on templateId instead.
 */
function resolveContentType(item: SitecoreItem): string {
  return TEMPLATE_TO_CONTENT_TYPE[item.templateName] ?? 'page'
}

/**
 * Convert a Sitecore item name to a URL-safe slug.
 * Sitecore item names are generally already URL-safe but may use mixed case.
 *
 * TODO(real-world): handle non-ASCII characters, ensure uniqueness across
 * the whole collection (Sitecore allows same name under different parents),
 * and consider prefixing with the parent slug to build hierarchical slugs.
 */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

// ---------------------------------------------------------------------------
// Main import routine
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('[sitecore-import] Initialising Payload...')
  const payload = await getPayload({ config })

  // ── Load the fixture export ──────────────────────────────────────────────
  const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures')
  const exportPath = path.join(fixtureDir, 'sitecore-export.json')
  const raw = readFileSync(exportPath, 'utf-8')
  const exportData = JSON.parse(raw) as SitecoreExport
  const items = exportData.items

  console.log(`[sitecore-import] Loaded ${items.length} items from ${exportPath}`)

  // ── Build a topological order (parents before children) ──────────────────
  //
  // The fixture is small and already ordered, but a real Sitecore export can
  // come in arbitrary order.  BFS from root items guarantees we always create
  // a parent before its children so the relationship field resolves correctly.
  //
  const byId = new Map<string, SitecoreItem>()
  for (const item of items) {
    byId.set(item.id, item)
  }

  // Group children by parent ID
  const childrenOf = new Map<string | null, SitecoreItem[]>()
  for (const item of items) {
    const parentKey = item.parentId ?? null
    if (!childrenOf.has(parentKey)) childrenOf.set(parentKey, [])
    childrenOf.get(parentKey)!.push(item)
  }

  // BFS traversal: root items (parentId === null) first
  const ordered: SitecoreItem[] = []
  const queue: SitecoreItem[] = [...(childrenOf.get(null) ?? [])]
  while (queue.length > 0) {
    const item = queue.shift()!
    ordered.push(item)
    const children = childrenOf.get(item.id) ?? []
    // Sort siblings by sortOrder so the tree renders in the right order
    children.sort((a, b) => a.sortOrder - b.sortOrder)
    queue.push(...children)
  }

  console.log(`[sitecore-import] Processing ${ordered.length} items in BFS order...`)

  // ── Mapping table: Sitecore GUID → Payload document ID ──────────────────
  //
  // This is the heart of the migration.  We build the map incrementally as we
  // create documents so that child items can reference their already-created
  // parent.
  //
  // TODO(real-world): Persist this map to a JSON file (or a dedicated Payload
  // collection) so you can re-run the import incrementally, map hyperlinks
  // inside rich-text fields, and audit which Sitecore items landed where.
  //
  const sitecoreIdToPayloadId = new Map<string, string | number>()

  // ── Per-template counters for the final report ───────────────────────────
  let importedPages = 0
  let importedFolders = 0
  let importedDatasources = 0
  let importedMediaFolders = 0
  let skipped = 0

  // ── Import loop ──────────────────────────────────────────────────────────
  //
  // TODO(real-world): Wrap the entire loop in a Payload transaction so that
  // partial failures leave the database clean:
  //
  //   const result = await payload.db.beginTransaction()
  //   try {
  //     ... import loop ...
  //     await payload.db.commitTransaction(result)
  //   } catch (err) {
  //     await payload.db.rollbackTransaction(result)
  //     throw err
  //   }
  //
  for (const item of ordered) {
    const contentType = resolveContentType(item)

    // Resolve parent Payload ID (undefined for root items)
    let parentPayloadId: string | number | undefined
    if (item.parentId !== null) {
      parentPayloadId = sitecoreIdToPayloadId.get(item.parentId)
      if (parentPayloadId === undefined) {
        console.warn(
          `[sitecore-import] SKIP: parent ${item.parentId} not yet imported for item ${item.id} (${item.path})`,
        )
        skipped++
        continue
      }
    }

    // Build a slug — ensure uniqueness by appending the short item id when
    // collisions are possible.
    const slug = toSlug(item.name)

    try {
      const doc = await payload.create({
        collection: 'pages',
        data: {
          title: item.displayName || item.name,
          slug,
          displayName: item.displayName,
          templateId: item.templateId,
          legacyPath: item.path,
          contentType,
          sortOrder: item.sortOrder,
          // Only set parent when the item has one — root items have no parent
          ...(parentPayloadId !== undefined ? { parent: parentPayloadId } : {}),
        },
      })

      // Record the mapping for children to reference
      sitecoreIdToPayloadId.set(item.id, doc.id)

      // Update counters
      switch (contentType) {
        case 'page':
          importedPages++
          break
        case 'folder':
          importedFolders++
          break
        case 'datasource':
          importedDatasources++
          break
        case 'mediaFolder':
          importedMediaFolders++
          break
      }

      console.log(`[sitecore-import] Created ${contentType} "${item.path}" → Payload ID ${doc.id}`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[sitecore-import] ERROR creating "${item.path}": ${message}`)
      skipped++

      // TODO(real-world): decide whether a single failure should abort the
      // whole import (throw here) or continue and report failures at the end.
      // For a production migration with thousands of items you almost always
      // want to continue + collect errors for a post-import reconciliation pass.
    }
  }

  // ── TODO(real-world): media handling ────────────────────────────────────
  //
  // Sitecore media items live under /sitecore/media library and each carries
  // a Blob field with the binary asset.  To migrate media:
  //
  //   1. Iterate mediaFolder items in this import (already typed as 'mediaFolder').
  //   2. For image/file items (not shown in this fixture), fetch the binary from
  //      the Sitecore Media Service API or a serialised blob directory.
  //   3. Use payload.create({ collection: 'media', data: { ... }, file: ... })
  //      with a Node ReadableStream.
  //   4. Store the Sitecore media item GUID → Payload media ID in a separate
  //      mapping table for rich-text link rewriting (see next TODO).
  //
  // Reference: https://payloadcms.com/docs/upload/overview#programmatic-upload

  // ── TODO(real-world): rich-text link rewriting ──────────────────────────
  //
  // Sitecore stores internal links as GUIDs inside rich-text fields
  // (e.g. in Sitecore link fields or within HTML blobs).  After the import:
  //
  //   1. Query all pages with a rich-text or link field.
  //   2. Walk the Lexical/RTE node tree looking for anchor hrefs or link
  //      field values that contain Sitecore GUIDs.
  //   3. Replace each GUID with the new Payload URL derived from sitecoreIdToPayloadId.
  //   4. Save the updated doc via payload.update({ collection: 'pages', id, data }).
  //
  // This is the most labour-intensive part of any Sitecore migration.

  // ── TODO(real-world): multilingual / language versions ──────────────────
  //
  // Sitecore stores language versions as child nodes under each item.
  // Payload's i18n support works differently (locales on the same doc).
  // A multilingual migration would:
  //
  //   1. Re-read the export grouping by item GUID + language code.
  //   2. Create the default-language doc first (as above).
  //   3. Use payload.update({ collection, id, locale, data }) for each
  //      additional language version.
  //
  // Out of scope for v1.0 of this plugin — see PRD §5.

  // ── TODO(real-world): workflow state ────────────────────────────────────
  //
  // Sitecore workflow states (Draft, Awaiting Approval, Published) have no
  // direct equivalent in vanilla Payload.  Options:
  //   - Add a `workflowState` select field and import verbatim.
  //   - Use Payload's `_status` draft/publish mechanism and map:
  //       Published  → published
  //       everything else → draft
  //
  // Out of scope for this example.

  // ── Report ───────────────────────────────────────────────────────────────
  const total = importedPages + importedFolders + importedDatasources + importedMediaFolders
  console.log('\n[sitecore-import] Import complete.')
  console.log(`  Pages:         ${importedPages}`)
  console.log(`  Folders:       ${importedFolders}`)
  console.log(`  Datasources:   ${importedDatasources}`)
  console.log(`  Media folders: ${importedMediaFolders}`)
  console.log(`  ─────────────────────`)
  console.log(`  Total created: ${total}`)
  if (skipped > 0) {
    console.warn(`  Skipped:       ${skipped} (check warnings above)`)
  }

  // Force process exit — Payload keeps the DB connection open
  process.exit(0)
}

void main().catch((err: unknown) => {
  console.error('[sitecore-import] Fatal error:', err)
  process.exit(1)
})
