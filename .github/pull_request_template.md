<!--
Thanks for contributing! Keep PRs focused — one concern per PR.
See CONTRIBUTING.md for the full workflow.
-->

## Summary

<!-- 1-3 bullets describing the change and why. -->

## Linked issue

Closes #

## Type of change

- [ ] `feat` — new feature
- [ ] `fix` — bug fix
- [ ] `docs` — documentation
- [ ] `chore` — tooling, deps, CI
- [ ] `refactor` — no behavior change
- [ ] `test` — tests only
- [ ] `breaking` — breaking change (note the migration path below)

## Test plan

<!-- Bulleted checklist of how you verified this. -->

- [ ]
- [ ]

## Checklist

- [ ] Conventional Commits used (`pnpm` commit hook will enforce)
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass locally
- [ ] If this touches the public API, `PRD.md` §6 still describes truth
- [ ] If this touches admin UI, no new axe-core violations
- [ ] If this changes the bundle size meaningfully, the 80 KB gzip budget still holds

## Breaking changes / migration notes

<!-- If this is a breaking change, describe the user-visible behavior change and how consumers migrate. Otherwise: "None." -->
