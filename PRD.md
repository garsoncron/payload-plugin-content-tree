# Product Requirements Document — `@garsoncron/payload-plugin-content-tree`

> **Version:** 1.0 PRD draft
> **Status:** Approved — implementation can begin
> **Author:** Carson Gron (Fishtank Consulting)
> **Date:** 2026-05-01
> **Companion docs:**
>
> - `AUDIT.md` — current-state assessment + gap analysis
> - `merry-scribbling-hejlsberg/.ai-reports/spike-content-tree-plugin.md` — original spike (what & why)
> - `merry-scribbling-hejlsberg/.ai-reports/spike-content-tree-plugin-sketch.md` — code skeleton

---

## 1. One-line positioning

**Sitecore-style content tree for Payload CMS — the admin UX your editors expected, with a migration path from Sitecore.**

## 2. Why this exists

### The problem

Payload CMS 3.x's default admin browses each collection as a flat list. Teams migrating from Sitecore (or building Sitecore-shaped editorial workflows in Payload) need:

- A unified hierarchical tree of pages with parent/child relationships
- Right-click "insert" / "duplicate" / "delete" parity with Sitecore's content editor
- Drag-and-drop to reorder/reparent
- Visual workflow + lock state in the tree itself
- An iframe-style edit experience (tree on the left, page editor on the right)

The Payload ecosystem currently has no such plugin. Payload's official Tree View RFC (#13982) is in development but won't ship Sitecore-flavored UX even when released.

### The audience

Three concentric circles, in priority order:

1. **Sitecore-migrating teams** (primary) — agencies, consultancies, and in-house teams porting Sitecore (XM/SXA, 9.x, 10.x) sites to modern stacks. Painful licensing renewals are accelerating Sitecore exits in 2025–2026.
2. **Payload teams with hierarchical content needs** (secondary) — anyone with a `pages` tree deeper than 2 levels who finds the default flat list painful.
3. **Fishtank Consulting** (substrate) — internal use across multiple client engagements (FRAS Canada is the launch reference).

### Why a plugin (vs in-tree code)

- One canonical implementation across multiple Fishtank engagements
- Lead-generation surface for inbound consulting work
- Genuine ecosystem contribution while Payload's native tree is years from full Sitecore parity
- Forcing function for clean APIs — extracting to a plugin reveals the FRAS-specific assumptions worth removing

## 3. Author intent

This plugin is published with three motives, in order:

1. **(B) Lead magnet** for Fishtank consulting work — Sitecore migrants discover the plugin, contact Fishtank for migration help.
2. **(C) Genuine ecosystem contribution** — Fills a gap Payload's roadmap won't reach for years. Solo-maintained, semver-strict.
3. **(D) Strategic Fishtank asset** — Production-grade infrastructure used across Fishtank's client portfolio.

Not sold (T1/T2) on this is not the answer. T3 (full polish, real maintenance) is the bar. See `AUDIT.md` for tier definitions and gap analysis.

## 4. Target users (personas)

### Persona 1 — Maya, Sitecore Migration Lead at a 50-person agency

- Inherited a 200-page Sitecore site that needs to leave Sitecore in Q3
- Looked at Payload, loved the developer experience, hated that the admin doesn't look like Sitecore
- Found this plugin via Google ("payload sitecore alternative tree view")
- Installs it, demos to client, client signs the migration SOW
- **Implication:** README and search-engine presence must answer "Sitecore alternative" queries

### Persona 2 — Devon, Tech Lead on a hierarchical-content Payload build

- Building a multi-level docs site or product hierarchy
- Wants a tree, hates wiring `nested-docs` plugin + a custom view from scratch
- Discovers via Payload Discord
- **Implication:** plugin must work with `@payloadcms/plugin-nested-docs` cleanly

### Persona 3 — Ana, Fishtank developer

- Spinning up the Nth client project that needs the same admin UX
- Just wants to `pnpm add` and configure
- **Implication:** sane defaults, minimal-config path, escape hatches for FRAS-style customization

## 5. Scope — v1.0

### IN scope

| Feature                                                   | Notes                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| Single-collection tree on self-referencing `parent` field | Required field shape: `parent`, `sortOrder`, `contentType`, `title` |
| Lazy-load children on expand                              | Single bulk fetch + in-memory map; no N+1                           |
| Persisted expand state                                    | localStorage                                                        |
| Right-click context menu                                  | Insert (config-driven), Duplicate, Rename, Delete, Open in new tab  |
| DnD reorder + reparent                                    | atomic parent + sortOrder update                                    |
| Deep search with auto-expand                              | server-side title + slug search; returns ancestor IDs               |
| Workflow gutter                                           | optional, opt-in via `fields.workflowState` mapping                 |
| Lock indicator                                            | optional, opt-in via `fields.lockedBy` mapping                      |
| `editUrlBuilder` config                                   | for Puck-style integrations                                         |
| `canPerformAction` callback                               | role-based action gating                                            |
| React 18 + 19                                             | both verified in CI matrix                                          |
| Payload 3.0+                                              | minimum + latest 3.x in CI                                          |
| Postgres + SQLite verified                                | MongoDB best-effort, not in CI                                      |

