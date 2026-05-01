# Migrating to @garsoncron/payload-plugin-content-tree

> Two common starting points are covered: Payload's `@payloadcms/plugin-nested-docs` (the easy
> path) and Sitecore CD/CM (the medium path — data export + transform). If you're starting fresh
> with no existing content, see [./examples/basic](./examples/basic) instead.

Migrations are messy. This guide is honest about what that means: expect a backfill script, a
schema change, and a smoke-test pass. It does not promise zero-downtime or automated tooling that
doesn't exist yet.

## Table of contents

- [Required collection shape](#required-collection-shape)
- [From @payloadcms/plugin-nested-docs](#from-payloadcmsplugin-nested-docs) — the easy path
- [From Sitecore](#from-sitecore) — the medium path (data export + transform)
- [After the migration](#after-the-migration)
- [Common gotchas](#common-gotchas)

---

## Required collection shape

The plugin **does not inject fields** into your collection. You define them; the plugin validates
them at `buildConfig` time and throws a copy-pasteable error if anything is missing or mistyped.

| Field | Payload type | Role | Required |
|---|---|---|---|
| `parent` | `relationship` (self) | Points to the parent node; `null` = root | yes |
| `sortOrder` | `number` | Zero-based position among siblings | yes |
| `contentType` | `select` | Drives the insert-options table (Sitecore parity) | yes |
| `title` | `text` (or any text-ish field) | Displayed in the tree row | yes |
| `slug` | `text` | Used by deep search; indexed | no |
| `workflowState` | `select` | Shown as a colored gutter dot | no — only if mapped via `fields.workflowState` |
| `lockedBy` | `relationship` to users | Shown as a lock icon | no — only if mapped via `fields.lockedBy` |

All four required field names can be overridden via the plugin's `fields` option if your existing
collection uses different names:

```ts
contentTreePlugin({
  collectionSlug: 'pages',
  fields: {
    parent: 'parentPage',      // default: 'parent'
    sortOrder: 'order',        // default: 'sortOrder'
    contentType: 'template',   // default: 'contentType'
    title: 'name',             // default: 'title'
  },
})
```

To verify your collection passes validation before wiring up the plugin in production, run the
bundled CLI against your dev database:

```bash
DATABASE_URI=postgres://... pnpm --filter @garsoncron/payload-plugin-content-tree compat-check pages
```

The validator source is at
[`./packages/plugin/src/server/helpers/validateCollection.ts`](./packages/plugin/src/server/helpers/validateCollection.ts)
— read it to see exactly what is checked and in what order.

---

## From @payloadcms/plugin-nested-docs

This is the easier migration. `@payloadcms/plugin-nested-docs` already writes a `parent`
relationship field and maintains a `breadcrumbs` array on each document. You're adding three
things: `sortOrder`, `contentType`, and the tree view itself.

### Step 1 — Add the missing fields to your collection

```ts
// collections/Pages.ts (excerpt — add these two fields)
{
  name: 'sortOrder',
  type: 'number',
  defaultValue: 0,
},
{
  name: 'contentType',
  type: 'select',
  defaultValue: 'page',
  options: [
    { label: 'Page', value: 'page' },
    { label: 'Folder', value: 'folder' },
    // Add whatever types your site uses
  ],
},
```

Make sure `title: text` already exists — nested-docs doesn't add it, but most Payload collections
have it.

### Step 2 — Run the schema migration

On the next Payload boot, Drizzle (or MongoDB) will add the two new columns. For SQL adapters this
happens automatically on `pnpm dev` or `payload migrate`. Verify the migration generated cleanly
before running the backfill.

> **Important:** run the schema migration BEFORE any bulk data backfill. Payload's drizzle-based
> adapters auto-migrate on boot but not during bulk inserts — a missing column during a `payload.update`
> loop will throw with a cryptic DB error.

### Step 3 — Backfill sortOrder

Existing documents all have `sortOrder = null` (or the default 0). The tree will render but the
order will be arbitrary until you backfill. Run one of the following:

**Option A — Direct SQL (Postgres)**

```sql
UPDATE pages
SET "sortOrder" = sub.rn - 1
FROM (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE(parent, '00000000-0000-0000-0000-000000000000')
           ORDER BY "createdAt"
         ) - 1 AS rn
  FROM pages
) sub
WHERE pages.id = sub.id;
```

This groups siblings by their parent and numbers them `0, 1, 2, …` in creation order. Adjust the
`createdAt` column name for your adapter (SQLite uses `created_at`; Postgres uses `"createdAt"`
by default in Payload).

**Option B — Payload migration script (portable)**

Create `migrations/backfill-sortorder.ts` and run it with `tsx`:

```ts
// migrations/backfill-sortorder.ts
import { getPayload } from 'payload'
import config from '../payload.config'

async function backfill() {
  const payload = await getPayload({ config })

  // Fetch all pages, ordered by createdAt so siblings get a stable sequence
  const { docs } = await payload.find({
    collection: 'pages',
    depth: 0,
    limit: 0,       // fetch all
    sort: 'createdAt',
  })

  // Group by parent ID (null = root)
  const byParent = new Map<string, typeof docs>()
  for (const doc of docs) {
    const parentKey = doc.parent ? String(doc.parent) : '__root__'
    if (!byParent.has(parentKey)) byParent.set(parentKey, [])
    byParent.get(parentKey)!.push(doc)
  }

  // Write sortOrder for each sibling group
  let updated = 0
  for (const siblings of byParent.values()) {
    for (let i = 0; i < siblings.length; i++) {
      const doc = siblings[i]!
      await payload.update({
        collection: 'pages',
        id: doc.id,
        data: { sortOrder: i },
      })
      updated++
    }
  }

  console.log(`Backfilled sortOrder on ${updated} pages.`)
  process.exit(0)
}

backfill().catch((err) => { console.error(err); process.exit(1) })
```

```bash
npx tsx migrations/backfill-sortorder.ts
```

### Step 4 — Backfill contentType

If your collection already has a template or category field, alias it via the `fields` option
(Step 6). Otherwise set a default and normalize later:

```ts
// One-time normalization — run once, then remove
await payload.db.drizzle.execute(sql`UPDATE pages SET "contentType" = 'page' WHERE "contentType" IS NULL`)
```

### Step 5 — (Optional) normalize lockedBy after import

If `lockedBy` documents were set during import or testing, clear them before going live:

```sql
UPDATE pages SET "lockedBy" = NULL;
```

### Step 6 — Update payload.config.ts

The two plugins compose cleanly — nested-docs maintains `parent` + `breadcrumbs`; the tree plugin
reads `parent` and renders the UI. They do not conflict.

```ts
import { nestedDocsPlugin } from '@payloadcms/plugin-nested-docs'
import { contentTreePlugin } from '@garsoncron/payload-plugin-content-tree'

export default buildConfig({
  plugins: [
    nestedDocsPlugin({
      collections: ['pages'],
      generateLabel: (_, doc) => doc.title as string,
      generateURL: (docs) => docs.reduce((url, doc) => `${url}/${doc.slug}`, ''),
    }),
    contentTreePlugin({
      collectionSlug: 'pages',
      insertOptions: {
        root:   ['page', 'folder'],
        folder: ['page', 'folder'],
        page:   ['page'],
      },
      contentTypeLabels: {
        page:   'Page',
        folder: 'Folder',
      },
    }),
  ],
})
```

> **Note:** nested-docs adds breadcrumbs that this plugin does not auto-render. Keep nested-docs
> in the config if your front-end consumes `breadcrumbs`. The two plugins share the `parent`
> field without conflict.

### What's out of scope for this path

- **Multilingual variants** — if you use `@payloadcms/plugin-i18n` or Payload's locale system,
  verify that the `title` field is in the default locale. The tree reads `title` at depth 0.
- **Workflow state** — if your collection has a `status` field, map it via
  `fields: { workflowState: 'status' }` to show the gutter dot. The plugin does not manage the
  field; it only reads it.

---

## From Sitecore

### Which path applies to you?

- **Starting fresh (greenfield Payload project)** — Use the runnable seed script and scaffolded
  collection in [./examples/sitecore-migration](./examples/sitecore-migration). That example walks
  through the full import narrative and is the canonical reference.

- **Live site (you have existing Sitecore content to migrate)** — Follow the strategy below.

### Field mapping

| Sitecore concept | Payload field (this plugin) | Notes |
|---|---|---|
| `Item.ID` (GUID) | `id` (auto-generated) | Build a GUID → Payload ID lookup table during import |
| `Item.TemplateName` / `Item.TemplateID` | `contentType` (select) | Normalize to your enum values during transform |
| `Item.ParentID` | `parent` (relationship → self) | Must be resolved via the GUID lookup table |
| `Item.SortOrder` | `sortOrder` (number) | Sitecore stores this as an integer; import directly |
| `Item.DisplayName` | `title` (text) | Prefer `DisplayName` over `Name` for editorial readability |
| `Item.ItemPath` (`/sitecore/content/…`) | `legacyPath` (text, indexed) | Add this field to your collection; use for 301 redirects |
| Datasource items | separate non-tree collection | Do not put datasources in the pages tree |
| Media Library items | Payload Media collection | Import via `payload.create` in the `media` collection |
| Renderings / placeholders | beyond scope | Handle separately — often a Puck or custom field |

> **`legacyPath` is not a plugin field.** Add it yourself if you need it:
>
> ```ts
> { name: 'legacyPath', type: 'text', index: true }
> ```
>
> Your redirect middleware reads `legacyPath` and issues a 301 when a Sitecore URL is hit.

### Migration strategy (live site)

Migrations from a live Sitecore site are a multi-step process. Budget time for at least one dry
run before cutover.

**1. Export from Sitecore**

Use the [Sitecore CLI](https://doc.sitecore.com/xp/en/developers/103/developer-tools/sitecore-command-line-interface.html)
`serialize` command (or SXA's export) to produce a directory of `.yml` item files:

```bash
sitecore ser pull
```

Alternatively, query the Content Delivery API or write a custom Sitecore PowerShell script to
export items as JSON. A flat JSON array per template type is easiest to transform.

**2. Transform to Payload shape**

For each exported item:

1. Build a `guidToPayloadId` map as you process items (or use the Sitecore `Item.ID` directly as
   a stable string key if your DB accepts string IDs).
2. Map `TemplateName` → `contentType` enum value.
3. Resolve `ParentID` via the lookup table.
4. Copy `SortOrder` directly.
5. Store `ItemPath` in `legacyPath`.
6. Skip or flag: items outside `/sitecore/content/`, media items, datasource items, layout items.

**3. Import via Payload — parents first**

The tree is hierarchical, so parents must exist before children can reference them. Sort the
transformed items by depth (count `/` separators in `ItemPath`) before the import loop:

```ts
// Pseudocode — see ./examples/sitecore-migration for the runnable version
const sorted = items.sort((a, b) => depthOf(a.itemPath) - depthOf(b.itemPath))

for (const item of sorted) {
  const created = await payload.create({
    collection: 'pages',
    data: {
      title:       item.displayName,
      contentType: mapTemplate(item.templateName),
      parent:      guidToPayloadId.get(item.parentId) ?? null,
      sortOrder:   item.sortOrder,
      legacyPath:  item.itemPath,
    },
  })
  guidToPayloadId.set(item.id, created.id)
}
```

For the full, runnable import script with error handling and progress logging, see
[./examples/sitecore-migration/README.md](./examples/sitecore-migration/README.md).

**4. Set up redirects**

Once the import is complete, wire a redirect middleware (Next.js `middleware.ts` or an Express
handler) that looks up `legacyPath` in the `pages` collection and issues a 301 to the new URL:

```ts
// Next.js middleware — pseudocode
const result = await payload.find({
  collection: 'pages',
  where: { legacyPath: { equals: req.nextUrl.pathname } },
  limit: 1,
})

if (result.docs[0]) {
  return NextResponse.redirect(new URL(`/${result.docs[0].slug}`, req.url), 301)
}
```

Cache lookup results aggressively — this runs on every request for the redirect window.

**5. Configure payload.config.ts**

```ts
import { contentTreePlugin } from '@garsoncron/payload-plugin-content-tree'

export default buildConfig({
  plugins: [
    contentTreePlugin({
      collectionSlug: 'pages',
      fields: {
        // Override if your migrated collection uses different names
        // parent: 'parent',
        // sortOrder: 'sortOrder',
        // contentType: 'contentType',
        // title: 'title',
      },
      insertOptions: {
        root:   ['page', 'folder', 'landing'],
        folder: ['page', 'folder'],
        page:   ['page'],
      },
      contentTypeLabels: {
        page:    'Page',
        folder:  'Folder',
        landing: 'Landing Page',
      },
      maxDepth: 5,
    }),
  ],
})
```

### What's out of scope for this path

- **Media binaries** — Sitecore media items must be migrated separately (download blobs, upload to
  Payload Media). This guide does not cover media migration.
- **Multilingual variants** — Sitecore's language versions map awkwardly to Payload's locale
  system. Handle this as a separate phase after the tree structure is stable.
- **Workflow state** — Sitecore's workflow states (`Draft`, `Awaiting Approval`, `Published`) can
  be mapped to a `workflowState` select field, but the migration of in-flight items must be
  verified manually. The plugin renders whatever value it finds; it does not enforce workflow
  transitions.
- **Personalization / DMS rules** — beyond scope entirely.
- **Rendering parameters / placeholder settings** — carry these over as raw JSON fields or
  handle separately via a Puck-style page builder integration.

---

## After the migration

Run these checks in order after completing either migration path:

1. **Validate the collection shape** — run the compat-check CLI against your dev database:

   ```bash
   DATABASE_URI=postgres://... pnpm --filter @garsoncron/payload-plugin-content-tree compat-check pages
   ```

   A clean exit means all four required fields pass `validateCollection`. Any failure prints the
   exact field name, expected type, and the `fields.*` override you can use to point at an
   existing field.

2. **Open the tree view** — visit `/admin/tree` and verify the tree renders. Root nodes should
   appear without expanding.

3. **Exercise the core interactions:**

   - Expand a parent node and verify children load
   - Use the search bar to find a specific page by title; verify the tree auto-expands to reveal it
   - Right-click a node and verify the context menu appears with the correct insert options for
     that `contentType`
   - Drag a node to a new position and reload — verify the order persisted

4. **Verify draft state (if used)** — check that documents in `draft` status show the correct
   workflow gutter dot. Confirm that `lockedBy` is null for all nodes (stale locks block edits).

---

## Common gotchas

- **sortOrder collisions** — if multiple docs share the same `sortOrder` value after a backfill,
  the tree renders them in an undefined-but-stable order (DB row order). The `reorderNodes`
  helper re-numbers siblings with a `× 10` stride on the first drag operation, which de-duplicates
  collisions incrementally. The initial render is not wrong, just unordered. Run the backfill
  script again with a stricter partition if order matters before first use.

- **Schema migration before bulk insert** — if your DB does not yet have the `parent` or
  `sortOrder` column, run `pnpm payload migrate` (or boot Payload once) before the import script.
  Payload's drizzle-based adapters auto-migrate on boot but not during `payload.create` loops. A
  missing column during bulk insert fails silently or with a cryptic DB error.

- **contentType enum drift** — if your existing taxonomy values (`page`, `article`, `landing-page`,
  etc.) do not match the keys in `insertOptions`, the context menu will show "No children allowed
  here" for nodes with unrecognized types. Either expand `insertOptions` to cover all values, or
  normalize the `contentType` values during the backfill/import step before wiring the plugin.

- **Stale `lockedBy` after import** — if you imported documents with `lockedBy` set (e.g. from
  Sitecore workflow locks or a previous Payload session), those nodes will show as locked in the
  tree and block editing in the admin. Run a cleanup after import:

  ```sql
  UPDATE pages SET "lockedBy" = NULL;
  ```

- **Self-referencing relationship and Payload migrations (Postgres)** — adding a `parent`
  relationship that points to the same collection creates a self-referential foreign key. Payload
  generates this correctly, but if you hand-edit the migration SQL, ensure the FK is deferred or
  the insert order is parents-first (which the import script already enforces).

- **`maxDepth` and existing deep trees** — if your Sitecore site had content nested deeper than
  the plugin's default `maxDepth: 5`, either raise the limit or flatten the tree during import.
  Dragging a node beyond `maxDepth` will be rejected with a toast error.

---

## Cross-references

| Resource | Purpose |
|---|---|
| [./README.md](./README.md) | Top-level overview, install, quick-start |
| [./PRD.md §6](./PRD.md) | Locked API contract and required field spec |
| [./examples/basic](./examples/basic) | Starting fresh — minimal working collection |
| [./examples/sitecore-migration](./examples/sitecore-migration) | Runnable Sitecore seed script and full narrative |
| [./CONTRIBUTING.md](./CONTRIBUTING.md) | Bug reports, PRs, help |
| [`./packages/plugin/src/server/helpers/validateCollection.ts`](./packages/plugin/src/server/helpers/validateCollection.ts) | Validator source — read to understand exactly what is checked |
| [`./packages/plugin/src/server/helpers/reorderNodes.ts`](./packages/plugin/src/server/helpers/reorderNodes.ts) | Sort-order strategy — the `× 10` stride and cycle detection |
