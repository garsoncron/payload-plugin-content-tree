# Plugin Audit — 2026-05-01

> **Question asked:** Can we publish this and pull it into a new project?
> **Honest answer:** **Not yet.** Three publish blockers, then ~14 hours of focused work to a usable v0.1.0-alpha.0.

---

## TL;DR — Where we actually are

| Dimension               | Grade  | Notes                                                                                      |
| ----------------------- | ------ | ------------------------------------------------------------------------------------------ |
| Distribution            | **F**  | No remote pushed; git+ssh installs would land empty `dist/`                                |
| Functional completeness | **F**  | Every feature in the README is a stub. `/admin/tree` renders "NOT_IMPLEMENTED"             |
| Type safety             | **B**  | Strict TS, two `as any` casts in plugin.ts (Payload view-registration types)               |
| Error handling          | **D**  | `validateCollection` no-ops; `compat-check` exits 0 on failure                             |
| Documentation           | **C+** | README/MIGRATING/CONTRIBUTING/CHANGELOG/LICENSE present; no badges, no GIF, no SECURITY.md |
| Tests                   | **F**  | 1 trivial passing test + 4 todos. e2e is `.skip()`                                         |
| Bundle hygiene          | **A−** | ESM-only, two entries, peers correct, "use client" preserved (verified)                    |
| Payload-correctness     | **B+** | importMap path resolves, view + endpoint mount (smoke-tested)                              |
| Repo hygiene            | **B**  | CI, release, license, .nvmrc all in; no eslint config (lint script fails)                  |
| Ecosystem fit           | **B−** | Naming convention OK; missing keywords, GH topics, badges                                  |

**Overall verdict: a working scaffold with verified plumbing and zero implementation.** The hardest plumbing problems (importMap path-string format, server/client export split, custom view registration via Payload 3 plugin API, REST endpoint mounting, `clientProps` function-stripping) are all proven working. The actual tree logic is unwritten.

---

## What works today (smoke-tested)

- `pnpm install` — clean, lockfile generated
- `pnpm typecheck` — clean across both packages
- `pnpm build` — ESM + DTS both green; client.js has `"use client"` preserved
- `pnpm test` — passes (1 real assertion + 4 todos)
- `pnpm dev` — boots Payload admin on Next 15 + SQLite
- `GET /admin` → 200, full Payload UI renders
- `GET /admin/tree` → 200, plugin's view component renders (placeholder text)
- `GET /api/tree-pages` → 200 `{"nodes":[],"total":0}` (plugin endpoint mounted)
- Bundle: client.js = 431 B gzip (well under 80 KB CI budget)

---

## Publish blockers (P0 — must fix before any tag)

### B1. No `prepare` script in plugin `package.json`

```json
// packages/plugin/package.json — currently missing
"scripts": {
  "prepare": "pnpm build",
  ...
}
```

Without this, `pnpm add github:getfishtank/payload-plugin-content-tree#v0.1.0` lands a package with **no `dist/`**. The consumer's import crashes immediately. `dist/` is in `.gitignore` (correct), but the published artifact has to be generated at install-time for git installs.

**Alternative:** drop `dist/` from `.gitignore` and commit built artifacts. Ugly but unblocks publishing without a prepare step. Most Payload plugins use `prepare`.

**Fix effort:** 5 min.

### B2. No remote

Local-only repo. Can't be installed by anyone else.

**Fix effort:** 5 min once gh auth + org decision is made.

### B3. Stubs render "NOT_IMPLEMENTED"

A consumer following the README would install successfully, see `/admin/tree` mount, then see literal placeholder text. That's worse than a clean error — looks broken to anyone evaluating the plugin.