### OUT of scope (explicit non-goals)

| Feature                         | Why out                                              |
| ------------------------------- | ---------------------------------------------------- |
| Multi-collection trees          | Defer to v2.0; expensive scope                       |
| Custom node renderers as config | Advanced consumers wrap `<ContentTreeView>` directly |
| Built-in workflow engine        | We visualize, we don't manage                        |
| Permissions system              | Delegated to `canPerformAction` callback             |
| Search backend integration      | Title/slug only; Meilisearch is out of scope         |
| Built-in i18n of menu labels    | Consumers pass `labels` config                       |
| Theme system                    | Use CSS vars (`--ct-*`); restyle via consumer CSS    |

### DEFERRED to v1.1+

- `move-to` action with tree-picker modal
- Bulk multi-select + apply
- Keyboard nav polish (arrows, type-ahead, F2 rename, Delete)
- Storybook stories per component
- MongoDB adapter in CI matrix
- WCAG 2.1 AA certification

## 6. Public API contract

```ts
contentTreePlugin({
  collectionSlug: 'pages',                     // required
  fields?: {                                    // all optional with defaults
    parent?: string,                            // default 'parent'
    sortOrder?: string,                         // default 'sortOrder'
    contentType?: string,                       // default 'contentType'
    title?: string,                             // default 'title'
    slug?: string,                              // default 'slug'
    workflowState?: string | false,             // default 'workflowState'; false disables gutter dot
    lockedBy?: string | false,                  // default 'lockedBy'; false disables lock icon
  },
  adminPath?: string,                           // default '/tree'
  insertOptions?: Record<string, string[]>,     // default {}; pass {root: ['page']} to enable
  contentTypeLabels?: Record<string, string>,   // human labels for menu
  maxDepth?: number,                            // default 5
  editUrlBuilder?: (node) => string,            // default '/admin/collections/{slug}/{id}'
  canPerformAction?: (action, user, node) => boolean,  // default always-true
  features?: {
    dragAndDrop?: boolean,                      // default true
    contextMenu?: boolean,                      // default true
    deepSearch?: boolean,                       // default true
  }
})
```

**Stability commitment:** the option keys above are stable in 1.x. Adding new optional keys is non-breaking; removing or renaming keys is a major version bump.

### Required collection shape

The plugin **does not inject fields** — consumer defines them. Plugin validates at `buildConfig` time and throws with a copy-pasteable error if missing.

| Field          | Type                    | Required                         |
| -------------- | ----------------------- | -------------------------------- |
| Parent         | `relationship` (self)   | yes                              |
| Sort order     | `number`                | yes                              |
| Content type   | `select`                | yes                              |
| Title          | text-ish                | yes                              |
| Slug           | `text`                  | no                               |
| Workflow state | `select`                | no — required only if you map it |
| Locked by      | `relationship` to users | no — required only if you map it |

## 7. Differentiation vs Payload's native tree (RFC #13982)

When Payload ships native tree (target: late 2026), this plugin's continued reason to exist:

