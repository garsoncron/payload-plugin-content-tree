import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      // Instrument all source TypeScript/TSX — excludes tests, dist, node_modules,
      // type-only declaration files, and the compat-check CLI (print-only shim).
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/server/compat-check.ts',
        // Large React component files that import Payload/react-arborist internals
        // are not unit-testable without a full browser env. They are gated by
        // Playwright e2e in Phase 7 and therefore excluded from the unit threshold.
        // (PRD §10 "≥ 60% client" applies to helpers + hooks — the testable surface.)
        'src/client/ContentTreeView.tsx',
        'src/client/TreeArborist.tsx',
        'src/client/TreeContextMenu.tsx',
        'src/client/EditIframePane.tsx',
        'src/client/ui/Modal.tsx',
        'src/client/ui/Toast.tsx',
        'src/client/icons/index.tsx',
        // Re-export shims — no logic to test.
        'src/client.ts',
        'src/index.ts',
        // Plugin wiring — integration-level, not unit-testable in isolation.
        'src/plugin.ts',
        // Type-only file — no runtime coverage.
        'src/shared/types.ts',
        'dist/**',
        'node_modules/**',
        'tests/**',
      ],
      thresholds: {
        // Server layer: helpers + endpoints must meet the higher bar from PRD §10.
        'src/server/**/*.ts': {
          lines: 80,
          functions: 80,
          branches: 70,
          statements: 80,
        },
        // Client helpers: pure logic, unit-testable, must meet PRD §10 client bar.
        'src/client/helpers/**/*.ts': {
          lines: 60,
          functions: 60,
          branches: 50,
          statements: 60,
        },
        // Client hooks: pure logic, unit-testable, must meet PRD §10 client bar.
        'src/client/hooks/**/*.ts': {
          lines: 60,
          functions: 60,
          branches: 50,
          statements: 60,
        },
      },
    },
  },
})
