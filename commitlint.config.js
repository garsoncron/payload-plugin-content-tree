/**
 * Conventional Commits enforced via commitlint + husky `commit-msg` hook.
 * See https://www.conventionalcommits.org/.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [1, 'always', 120],
  },
}
