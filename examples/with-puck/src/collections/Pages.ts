import type { CollectionConfig } from 'payload'

/**
 * Minimal Pages collection that satisfies the plugin's required field
 * contract: parent (self-relationship), sortOrder (number), contentType
 * (select), title (text).
 *
 * Identical to examples/basic — the plugin's field contract is the same
 * regardless of which editor (Payload default vs Puck) renders the pages.
 */
export const Pages: CollectionConfig = {
  slug: 'pages',
  admin: { useAsTitle: 'title' },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', unique: true, index: true },
    {
      name: 'parent',
      type: 'relationship',
      relationTo: 'pages',
      index: true,
    },
    { name: 'sortOrder', type: 'number', defaultValue: 0 },
    {
      name: 'contentType',
      type: 'select',
      defaultValue: 'page',
      options: [
        { label: 'Page', value: 'page' },
        { label: 'Folder', value: 'folder' },
      ],
    },
  ],
}
