# @garsoncron/payload-plugin-content-tree

> Sitecore-style hierarchical content browser for Payload CMS 3.x admin.

[![npm version](https://img.shields.io/npm/v/@garsoncron/payload-plugin-content-tree.svg)](https://www.npmjs.com/package/@garsoncron/payload-plugin-content-tree)
[![npm downloads](https://img.shields.io/npm/dm/@garsoncron/payload-plugin-content-tree.svg)](https://www.npmjs.com/package/@garsoncron/payload-plugin-content-tree)
[![CI](https://github.com/garsoncron/payload-plugin-content-tree/actions/workflows/ci.yml/badge.svg)](https://github.com/garsoncron/payload-plugin-content-tree/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@garsoncron/payload-plugin-content-tree)](https://bundlephobia.com/package/@garsoncron/payload-plugin-content-tree)

<!-- Hero GIF to be recorded — see issue #38. Asset will be committed at ./github/assets/hero.gif once recorded. -->

![Content tree showing expand, drag-and-drop reorder, and right-click context menu](./.github/assets/hero.gif)

## Why this exists

Payload CMS 3.x browses every collection as a flat list. That works fine for posts and products. It breaks down the moment you have a page tree — folder hierarchies that nest three or four levels deep, parent/child relationships editors need to see at a glance, and insert options that determine what content types can live under what parents.

Teams migrating from Sitecore feel this immediately. The Sitecore content editor treats the tree as the primary navigation surface. Editors scan it to orient, right-click to insert, and drag to restructure — all without leaving the tree. Payload ships none of that out of the box.

This plugin adds a drop-in `/admin/tree` view built on [react-arborist](https://github.com/brimdata/react-arborist) with the Sitecore-flavored UX your editors already know: insert options, workflow gutter, lock indicators, and an iframe rail for editing without losing tree context. It works today, while Payload's official Tree View RFC (#13982) is still in development, and it deliberately targets the Sitecore migration use case that Payload's native tree is unlikely to cover even when shipped. See [`PRD.md §5`](./PRD.md) for the complete v1.0 scope.

## Install

```bash
pnpm add @garsoncron/payload-plugin-content-tree
```

## Usage

Register the plugin in `payload.config.ts` and point it at a collection that defines the required fields:

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { contentTreePlugin } from '@garsoncron/payload-plugin-content-tree'

export default buildConfig({
  collections: [Pages],
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

Then visit `/admin/tree`.

The plugin validates your collection at `buildConfig` time and throws with a copy-pasteable error if any required field is missing. See [`PRD.md §6`](./PRD.md) for the full API contract including all config options (`editUrlBuilder`, `canPerformAction`, `features`, `maxDepth`, etc.).

### Required collection shape

The plugin does not inject fields — your collection must define them:

| Field           | Type                    | Required |
| --------------- | ----------------------- | -------- |
| `parent`        | `relationship` (self)   | yes      |
| `sortOrder`     | `number`                | yes      |
| `contentType`   | `select`                | yes      |
| `title`         | `text` (any text-ish)   | yes      |
| `slug`          | `text`                  | no       |
| `workflowState` | `select`                | no       |
| `lockedBy`      | `relationship` to users | no       |

Override any field name via `fields: { parent: 'parentPage', sortOrder: 'order', ... }`.

## Features

- react-arborist tree view — virtualized, lazy-load expand state, localStorage-persisted per collection
- Right-click context menu with config-driven Insert options (Sitecore insert-options parity)
- Drag-and-drop reorder and reparent with atomic parent + sortOrder writes
- Deep search with auto-expand to ancestors
- Optional workflow + lock indicators in the gutter (opt-in via `fields.workflowState` and `fields.lockedBy`)
- `editUrlBuilder` for right-rail iframe targets — Puck integration ready
- `canPerformAction` callback for role-based action gating
- Toast notifications on errors

## Examples

- [`./examples/basic`](./examples/basic) — working sandbox: Next 15 + SQLite, zero extra dependencies
- [`./examples/with-puck`](./examples/with-puck) — Puck page-builder integration via `editUrlBuilder`
- [`./examples/sitecore-migration`](./examples/sitecore-migration) — migration narrative from Sitecore XM to Payload

See also [`MIGRATING.md`](./MIGRATING.md) for the step-by-step migration guide.

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

## Quality

- 0 axe-core violations on default render
- Coverage gates: ≥80% server helpers, ≥60% client
- Bundle: admin chunk ≤ 80 KB gzip (hard CI fail above this threshold)
- CI matrix: Node 20 + 22 × SQLite (Postgres + React 18 / Payload 3.0 combinations included)
- Strict TypeScript with `noUncheckedIndexedAccess`, no `any` outside disable-islands with documented reasons

## Status

> **Status: Active, maintained.** v1.x line is stable; SemVer-strict. Solo-maintained by [Carson Gron](https://github.com/garsoncron) at [Fishtank Consulting](https://getfishtank.ca). Issue triage within 7 business days; security issues within 48 hours via SECURITY.md. Major-version compatibility maintained for the latest Payload 3.x; older Payload versions supported on a best-effort basis.
>
> **Commercial support:** for SLAs, custom features, or migration assistance, contact carson@getfishtank.ca.

## Roadmap

v1.0 ships the locked scope in [PRD §5](./PRD.md). Track ongoing work via [GitHub issues](https://github.com/garsoncron/payload-plugin-content-tree/issues) and [milestones](https://github.com/garsoncron/payload-plugin-content-tree/milestones).

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the dev loop, code style, and release process. Please read [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) before opening an issue or PR. Security vulnerabilities go to [`SECURITY.md`](./SECURITY.md) — do not file public issues for them.

## License

MIT — see [`LICENSE`](./LICENSE).
