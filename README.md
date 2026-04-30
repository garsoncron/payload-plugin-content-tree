# @fishtank/payload-plugin-content-tree

> Sitecore-style hierarchical content browser for Payload CMS 3.x admin.

**Status:** v0.1 — pre-release. Built for the RAS Canada hack-a-thon. API may shift before v1.0.

## Install

```bash
pnpm add github:getfishtank/payload-plugin-content-tree#v0.1.0
# (npm publish coming in v0.2)
```

## Use

```ts
// payload.config.ts
import { contentTreePlugin } from '@fishtank/payload-plugin-content-tree'

export default buildConfig({
  collections: [Pages /* must define parent, sortOrder, contentType, title */],
  plugins: [
    contentTreePlugin({
      collectionSlug: 'pages',
      insertOptions: {
        root:   ['page', 'folder'],
        folder: ['page', 'folder'],
        page:   ['page'],
      },
      contentTypeLabels: { page: 'Page', folder: 'Folder' },
    }),
  ],
})
```

Visit `/admin/tree`.

## What this is

- A drop-in admin view that browses a hierarchical Payload collection (one collection, self-referencing `parent`).
- Built on [`react-arborist`](https://github.com/brimdata/react-arborist) — virtualized tree, drag-and-drop, search, keyboard nav.
- Right-click context menu with config-driven insert options (Sitecore "insert options" parity).
- Optional gutter indicators for workflow state and edit-locks.

## What this isn't (yet)

- A multi-collection tree (one plugin instance = one collection in v0.1).
- A page builder. The right rail iframes Payload's edit view by default; pass `editUrlBuilder` to point at any other URL (e.g. a Puck-powered builder).
- Storybook'd, themable, internationalized, or a11y-certified — those land in v0.2.

## Required collection shape

The plugin **does not inject fields** — your collection must define them. v0.1 validates at `buildConfig` time and throws with a copy-pasteable error if anything is missing.

| Field | Type | Required | Default name |
|---|---|---|---|
| Parent | `relationship` (self) | yes | `parent` |
| Sort order | `number` | yes | `sortOrder` |
| Content type | `select` | yes | `contentType` |
| Title | `text` (any text-ish) | yes | `title` |
| Slug | `text` | no | `slug` |
| Workflow state | `select` | no | `workflowState` |
| Locked by | `relationship` to users | no | `lockedBy` |

Override field names via `fields: { parent: 'parentPage', ... }`.

## Local dev

```bash
pnpm install
pnpm dev   # boots examples/basic with SQLite at http://localhost:3000/admin
```

## License

MIT — see `LICENSE`.
