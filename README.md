# @garsoncron/payload-plugin-content-tree

> Sitecore-style hierarchical content browser for Payload CMS 3.x admin.

> [!WARNING]
> **Status: `v0.1.0-alpha.0` — scaffold only.**
>
> The package builds, types export, the admin view mounts, and `GET /api/tree-{slug}` responds with `{ nodes: [], total: 0 }`. **No business logic is implemented yet.** Every feature listed below is on the roadmap, not in the box.
>
> The roadmap is tracked in [`PRD.md`](./PRD.md) §14 and broken into [GitHub issues](https://github.com/garsoncron/payload-plugin-content-tree/issues) grouped by [milestone](https://github.com/garsoncron/payload-plugin-content-tree/milestones). Watch the repo for progress.
>
> Don't install this for production work yet. If you're early-adopting and want to follow along, install the alpha tag and pin the exact version.

## Install

```bash
pnpm add @garsoncron/payload-plugin-content-tree@alpha
```

## Where this is going

The v1.0 plugin will provide:

- A drop-in admin view (`/admin/tree`) that browses a hierarchical Payload collection (one collection, self-referencing `parent`).
- Tree built on [`react-arborist`](https://github.com/brimdata/react-arborist) — virtualized, lazy-loaded, persisted expand state.
- Right-click context menu with config-driven insert options — Sitecore "insert options" parity. _(planned, see [#19](https://github.com/garsoncron/payload-plugin-content-tree/issues/19), [#20](https://github.com/garsoncron/payload-plugin-content-tree/issues/20))_
- Drag-and-drop reorder + reparent with atomic parent + sortOrder writes. _(planned, see [#21](https://github.com/garsoncron/payload-plugin-content-tree/issues/21), [#24](https://github.com/garsoncron/payload-plugin-content-tree/issues/24))_
- Deep search with auto-expand to ancestors. _(planned, see [#15](https://github.com/garsoncron/payload-plugin-content-tree/issues/15), [#16](https://github.com/garsoncron/payload-plugin-content-tree/issues/16))_
- Optional workflow + lock indicators in the gutter. _(planned, see [#27](https://github.com/garsoncron/payload-plugin-content-tree/issues/27))_
- `editUrlBuilder` config for right-rail iframe targets — Puck integration friendly. _(planned, see [#17](https://github.com/garsoncron/payload-plugin-content-tree/issues/17))_

See [`PRD.md`](./PRD.md) §5 for the complete v1.0 scope and §6 for the locked API contract.

## Use (target shape)

```ts
// payload.config.ts
import { contentTreePlugin } from '@garsoncron/payload-plugin-content-tree'

export default buildConfig({
  collections: [Pages /* must define parent, sortOrder, contentType, title */],
  plugins: [
    contentTreePlugin({
      collectionSlug: 'pages',
      insertOptions: {
        root: ['page', 'folder'],
        folder: ['page', 'folder'],
        page: ['page'],
      },
      contentTypeLabels: { page: 'Page', folder: 'Folder' },
    }),
  ],
})
```

Visit `/admin/tree`.

## Theming

All consumer-overridable values are exposed as `--ct-*` CSS custom properties. Override them in your own admin CSS:

```css
:root {
  --ct-row-bg-selected: #c7f0d4;
  --ct-row-height: 32px;
}
```

Or scope overrides to a custom admin wrapper class:

```css
.my-app-admin {
  --ct-text: #111827;
  --ct-border: #d1d5db;
}
```

Variables that fall back to Payload's `--theme-elevation-*` ramp pick up your Payload theme automatically — no extra configuration needed for dark-mode support.

**Variable groups** (source of truth: `packages/plugin/src/client/styles.css` `:root` block):

- **Layout** — `--ct-row-height`, `--ct-indent-step`
- **Color — text** — `--ct-text`, `--ct-text-muted`
- **Color — surface** — `--ct-surface`
- **Color — error** — `--ct-error`
- **Color — interactive states** — `--ct-bg-hover`, `--ct-bg-selected`, `--ct-row-bg-selected`, `--ct-row-bg-hover`, `--ct-row-bg-highlighted`
- **Borders & shadows** — `--ct-border`, `--ct-shadow-card`
- **Z-index stack** — `--ct-z-context-menu`, `--ct-z-modal`, `--ct-z-modal-backdrop`, `--ct-z-toast`
- **Animation** — `--ct-anim-fast`, `--ct-anim-base`
- **Toolbar** — `--ct-toolbar-height`, `--ct-toolbar-border`, `--ct-search-input-width`
- **DnD** — `--ct-drop-indicator`

## Required collection shape

The plugin **does not inject fields** — your collection must define them. The plugin validates at `buildConfig` time and throws with a copy-pasteable error if anything is missing. _(validation lands in [#7](https://github.com/garsoncron/payload-plugin-content-tree/issues/7).)_

| Field          | Type                    | Required | Default name    |
| -------------- | ----------------------- | -------- | --------------- |
| Parent         | `relationship` (self)   | yes      | `parent`        |
| Sort order     | `number`                | yes      | `sortOrder`     |
| Content type   | `select`                | yes      | `contentType`   |
| Title          | `text` (any text-ish)   | yes      | `title`         |
| Slug           | `text`                  | no       | `slug`          |
| Workflow state | `select`                | no       | `workflowState` |
| Locked by      | `relationship` to users | no       | `lockedBy`      |

Override field names via `fields: { parent: 'parentPage', ... }`.

## Roadmap

| Tag             | Scope                                                  | Issues                                                                            |
| --------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `0.1.0-alpha.0` | Publishable scaffold                                   | [Phase 0](https://github.com/garsoncron/payload-plugin-content-tree/milestone/1)  |
| `0.1.0-alpha.1` | `validateCollection` real, basic CI, Playwright smoke  | [Phase 1](https://github.com/garsoncron/payload-plugin-content-tree/milestone/2)  |
| `0.1.0-alpha.2` | `buildTreeNodes` + tree endpoint + arborist render     | [Phase 2](https://github.com/garsoncron/payload-plugin-content-tree/milestone/3)  |
| `0.1.0-alpha.3` | Search endpoint + auto-expand + EditIframePane         | [Phase 3](https://github.com/garsoncron/payload-plugin-content-tree/milestone/4)  |
| `0.1.0-beta.0`  | Context menu insert/duplicate/rename/delete + reorder  | [Phase 4](https://github.com/garsoncron/payload-plugin-content-tree/milestone/5)  |
| `0.1.0-beta.1`  | DnD wired to `reorderNodes`                            | [Phase 5](https://github.com/garsoncron/payload-plugin-content-tree/milestone/6)  |
| `0.1.0-beta.2`  | Gutter, lock, icons, modal, toasts                     | [Phase 6](https://github.com/garsoncron/payload-plugin-content-tree/milestone/7)  |
| `0.1.0-rc.0`    | Coverage, axe-core, perf budgets, full CI matrix       | [Phase 7](https://github.com/garsoncron/payload-plugin-content-tree/milestone/8)  |
| `0.1.0-rc.1`    | Examples (basic + with-puck + sitecore-migration), GIF | [Phase 8](https://github.com/garsoncron/payload-plugin-content-tree/milestone/9)  |
| `1.0.0`         | Storybook deploy, payloadcms.com PR, launch            | [Phase 9](https://github.com/garsoncron/payload-plugin-content-tree/milestone/10) |

See [`PRD.md`](./PRD.md) §14 for full phase descriptions.

## Local dev

```bash
pnpm install
pnpm dev   # boots examples/basic with SQLite at http://localhost:3000/admin
```

## Differentiation vs Payload's native tree

Payload's official Tree View RFC ([#13982](https://github.com/payloadcms/payload/discussions/13982)) targets late 2026. This plugin's continued reason to exist is documented in [`PRD.md`](./PRD.md) §7 — primarily Sitecore-flavored UX (insert options, workflow gutter, lock indicators) and a migration narrative for teams leaving Sitecore.

## License

MIT — see [`LICENSE`](./LICENSE).