| Capability                                 | Payload native (RFC #13982) | This plugin             |
| ------------------------------------------ | --------------------------- | ----------------------- |
| Per-collection tree                        | yes                         | yes                     |
| Multi-collection unified tree              | unclear                     | v2.0                    |
| Right-click insert/duplicate/rename/delete | unlikely                    | yes                     |
| Insert-options table (Sitecore parity)     | no                          | yes                     |
| Workflow state in gutter                   | no                          | yes                     |
| Lock state in gutter                       | no                          | yes                     |
| Drag-and-drop reorder                      | likely yes                  | yes                     |
| Deep search w/ ancestor expand             | unclear                     | yes                     |
| Sitecore migration narrative               | no                          | **primary positioning** |
| `editUrlBuilder` for Puck integration      | unlikely                    | yes                     |
| `canPerformAction` for role gating         | unlikely                    | yes                     |

**Co-existence story** (in README):

> Use both — Payload's native tree for most cases, this plugin for the page tree where Sitecore-flavored UX matters or where insert options + workflow gutter add value.

## 8. Quality bar

### Tests

- ≥80% coverage on `src/server/helpers/**` and `src/shared/**`
- ≥60% on `src/client/**`
- ≥30 unit tests covering validateCollection, buildTreeNodes, resolveAncestors, insertOptions, reorderNodes
- ≥3 Playwright e2e: tree-loads, drag-persists, search-finds-and-expands

### CI matrix (8 combos, all required to merge)

- Node 20 LTS, 22 LTS
- React 18.3, 19.0
- Payload 3.0.0, latest 3.x
- DB: SQLite, Postgres
- OS: Ubuntu only

### Performance budgets (CI hard fails)

- Admin chunk ≤ 80 KB gzip
- Tree of 1,000 nodes: server response < 500ms, client render < 100ms
- Drag round-trip < 300ms

### Accessibility

- Correct ARIA roles (`tree`, `treeitem`, `group`)
- Keyboard nav: Tab in, arrows navigate, Enter selects, F2 rename, Delete delete
- axe-core: 0 violations on rendered view
- WCAG 2.1 AA: aspirational v1.0, certified v1.3

### Browser support

- Chrome/Edge latest 2, Firefox latest 2, Safari 16+

### Code quality

- ESLint v9 flat config, max-warnings 0
- Prettier on commit (lint-staged + husky)
- TypeScript strict + `noUncheckedIndexedAccess`
- No `any` outside disable-islands with documented reasons
- Conventional Commits enforced via commitlint

## 9. Maintenance commitment

The literal README "Status" section:

> **Status: Active, maintained.** v1.x line is stable; SemVer-strict. Solo-maintained by [Carson Gron](https://github.com/garsoncron) at [Fishtank Consulting](https://getfishtank.ca). Issue triage within 7 business days; security issues within 48 hours via SECURITY.md. Major-version compatibility maintained for the latest Payload 3.x; older Payload versions supported on a best-effort basis.
>
> **Commercial support:** for SLAs, custom features, or migration assistance, contact carson@getfishtank.ca.

What this commits us to:

- Weekly issue triage
- 48-hour security response
- SemVer (consumers can pin safely)
- `SECURITY.md` with disclosure flow

What this does NOT commit us to:

- Implementing every feature request
- Backporting fixes to old majors
- Specific release cadence promises

## 10. Distribution + go-to-market

### Distribution channels

- npm: `@garsoncron/payload-plugin-content-tree` (scope claimed at first publish)
- GitHub: `getfishtank/payload-plugin-content-tree`, public, MIT
- Storybook: hosted on Vercel free tier
- Docs: README + `/docs` markdown in repo (no separate docs site for v1.0)
- Examples: `examples/basic`, `examples/with-puck`, `examples/sitecore-migration`

### Launch sequence (v1.0.0 day)

1. Tag + `npm publish --provenance`
2. GitHub release with auto-generated notes
3. PR to payloadcms.com community plugins directory
4. Payload Discord `#showcase` post
5. Tweet/LinkedIn from personal + Fishtank handles
6. Show HN (Tuesday)
7. Fishtank blog post: "We built a Sitecore-style tree for Payload — here's why"
8. Submit to npm trends, awesome-payload

### Discovery investments

- GitHub topics: `payload`, `payload-plugin`, `payloadcms`, `cms`, `tree-view`, `sitecore`
- npm keywords: same + `nested-docs`, `hierarchical-content`, `admin-ui`, `react-arborist`
- README hero GIF: ≤ 5 MB, ~10s loop showing expand → DnD → context menu
- README badges: npm version, downloads/month, GitHub stars, license, build status, codecov

## 11. Success metrics — 6-month checkpoints

| Metric                                    | Floor   | Target | Stretch |
| ----------------------------------------- | ------- | ------ | ------- |
| npm weekly downloads                      | 50      | 200    | 1,000   |
| GitHub stars                              | 25      | 100    | 500     |
| Inbound consulting leads via plugin       | 1       | 3      | 10      |
| Production projects using it (incl. FRAS) | 1       | 3      | 10      |
| Open / closed issue ratio                 | < 0.5   | < 0.3  | < 0.2   |
| Time to first issue response (p50)        | 14 days | 3 days | 24 hrs  |
| External contributors                     | 0       | 2      | 10      |
| Listed in payloadcms.com directory        | yes     | yes    | yes     |

**Sunset trigger:** if at 12 months metrics are below floor across the board AND no consulting leads, archive repo, mark npm package deprecated.

## 12. Roadmap

| Version | Target              | Headline scope                                                                     |
| ------- | ------------------- | ---------------------------------------------------------------------------------- |
| v1.0.0  | spec lock + 8 weeks | scope per §5                                                                       |
| v1.1.0  | v1.0 + 6 weeks      | move-to with tree picker, bulk multi-select, keyboard nav polish                   |
| v1.2.0  | v1.0 + 12 weeks     | Storybook stories per component, MongoDB CI matrix, react-arborist 4.x if released |
| v1.3.0  | v1.0 + 20 weeks     | WCAG 2.1 AA cert, full a11y audit, axe-core gate                                   |
| v2.0.0  | v1.0 + ~6 months    | multi-collection trees, breaking config change                                     |

**Versioning posture:** 0.x = pre-release, breaking changes allowed. 1.0+ = SemVer-strict.

**Forever-deferred:** built-in workflow engine, permissions system, custom backend search adapters.

## 13. Open questions (need answers before implementation starts)

| #   | Question                                                                  | Default if not answered                                                |
| --- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| OQ1 | Storybook hosted on Vercel — Vercel account is yours/Fishtank's?          | yours; switch to Fishtank when Vercel team account exists              |
| OQ2 | Commercial-support email — `carson@getfishtank.ca` or a `support@` alias? | `carson@` — direct to you                                              |
| OQ3 | Co-maintainer ever? Or solo-maintained explicitly forever?                | solo for v1.x; reconsider at v2.0                                      |
| OQ4 | Trademark/IP review at Fishtank before public release?                    | no — MIT license + standard OSS posture, no Fishtank-confidential code |
| OQ5 | Submit to Payload directory PRE or POST v1.0.0?                           | post — needs to be production-grade before listing                     |

## 14. Implementation plan

To be derived from this PRD by the `prd-to-plan` skill (vertical-slice tracer-bullet phases) and broken into GitHub issues by `prd-to-issues`. Total estimated work: 40-60 hours over 8 weeks at part-time pace, including launch.

### Tracer-bullet phase shape (preliminary)

1. **Phase 0 — publishable scaffold (T1)** — npm published as `0.1.0-alpha.0`, scope claimed, README marked alpha. ~2 hrs.
2. **Phase 1 — validate-and-mount** — validateCollection real, build/test/CI flat config, basic Playwright. ~4 hrs.
3. **Phase 2 — read tree** — buildTreeNodes + tree endpoint + basic arborist render. Tree visible. ~6 hrs.
4. **Phase 3 — search + iframe** — search endpoint + auto-expand + EditIframePane. Tree usable as a navigator. ~4 hrs.
5. **Phase 4 — write actions** — context menu insert/duplicate/rename/delete + reorder. Tree editable. ~6 hrs.
6. **Phase 5 — DnD** — arborist DnD wired to reorderNodes. Drag persists. ~4 hrs.
7. **Phase 6 — polish** — gutter, lock, icons, modal, error toasts. Looks finished. ~4 hrs.
8. **Phase 7 — quality** — full test coverage, axe-core, performance budgets, CI matrix. ~6 hrs.
9. **Phase 8 — examples + docs** — basic + with-puck + sitecore-migration. README rewrite. GIF. ~6 hrs.
10. **Phase 9 — launch** — Storybook deploy, payloadcms.com PR, Discord/HN/blog. ~4 hrs.

Each phase produces a tagged release. Phase 0 = `0.1.0-alpha.0`. Phases 1-7 progress through `0.1.0-alpha.N` and `0.1.0-beta.N`. Phase 8 = `0.1.0-rc.0`. Phase 9 = `1.0.0`.

## 15. Appendix — derived contracts

### CSS variable surface (consumer-overridable)

```css
:root {
  --ct-row-height: 28px;
  --ct-indent-step: 20px;
  --ct-bg-hover: rgba(59, 130, 246, 0.1);
  --ct-bg-selected: var(--theme-elevation-150);
  --ct-text: var(--theme-elevation-800);
  --ct-text-muted: var(--theme-elevation-500);
  --ct-border: var(--theme-elevation-150);
}
```

### Error-message contract (validateCollection)

```
[content-tree-plugin] Collection "<slug>" is missing required field "<name>".
Add it (type: "<type>") or pass fields.<key> to point at an existing field.
```

### Endpoint contract

- `GET /api/tree-{slug}` → `{ nodes: TreeNode[], total: number }`
- `GET /api/tree-{slug}?parentId=X` → `{ nodes: TreeNode[], total: number }` (children of X only)
- `GET /api/tree-{slug}/search?q=Q` → `{ results: TreeNode[], expandIds: (string|number)[], total: number }`

### Co-existence with `@payloadcms/plugin-nested-docs`

Documented compatible. Plugin reads from the same `parent` field nested-docs writes; no conflict. README includes a "Used with nested-docs" subsection.
