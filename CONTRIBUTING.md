# Contributing

## Local dev loop

```bash
pnpm install
pnpm dev   # boots examples/basic + plugin in watch mode
```

Open http://localhost:3000/admin → `/admin/tree`.

## Adding a feature

1. Implement in `packages/plugin/src/`.
2. Add a unit test in `packages/plugin/tests/unit/`.
3. If user-visible: prove it works in `examples/basic`.
4. If high-risk: add a Playwright case in `tests/e2e/`.
5. Update `README.md` if API surface changed.

## Cutting a release

For v0.1 / v0.2 we cut releases manually:

1. Bump `packages/plugin/package.json` version.
2. Update `CHANGELOG.md` (newest on top).
3. Commit: `chore(release): vX.Y.Z`.
4. Tag: `git tag vX.Y.Z && git push --tags`.
5. GitHub release is created automatically by `.github/workflows/release.yml`.

Changesets-based flow lands in v0.5+.

## Code style

- TypeScript strict, `noUncheckedIndexedAccess`.
- ESM-only.
- No emojis in code.
- File-level docstring on every non-trivial file.
- Keep CSS variables namespaced under `--ct-*`.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/) are enforced via `commitlint` running in a Husky `commit-msg` hook. Examples:

```
feat(plugin): add validateCollection helper
fix(client): debounce expand-state writes
chore(ci): add coverage threshold
docs(readme): drop alpha caveat
```

Allowed types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `revert`.

## Pre-commit hooks

- `lint-staged` runs Prettier + ESLint (`--fix --max-warnings 0`) on staged files.
- Bad commit messages are rejected by `commitlint`.

If a hook fires unexpectedly, fix the underlying issue rather than `--no-verify`.

## Scripts

```bash
pnpm lint            # eslint . --max-warnings 0
pnpm format          # prettier --write .
pnpm format:check    # prettier --check . (CI gate)
pnpm typecheck       # tsc --noEmit (every package)
pnpm test            # vitest run (every package)
pnpm test:e2e        # playwright
pnpm build           # build the plugin
```
