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

- TypeScript strict.
- ESM-only.
- No emojis in code.
- File-level docstring on every non-trivial file.
- Keep CSS variables namespaced under `--ct-*`.
