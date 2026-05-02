import { defineConfig } from 'tsup'
import { copyFileSync } from 'node:fs'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    client: 'src/client.ts',
    'compat-check': 'src/server/compat-check.ts',
  },
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['react', 'react-dom', 'payload', '@payloadcms/ui'],
  // Ship the stylesheet as a separate file consumers import explicitly
  // (`@garsoncron/payload-plugin-content-tree/styles.css`). Side-effect
  // imports inside the bundle don't reach Next.js consumers without
  // `transpilePackages`, so we copy the source CSS verbatim.
  onSuccess: async () => {
    copyFileSync('src/client/styles.css', 'dist/client.css')
  },
})
