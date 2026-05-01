# Sitecore Migration Example

This workspace demonstrates migrating a **Sitecore content tree** to a
**Payload CMS self-referencing collection** powered by
`@garsoncron/payload-plugin-content-tree`.

The structural model maps cleanly: Sitecore organises content as a tree of
items with parent/child relationships, template IDs, and sort orders.
Payload expresses the same structure through a `parent` relationship field on
a single collection. The plugin then renders that collection as an interactive
tree in the Payload admin.

For the broader migration narrative and multi-phase plan, see
[../../MIGRATING.md](../../MIGRATING.md).

---

## Why migrate from Sitecore?

Sitecore's content tree is a first-class concept — every item has a path, a
parent, a template, and a sort order. That mental model transfers directly to
Payload without loss of structural fidelity. The differences are in the
delivery layer (Sitecore's rendering engine vs. your own Next.js front-end)
and in operational overhead.

This example is not a critique of Sitecore. It is a demonstration that the
**information architecture** you built in Sitecore — the tree, the hierarchy,
the content types — can be preserved verbatim in Payload while you modernise
the stack underneath it.

---

## Field mapping

| Sitecore concept | Sitecore field / property     | Payload field                  | Notes                                                                                          |
| ---------------- | ----------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------- |
| Item             | —                             | Document in `pages` collection | 1:1                                                                                            |
| Item Name        | `Item.Name`                   | `slug`                         | Kebab-cased for URL safety                                                                     |
| Display Name     | `Item.DisplayName`            | `title` + `displayName`        | `title` drives admin UI labels; `displayName` stores the original verbatim                     |
| Template GUID    | `Item.TemplateID`             | `templateId`                   | Preserved verbatim; useful for re-imports and cross-referencing the Sitecore template registry |
| Template Name    | `Item.TemplateName`           | `contentType`                  | Mapped via the `TEMPLATE_TO_CONTENT_TYPE` table in the import script                           |
| Parent Item      | `Item.ParentID`               | `parent` (self-relationship)   | Core of the tree structure                                                                     |
| Sort Order       | `Item.__sortorder`            | `sortOrder`                    | Number field; Sitecore uses multiples of 100                                                   |
| Item Path        | `Item.Paths.FullPath`         | `legacyPath`                   | Indexed; used for redirect resolution (see below)                                              |
| Datasource item  | Local datasource under a page | `contentType: 'datasource'`    | In real migrations, large datasource libraries often move to a dedicated Payload collection    |
| Media item       | `/sitecore/media library/...` | Payload Media collection       | Not implemented here — see the TODO comments in the import script                              |

### contentType mapping

The `contentType` select field in this example maps Sitecore template names
to four values:

| Payload `contentType` | Sitecore template names                                  |
| --------------------- | -------------------------------------------------------- |
| `page`                | Page, Sample Item, Standard Template                     |
| `folder`              | Folder, Common Folder                                    |
| `datasource`          | Hero, Promo, Text Block, and any SXA datasource template |
| `mediaFolder`         | Media folder, Unversioned folder, Versioned folder       |

You will need to extend the `TEMPLATE_TO_CONTENT_TYPE` map in
`src/scripts/import-from-sitecore.ts` to cover every template your project
uses.

---

## Run instructions

### Prerequisites

- Node >= 20.9, pnpm >= 9
- Run `pnpm install` from the repo root (the workspace is automatically
  included via `pnpm-workspace.yaml`)

### Start the admin

```bash
pnpm --filter examples-sitecore-migration dev
```

Open `http://localhost:3001/admin` (or the next available port), create your
first admin user, then navigate to `/admin/tree` to see the plugin view.

The database starts empty. Run the seed script (below) to populate it with
the fixture tree.

### Run the import

```bash
pnpm --filter examples-sitecore-migration seed
```

This executes `src/scripts/import-from-sitecore.ts` against
`fixtures/sitecore-export.json` — a hand-crafted 10-node, 3-level tree that
represents a typical Sitecore site structure:

```
Home (page)
├── About Us (page)
│   └── Our Team (page)
├── Products (folder)
│   ├── Widget A (page)
│   └── Widget B (page)
├── Blog (folder)
│   └── Getting Started (page)
├── Hero Datasource (datasource)
└── Site Media (mediaFolder)
```

After the seed completes, refresh `/admin/tree` to see the tree populated.

### Re-seeding

The script is not idempotent by default — running it twice will attempt to
create duplicate slugs and fail on the `unique` constraint. To re-seed:

1. Delete `dev.db` from the workspace root.
2. Restart the dev server (it recreates the schema on boot).
3. Run `pnpm --filter examples-sitecore-migration seed` again.

For production migrations, see the **Production tips** section below.

---

## What's covered

- Tree hierarchy: parent/child relationships via Payload's self-referencing
  `relationship` field.
- Template → contentType mapping with a configurable lookup table.
- Sort order preservation from Sitecore's `__sortorder` field.
- Legacy path indexing (`legacyPath`) for redirect resolution.
- BFS traversal so parents are always created before children regardless of
  the export order.
- Per-archetype counters in the final import report.

## What's out of scope

| Area                                   | Reason                                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Media binary transfer**              | Requires streaming assets from the Sitecore Media Service API; highly environment-specific. See `TODO(real-world)` in the import script.                                 |
| **Rich-text link rewriting**           | Sitecore encodes internal links as GUIDs in HTML blobs. Rewriting them requires a second pass after all items are imported. See `TODO(real-world)` in the import script. |
| **Multilingual / language versions**   | Payload's locale model differs from Sitecore's. See `TODO(real-world)` in the import script and PRD §5.                                                                  |
| **Workflow state**                     | No direct Payload equivalent. Options: store verbatim in a select field, or map Published → `_status: published`.                                                        |
| **Presentation details**               | Rendering definitions, layout service responses, datasource bindings — out of scope for v1.0 per PRD §5.                                                                 |
| **SXA page designs / partial designs** | Presentation-layer concern; not part of the content tree model.                                                                                                          |
| **Sitecore Forms**                     | Complex structure; migrate to a Payload-native form builder separately.                                                                                                  |

---

## Production migration tips

### 1. Use a Payload transaction

The import script processes items one at a time. Wrap the loop in a
transaction so a partial failure does not leave the database in an
inconsistent state:

```ts
const trxId = await payload.db.beginTransaction()
try {
  // ... import loop ...
  await payload.db.commitTransaction(trxId)
} catch (err) {
  await payload.db.rollbackTransaction(trxId)
  throw err
}
```

### 2. Persist the GUID → ID mapping table

The in-memory `sitecoreIdToPayloadId` Map is discarded after the script exits.
For large sites you will run the import in batches or need to re-run it after
fixing errors. Persist the map to a JSON file (or a dedicated Payload
collection) before exiting:

```ts
import { writeFileSync } from 'fs'
writeFileSync(
  'sitecore-id-mapping.json',
  JSON.stringify(Object.fromEntries(sitecoreIdToPayloadId), null, 2),
)
```

Re-read it at the start of subsequent runs so you don't recreate docs that
already exist.

### 3. Resolve legacy redirects via `legacyPath`

Every imported doc stores its original Sitecore path in the indexed
`legacyPath` field. In your Next.js middleware (or a `redirects` function),
look up the incoming path:

```ts
// Example Next.js middleware
const doc = await payload.find({
  collection: 'pages',
  where: { legacyPath: { equals: req.nextUrl.pathname } },
  limit: 1,
})
if (doc.docs.length > 0) {
  return NextResponse.redirect(new URL(`/pages/${doc.docs[0].slug}`, req.url), 301)
}
```

This gives you O(1) redirect resolution without a static redirect table.

### 4. Handle datasource items

In a large SXA site, datasource items outnumber pages. Options:

- **Keep in `pages`** (as this example does): simple, but the tree gets noisy.
- **Move to a dedicated collection**: create a `datasources` collection,
  import datasource items there, and store a `relationship` field on the
  parent page pointing to its local datasources. This is the recommended
  approach for production sites.

### 5. Extend the template map before you run

Enumerate all templates in your Sitecore instance:

```powershell
# Sitecore PowerShell Extensions
Get-ChildItem -Path "master:\templates\User Defined" -Recurse |
  Select-Object Name, ID | ConvertTo-Json
```

Add each template to `TEMPLATE_TO_CONTENT_TYPE` in the import script before
running against production data. Unknown templates fall back to `'page'`,
which is safe but may not be semantically correct.

### 6. Run in a staging environment first

Always validate the import against a staging Payload instance backed by a
copy of the Sitecore export. Check:

- Node counts match between Sitecore and Payload.
- No orphaned nodes (children whose parent failed to import).
- `legacyPath` values are unique (duplicates indicate data quality issues in
  the source).
- Slug uniqueness constraints are satisfied.

---

## Cross-reference

- [../../MIGRATING.md](../../MIGRATING.md) — top-level migration guide with
  multi-phase plan and broader context.
- [../basic/README.md](../basic/README.md) — the minimal example showing the
  plugin's required field contract.
- [../../PRD.md](../../PRD.md) — product requirements, §5 scope, §6 API
  contract.
