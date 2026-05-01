/**
 * examples/basic — minimal Payload config that exercises the plugin.
 *
 * Boots SQLite (no Docker required), defines a single `pages` collection
 * with the required tree fields, and registers the plugin.
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
    }),
  ],
})