The README claims (and implies it's working):

- "Right-click context menu with config-driven insert options"
- "drag-and-drop, search, keyboard nav"
- "Optional gutter indicators for workflow state and edit-locks"

None of these exist. README is currently aspirational.

**Fix:** either implement the stubs (see "Path to v0.1.0-alpha.0" below) or rewrite the README to say "v0.1.0-pre — scaffold only, no functionality." The latter is dishonest if you intend to share with hack-a-thon devs.

---

## Functional gaps (P1 — needed for "actually a tree")

In rough order of impact:

| File                                       | Status                       | Effort         | Unblocks                                                                                                                      |
| ------------------------------------------ | ---------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/server/helpers/validateCollection.ts` | stub no-ops                  | 1 hr           | Catches bad configs. Without it, consumer gets cryptic Payload errors instead of "your `pages` collection is missing field X" |
| `src/server/helpers/buildTreeNodes.ts`     | returns empty                | 1 hr           | Endpoint returns real data                                                                                                    |
| `src/server/endpoints/tree.ts`             | returns hardcoded empty      | 30 min         | View has data to render                                                                                                       |
| `src/server/endpoints/search.ts`           | returns hardcoded empty      | 30 min         | Search works                                                                                                                  |
| `src/server/helpers/resolveAncestors.ts`   | returns empty                | 30 min         | Search auto-expand works                                                                                                      |
| `src/server/helpers/reorderNodes.ts`       | no-op                        | 30 min         | DnD persists                                                                                                                  |
| `src/client/ContentTreeView.tsx`           | `<div>NOT_IMPLEMENTED</div>` | 4 hrs          | The view actually renders a tree                                                                                              |
| `src/client/TreeArborist.tsx`              | returns null                 | included above | arborist `<Tree>` wrapper                                                                                                     |
| `src/client/TreeContextMenu.tsx`           | returns null                 | 3 hrs          | Right-click menu                                                                                                              |
| `src/client/EditIframePane.tsx`            | returns null                 | 30 min         | Right-rail iframe                                                                                                             |
| `src/client/icons/index.tsx`               | returns null                 | 1 hr           | Type-specific icons                                                                                                           |
| `src/client/ui/Modal.tsx`                  | returns null                 | 30 min         | Rename prompt                                                                                                                 |
| `src/shared/insertOptions.ts`              | throws "NOT_IMPLEMENTED"     | 30 min         | Insert menu populates                                                                                                         |
| `examples/basic/src/seed/seed-tree.ts`     | logs and exits               | 30 min         | Sandbox has data to demo                                                                                                      |
| `src/server/compat-check.ts`               | prints stub                  | 1 hr           | The CLI does anything useful                                                                                                  |

**Total functional work:** ~14 hours. Most logic ports directly from the spike sketch; the work is mostly transcription + adapting field-name accessors to the config map.

---

## Hygiene + polish (P2)

### Missing repo-level files

- `eslint.config.js` (ESM flat config — eslint v9 requires it; **lint script currently fails**)
- `.prettierrc.json` or `prettier.config.js`
- `SECURITY.md`
- `.github/ISSUE_TEMPLATE/` and `PULL_REQUEST_TEMPLATE.md`
- `CODE_OF_CONDUCT.md` (some orgs require)

### README polish

- No badges (build status, license, npm version)
- References a GIF that doesn't exist
- No "Compatibility" matrix (Payload 3.x versions tested, React versions tested)

### `package.json` polish

- `keywords` field missing (was in earlier draft, dropped during overwrite)
- No `funding` field
- No `publishConfig` (would matter when v0.2 publishes to npm)

### Tests

- 0 real unit tests against the helpers
- e2e is `.skip()`
- No coverage report would meet the 80% threshold even if tests existed
- No CI matrix for React 18 vs 19 or Payload 3.0 vs 3.84

### Two `as any` casts in `plugin.ts`

```ts
;(config.admin.components as any).views = views
```

Caused by Payload's view-registration types being awkward. Could be cleaned up with proper type narrowing or a small d.ts module augmentation.

---

## Path to v0.1.0-alpha.0 — installable + usable in a new project

Ranked by what unblocks consumer adoption fastest:

**Stage 1 — Make it installable (1 hr)**

1. Add `"prepare": "pnpm build"` to `packages/plugin/package.json` (5 min)
2. Add ESLint flat config + Prettier config (15 min)
3. Add `keywords` back to `package.json`, add badges to README (10 min)
4. Push to remote (5 min, blocked on org/auth decision)
5. Tag `v0.1.0-pre.0` and verify install in a throwaway sandbox (30 min)

**Stage 2 — Make it actually validate (2 hrs)** 6. Implement `validateCollection` — full field-shape checks with copy-pasteable errors (1 hr) 7. Real unit tests for validation: missing-field, wrong-type, nested-in-tabs (45 min) 8. Update README "Required collection shape" with the actual error messages (15 min)

**Stage 3 — Make it return data (2 hrs)** 9. Implement `buildTreeNodes` + tests (1 hr) 10. Implement `tree.ts` + `search.ts` endpoints + `resolveAncestors` (1 hr)

**Stage 4 — Make it render (5 hrs)** 11. Implement `TreeArborist` wrapper (2 hrs — the arborist API plus row renderer) 12. Implement `EditIframePane` (30 min) 13. Implement `icons/` (1 hr) 14. Implement `ContentTreeView` (1.5 hrs to wire it all together)

**Stage 5 — Make it editable (4 hrs)** 15. `TreeContextMenu` + `Modal` + `insertOptions.ts` impl (3 hrs) 16. `reorderNodes` impl + DnD wiring (1 hr)

**Stage 6 — Demo it (1 hr)** 17. `seed-tree.ts` real fixture (30 min) 18. Real Playwright smoke (30 min) 19. Tag `v0.1.0-alpha.0`

**Total: ~14 hours.** Stage 1 alone (1 hour) gets you a publishable + installable package — but it'd still render "NOT_IMPLEMENTED." Stage 1+2 (3 hours) gets you a package that catches misconfigured collections honestly.

---

## What I'd do next, in priority order

1. **Decide on remote.** This is the gating decision for everything downstream. (`garsoncron` push-now-transfer-later, or `getfishtank` direct.)
2. **Stage 1 from above.** Once remote exists, ~1 hour to a tagged, installable scaffold. Nobody can use it for tree-browsing yet, but they can install it without errors and start consuming the type contract.
3. **Ship v0.1.0-pre.1 with validateCollection** (Stage 2). This is the single most valuable feature. It tells consumers they're set up wrong AT BOOT TIME, not at view-render time. High signal-to-effort.
4. **Then implement bottom-up:** endpoints → view → context menu → DnD. Each stage is independently shippable as a `0.1.0-alpha.N` tag.

The hack-a-thon-readiness threshold is **end of Stage 4** — at that point a consumer can install the plugin, see a real tree, and click around. Stages 5–6 are nice-to-have polish.

---

## Bottom line

You can't publish this _and have it work_ yet. You CAN publish it as a "scaffold" tag that proves the plumbing — and that has real value, because anyone wanting to learn how to author a Payload 3 plugin can clone it and read the working importMap setup. But for the RAS Canada hack-a-thon use case ("dev installs it, demos a tree"), Stage 4 is the minimum.

---

# Reframed: publishing as a public Payload plugin (no hack-a-thon shortcuts)

> **Question:** "Forget the hack-a-thon. If I want to publish this as my own Payload module, where are we at, and what do we need to do?"
>
> **TL;DR:** Public bar is higher than hack-a-thon bar. Net work is the same (the implementation has to happen) but the README/tests/examples/maintenance commitments increase. Realistic estimate to a `1.0.0` you'd put your name on: **40–60 hours.** A reasonable `0.1.0` first publish: **18–22 hours.**

## npm reality (verified just now)

- `@fishtank` scope on npm is **unclaimed** — you can take it. First `npm publish` of any package in the scope creates it.
- `payload-plugin-content-tree` (unscoped) is **available** — viable fallback if you want zero scope-management overhead.
- `@payloadcms/plugin-content-tree` is **available** — but you cannot publish into the `@payloadcms` scope; that's owned by Payload Inc. Don't try.
- You're **not logged into npm** on this machine. `npm login` (or `npm adduser`) is step zero of publishing.

## Three publishability tiers — be honest about which you're aiming for

| Tier                                     | Description                                                                                                                                                                                                                                  | Threshold                                                      | Real cost                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------- |
| **T1: "Published, technically"**         | npm package exists, installs cleanly, exports types, README is accurate (i.e. README admits it's a scaffold). Nobody can use it for anything but reading the importMap pattern.                                                              | Stage 1 (1 hr) + npm setup (1 hr)                              | **2 hrs**                   |
| **T2: "Useable in 80% of cases"**        | All advertised features work. Validates configs honestly. DnD, search, context menu all real. One example sandbox demonstrates it. README accurate. Smoke-tested.                                                                            | Previous audit Stages 1-6 + npm + 4 hrs of docs/testing/polish | **18-22 hrs**               |
| **T3: "I'd put my name on it publicly"** | Multiple example sandboxes (basic + advanced + Puck-integration). Compatibility matrix tested (React 18+19, Payload 3.0–3.84). Storybook hosted. CI matrix green. >50% test coverage. README has GIF + badges. Issues triaged within a week. | T2 + 20-40 hrs of polish + ongoing maintenance commitment      | **40-60 hrs + maintenance** |

**Brutal honesty:** T1 is what the README _currently implies_ is the case — it isn't. T2 is what the README _claims_. T3 is what most successful community Payload plugins look like (`payload-meilisearch`, `payload-puck`, the `@payloadcms/plugin-*` set).

## What's NEW in the public-publish bar (vs hack-a-thon bar)

Beyond the previous audit's Stage 1-6 (which still applies — the implementation has to happen), publishing publicly adds:

### npm-specific (P0 — without these, `npm publish` either fails or publishes something broken)

1. **`npm login` on this machine** — `npm adduser` or `npm login`. 2FA recommended (`npm profile enable-2fa auth-and-writes`).
2. **`publishConfig` in package.json** — scoped packages default to `restricted` (private). Need:
   ```json
   "publishConfig": { "access": "public", "provenance": true }
   ```
   Without `access: public`, `npm publish` fails on scoped packages. With `provenance: true`, npm signs the package via GitHub Actions OIDC for supply-chain trust (free, requires CI).
3. **Replace `prepare` with `prepublishOnly`** — `prepare` runs on every install (slow for consumers); `prepublishOnly` only runs before `npm publish`. The current AUDIT recommended `prepare` for git installs — for npm, `prepublishOnly` is the right hook.
4. **`.npmignore` or stricter `files` list** — verify with `npm publish --dry-run` what would actually be uploaded. Currently `"files": ["dist", "README.md", "LICENSE"]` — should pass, but unverified.
5. **Version discipline** — start at `0.1.0` (not `0.0.1`), bump minors for new features in 0.x, bump major when API stabilizes. Consider `0.1.0-alpha.0` for the first publish to signal pre-release.
6. **Add `keywords`** to package.json — gone from current state. Without these, npm search won't surface the package.

### Discovery / ecosystem fit (P1 — without these, nobody finds it)

7. **GitHub repo description + topics** — set `payload`, `payload-plugin`, `payloadcms`, `cms`, `tree-view`, `sitecore` as topics.
8. **README badges** — npm version, npm downloads, license, build status. Standard fare; signals "real package."
9. **README screenshots/GIF** — currently references a GIF that doesn't exist. For a public plugin, this is the difference between someone trying it or scrolling past.
10. **Submit to Payload's plugin directory** — payloadcms.com lists community plugins. Submission is via PR to their docs (or a form). Worth doing for distribution.
11. **`packageManager` matches reality** — root has `"packageManager": "pnpm@9.0.0"`. Confirm consumers using npm/yarn aren't blocked. (They aren't — that field only locks YOUR development pm.)

### Maintenance signals (P1)

12. **GitHub Issues + Discussions enabled** with templates (`.github/ISSUE_TEMPLATE/bug_report.md`, `feature_request.md`).
13. **`SECURITY.md`** with disclosure address.
14. **`CODE_OF_CONDUCT.md`** (Contributor Covenant standard).
15. **README "Status" section** — explicit statement of what's supported, what's not, response cadence (or "best-effort, no SLA").
16. **Renovate or Dependabot config** — keeps deps current automatically.
17. **A real CHANGELOG** — current is a stub. Use Keep-A-Changelog format or commit conventions + auto-gen.

### Quality bar (P1 — what makes this credible)

18. **README accuracy is non-negotiable.** Either implement everything claimed, or rewrite the README to say "scaffold only." Currently dishonest — claims drag-and-drop, search, context menu, gutter indicators all work. None do.
19. **Tests against public API surface.** At least: plugin function smoke (mounts view + endpoints), validateCollection error messages, buildTreeNodes shape, getAllowedInserts edge cases. Current state: 1 trivial assertion. Realistic minimum: ~30 tests covering helpers + plugin factory.
20. **Real e2e** — currently `.skip()`. For T2: at least "load admin → see tree → expand a node → reload → still expanded." For T3: full DnD persistence verification across React 18 and 19.
21. **Compatibility matrix** — tested against Payload 3.0 minimum, latest 3.x, React 18, React 19, Postgres + SQLite. Current: tested against Payload 3.84 + React 19 + SQLite only.

### Pre-publish checklist

```bash
# 1. Account
npm login                    # verify with: npm whoami
npm profile enable-2fa auth-and-writes

# 2. Build cleanly
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build

# 3. Inspect what would publish
cd packages/plugin
npm publish --dry-run        # shows the file manifest

# 4. Real publish (after T2 work is done)
npm publish --access public  # creates @fishtank scope on first publish

# 5. Verify
npm view @fishtank/payload-plugin-content-tree
# install in a throwaway sandbox, run dev, confirm /admin/tree works
```

## Recommended path

Don't try to leap to T3. Do it in tiers:

1. **Right now (2 hrs): publish T1.** Stage 1 work + npm setup. README rewrite to say "v0.1.0-alpha.0 — scaffold only, plumbing verified, implementation in progress." Push to GitHub, claim the npm scope, tag, publish. Honest, low-risk, gets the URL into the world.
2. **Next sprint (16 hrs): publish T2 as 0.2.0.** Implement the stubs. Update README to remove the alpha caveat. Add badges. One CI matrix run. Now consumers can actually use it.
3. **When you have time (20-40 hrs): polish to T3.** Storybook, advanced examples, Puck-integration example, Renovate, SECURITY.md, submit to Payload directory. This is the "I'd link this from my LinkedIn" tier.

## Where you are right now

```
[████████░░░░░░░░░░░░░░░░░░░░░░░░] 25% to T1
[████████░░░░░░░░░░░░░░░░░░░░░░░░] 25% to T2 — same prefix, longer journey
[█████░░░░░░░░░░░░░░░░░░░░░░░░░░░] 15% to T3
```

T1 is one focused evening away. T2 is realistic in a long weekend. T3 is a multi-week side-project commitment.

**The actual question to answer first:** which tier are you publishing for? T1, T2, or T3? Each has a different work plan and a different "what do I commit to maintaining" answer.
