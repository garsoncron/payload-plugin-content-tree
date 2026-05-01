import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: ['src/server/helpers/**', 'src/shared/**', 'src/client/hooks/**'],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
})
