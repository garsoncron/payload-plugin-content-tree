/**
 * examples/with-puck — Payload config demonstrating Puck integration.
 *
 * This example shows how to wire `editUrlBuilder` (a function option that
 * cannot survive the RSC clientProps boundary) into the content tree view
 * via a consumer-owned wrapper client component.
 *
 * Architecture:
 *  - The plugin registers its default view at `/admin/tree` (no editUrlBuilder).
 *  - A second custom view at `/admin/tree-puck` imports <TreeWithPuck>, which
 *    wraps <ContentTreeView> and injects editUrlBuilder as a prop. This is
 *    the pattern consumers must use for any function-typed plugin option.
 */

import { buildConfig } from 'payload'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { contentTreePlugin } from '@garsoncron/payload-plugin-content-tree'
import { Pages } from './collections/Pages'
import path from 'path'
import { fileURLToPath } from 'url'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    importMap: {
      baseDir: path.resolve(dirname),
    },
    components: {
      views: {
        // Register the consumer's wrapper as a second view at /admin/tree-puck.
        //
        // This view passes editUrlBuilder as a prop to <ContentTreeView>,
        // which is the correct pattern since functions cannot cross the RSC
        // clientProps boundary (they are not JSON-serialisable).
        //
        // The plugin's default view at /admin/tree still works and points at
        // Payload's built-in edit page. Navigate to /admin/tree-puck to see
        // the Puck-as-iframe-target behaviour.
        //
        // The path string below resolves relative to `admin.importMap.baseDir`
        // (which is this file's directory, i.e. `src/`). Payload's importMap
        // generator picks this up automatically on `pnpm dev` / `pnpm build`.
        treePuck: {
          Component: {
            path: './components/TreeWithPuck#TreeWithPuck',
          },
          path: '/tree-puck',
        },
      },
    },
  },
  collections: [Pages],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || 'dev-secret-change-me',
  db: sqliteAdapter({ client: { url: 'file:./dev.db' } }),
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  plugins: [
    contentTreePlugin({
      collectionSlug: 'pages',
      insertOptions: {
        root: ['page', 'folder'],
        folder: ['page', 'folder'],
        page: ['page'],
      },
      contentTypeLabels: {
        page: 'Page',
        folder: 'Folder',
      },
      // NOTE: editUrlBuilder is intentionally NOT passed here.
      // Plugin options are serialised to JSON when crossing the server→client
      // boundary as Payload clientProps — functions are stripped by the plugin.
      // Wire editUrlBuilder by wrapping <ContentTreeView> in your own client
      // component (see src/components/TreeWithPuck.tsx for the pattern).
    }),
  ],
})
