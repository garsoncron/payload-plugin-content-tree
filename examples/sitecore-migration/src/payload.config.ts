/**
 * examples/sitecore-migration — Payload config that demonstrates the
 * Sitecore → Payload content-tree migration narrative.
 *
 * Extends the minimal plugin contract with Sitecore-flavored fields:
 * templateId, displayName, legacyPath, slug — see src/collections/Pages.ts.
 *
 * The `contentType` options mirror common Sitecore page archetypes:
 *   page | folder | datasource | mediaFolder
 *
 * The `insertOptions` reflect real Sitecore tree rules: folders can hold
 * pages and sub-folders; pages can hold datasource items; media folders
 * hold other media folders.
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
        // Root: only folders and pages at the top level (mirrors Sitecore /content node)
        root: ['folder', 'page'],
        // Folders: can contain pages and sub-folders
        folder: ['page', 'folder'],
        // Pages: can contain datasource items (SXA local datasources)
        page: ['page', 'datasource'],
        // Datasource: no children in a typical SXA setup
        datasource: [],
        // Media folders: nest recursively
        mediaFolder: ['mediaFolder'],
      },
      contentTypeLabels: {
        page: 'Page',
        folder: 'Folder',
        datasource: 'Datasource',
        mediaFolder: 'Media Folder',
      },
    }),
  ],
})
