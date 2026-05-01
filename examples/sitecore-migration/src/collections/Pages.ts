import type { CollectionConfig } from 'payload'

/**
 * Pages collection for the Sitecore-migration example.
 *
 * Extends the minimal plugin contract (parent, sortOrder, contentType, title)
 * with fields that a typical Sitecore-to-Payload migration would carry:
 *
 *   - slug          — URL-friendly identifier (kebab-cased item name)
 *   - templateId    — Sitecore template GUID, preserved for reference
 *   - displayName   — Sitecore DisplayName (can differ from item Name/title)
 *   - legacyPath    — original Sitecore item path (indexed for redirect lookups)
 *
 * contentType values reflect the four most common Sitecore item archetypes:
 *   - page        — renderable page (inherits from Page template)
 *   - folder      — organisational container (no rendering)
 *   - datasource  — SXA / MVC datasource item (not renderable itself)
 *   - mediaFolder — /sitecore/media library subfolder (no rendering)
 *
 * In a real migration, datasource items and media items would likely live in
 * separate Payload collections; they appear here so the import script can
 * faithfully represent the source tree structure without data loss.
 */
export const Pages: CollectionConfig = {
  slug: 'pages',
  admin: { useAsTitle: 'title' },
  fields: [
    // ── Plugin-required fields ─────────────────────────────────────────────

    /** Human-readable title (maps from Sitecore DisplayName or Name). */
    { name: 'title', type: 'text', required: true },

    /**
     * Self-referential parent pointer — the core of the tree structure.
     * Maps from Sitecore ParentID.
     */
    {
      name: 'parent',
      type: 'relationship',
      relationTo: 'pages',
      index: true,
    },

    /** Sibling ordering within the parent. Maps from Sitecore sortorder field. */
    { name: 'sortOrder', type: 'number', defaultValue: 0 },

    /**
     * Sitecore item archetype — used by the plugin to decide which child
     * types are permitted (insertOptions) and which icon to render.
     */
    {
      name: 'contentType',
      type: 'select',
      defaultValue: 'page',
      options: [
        { label: 'Page', value: 'page' },
        { label: 'Folder', value: 'folder' },
        { label: 'Datasource', value: 'datasource' },
        { label: 'Media Folder', value: 'mediaFolder' },
      ],
    },

    // ── Migration-specific fields ──────────────────────────────────────────

    /**
     * URL slug derived from the Sitecore item name (kebab-cased).
     * Used to construct canonical URLs on the Payload side.
     * Index + unique so redirect lookups stay fast.
     */
    { name: 'slug', type: 'text', unique: true, index: true },

    /**
     * Sitecore template GUID.
     * Preserved verbatim from the export so the import can be re-run
     * idempotently and cross-referenced with the Sitecore template registry.
     *
     * Example: "{76036F5E-CBCE-46D1-AF0A-4143F9B557AA}"
     */
    { name: 'templateId', type: 'text', index: true },

    /**
     * Sitecore DisplayName (the human-facing label shown in the Content Editor).
     * Often identical to `title` but can differ when the item name contains
     * illegal characters (e.g. "Home Page" vs "home-page").
     */
    { name: 'displayName', type: 'text' },

    /**
     * Full Sitecore item path at time of export.
     * Example: "/sitecore/content/Home/About/Team"
     *
     * Indexed so you can do an O(1) lookup when resolving legacy redirects:
     *   db.find({ collection: 'pages', where: { legacyPath: { equals: req.path } } })
     * then 301 → the current Payload URL.
     */
    { name: 'legacyPath', type: 'text', index: true },
  ],
}
