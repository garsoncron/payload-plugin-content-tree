# Project context — `@fishtank/payload-plugin-content-tree`

> Open this repo as a fresh Claude Code session and read this file first.

## Where this came from

This plugin was extracted in spec form from the FRAS Canada project (`~/03--fishtank/fras/`). The originating spike docs and grilling sessions live in the FRAS worktrees:

- `~/03--fishtank/fras/.claude/worktrees/merry-scribbling-hejlsberg/.ai-reports/spike-content-tree-plugin.md` — what & why
- `~/03--fishtank/fras/.claude/worktrees/merry-scribbling-hejlsberg/.ai-reports/spike-content-tree-plugin-sketch.md` — file-by-file code skeleton

Inside this repo:

- **`PRD.md`** — locked v1.0 product spec. **Read this first.** Sections §5 (scope), §6 (API contract), §8 (quality bar), §14 (10-phase implementation plan).
- **`AUDIT.md`** — honest current-state assessment. Tier-T3 gap analysis. Read this second.
- `README.md`, `MIGRATING.md`, `CONTRIBUTING.md`, `CHANGELOG.md` — public-facing.

## Current state (as of 2026-05-01)

- Local + remote: `https://github.com/garsoncron/payload-plugin-content-tree` (public, MIT)
- 6 commits on `main`, all pushed
- pnpm workspace with `packages/plugin` + `examples/basic`
- Plugin builds clean (ESM + DTS)
- Example sandbox boots Payload admin on Next 15 + SQLite
- `/admin/tree` renders the (stub) plugin view; `/api/tree-pages` returns `{nodes:[],total:0}`
- **All business logic is `TODO(v0.1)` stubs** — see PRD §14 for phase-by-phase implementation order

## What's next

Per PRD §14, the implementation runs in 10 tracer-bullet phases over ~40-60 hrs:

| Phase | Scope                                                                                  | Tag at end      |
| ----- | -------------------------------------------------------------------------------------- | --------------- |
| 0     | publishable scaffold (T1) — prepare hook, ESLint, claim `@fishtank` npm scope, publish | `0.1.0-alpha.0` |
| 1     | validateCollection real, CI flat config, basic Playwright                              | `0.1.0-alpha.1` |
| 2     | buildTreeNodes + tree endpoint + arborist render                                       | `0.1.0-alpha.2` |
| 3     | search endpoint + auto-expand + EditIframePane                                         | `0.1.0-alpha.3` |
| 4     | context menu insert/duplicate/rename/delete + reorder                                  | `0.1.0-beta.0`  |
| 5     | DnD wired to reorderNodes                                                              | `0.1.0-beta.1`  |
| 6     | gutter, lock, icons, modal, error toasts                                               | `0.1.0-beta.2`  |
| 7     | full test coverage, axe-core, perf budgets, CI matrix                                  | `0.1.0-rc.0`    |
| 8     | examples (basic + with-puck + sitecore-migration), README rewrite, GIF                 | `0.1.0-rc.1`    |
| 9     | Storybook deploy, payloadcms.com PR, Discord/HN/blog                                   | `1.0.0`         |

Each phase tags a release. Each phase is independently shippable.

**Before Phase 0**, optionally run the `prd-to-issues` skill to materialize the PRD into ~30-40 trackable GitHub issues. Skip if you trust the PRD as the source of truth.

## User context for Claude Code

- **User:** Carson Gron (`carson@getfishtank.ca`), Fishtank Consulting
- **GitHub:** `garsoncron`. The repo will eventually transfer to the `getfishtank` org once Carson has org-admin access — GitHub redirects clones, no consumer breakage.
- **npm:** scope `@fishtank` is unclaimed; first `npm publish --access public` claims it. Carson is not currently logged into npm on this machine — `npm login` is a Phase 0 step.
- **Auto-mode preference:** Carson runs Claude Code in auto-mode for this repo. Prefer action over planning. Phase-gate at every tag for review.
- **Worktree convention:** primary work happens on `main`. For risky multi-day phases (e.g. Phase 4 + 5), consider a feature branch.

## Conventions

- Conventional Commits enforced (will be wired up in Phase 0 via commitlint)
- TypeScript strict, `noUncheckedIndexedAccess`, no `any` outside disable-islands
- ESM-only; CJS deliberately out of scope
- React 18 + 19 supported via peer-range
- Payload 3.0+ supported; latest 3.x in CI
- Tests: Vitest unit (`packages/plugin/tests/unit/`), Playwright e2e (`tests/e2e/`)
- Bundle budget: admin chunk ≤ 80 KB gzip, hard CI fail

## Things NOT to do

- Do NOT inject fields into the consumer's collection — strict contract model. Validate at `buildConfig`, throw with copy-pasteable errors. (See PRD §6 "Required collection shape.")
- Do NOT add `dist/` to the repo — gitignored. The `prepare`/`prepublishOnly` hook builds it.
- Do NOT publish to npm under `@payloadcms/*` — that scope is owned by Payload Inc.
- Do NOT add CJS builds, Storybook on shipping (defer to Phase 9), or i18n config (out of scope for v1.0).
- Do NOT promise SLAs in the README beyond what PRD §9 says verbatim.
- Do NOT touch the FRAS repo from this session — it's a separate codebase. Cross-repo coordination happens via the spike docs already committed there.

## How to run

```bash
pnpm install
pnpm dev                  # boots examples/basic on first available port (3000-ish)
pnpm typecheck            # both packages
pnpm test                 # unit tests
pnpm test:e2e             # Playwright (boots examples/basic via webServer)
pnpm build                # build the plugin package
pnpm --filter @fishtank/payload-plugin-content-tree compat-check  # CLI smoke
```

Open `http://localhost:300X/admin` → first-user creation flow → visit `/admin/tree`.

## Phase 0 checklist (next session's first work)

1. Add `"prepare": "pnpm build"` AND `"prepublishOnly": "pnpm test && pnpm build"` to `packages/plugin/package.json`
2. Add `"publishConfig": { "access": "public", "provenance": true }` to `packages/plugin/package.json`
3. Add `keywords` array to `packages/plugin/package.json` per PRD §10
4. Add ESLint v9 flat config (`eslint.config.js` at root)
5. Add Prettier config (`.prettierrc.json`)
6. Verify `pnpm lint` runs without error
7. Update README to mark v0.1.0-alpha.0 explicitly as "scaffold, no functionality"
8. `npm login` (user action — pause here)
9. `cd packages/plugin && npm publish --dry-run` (verify file manifest)
10. `npm publish --access public` (creates `@fishtank` scope)
11. `git tag v0.1.0-alpha.0 && git push --tags`
12. GitHub release with notes pulled from CHANGELOG

Estimated time: 1-2 hrs. End state: an installable npm package — empty implementation, but the URL exists and the scope is yours.
