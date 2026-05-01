/**
 * @description
 * Content-type icon registry for the tree row renderer.
 *
 * Exports inline SVG icons keyed by contentType slug. All SVGs are 14×14,
 * use `currentColor` for stroke/fill so they inherit the row's text colour,
 * and carry `aria-hidden="true"` because they are purely decorative — the
 * row label conveys the accessible name.
 *
 * Key features:
 * - DEFAULT_CONTENT_TYPE_ICONS: built-in registry with `folder`, `page`,
 *   and `default` entries.
 * - getContentTypeIcon: lookup with two-level fallback
 *   (consumer registry → default registry → null).
 * - ContentTypeIconRegistry interface is exported so consumers can extend.
 *
 * @notes
 * - No 'use client' directive needed — this module only exports data
 *   (ReactNode literals) and a pure function. It is imported by client
 *   components that already carry the directive.
 * - SVGs intentionally have no explicit `color` or `stroke-width` values
 *   so parent CSS (--ct-text-muted on .ct-row__icon) controls appearance.
 * - Consumer-supplied registry threading through ContentTreeView props is
 *   deferred to a future version. The `registry` param in
 *   getContentTypeIcon exists as the extension point.
 */

import type { ReactNode } from 'react'
import React from 'react'

// ─── Registry type ────────────────────────────────────────────────────────────

/**
 * A built-in icon registry keyed by contentType slug.
 * Consumers can extend by passing a custom registry to getContentTypeIcon.
 */
export interface ContentTypeIconRegistry {
  [contentType: string]: ReactNode
}

// ─── Built-in SVG icons ───────────────────────────────────────────────────────

/**
 * Classic folder shape — two paths:
 * 1. The folder body (rounded rectangle).
 * 2. The tab on top-left indicating "this contains things".
 *
 * All coordinates are on a 14×14 grid; stroke-width 1.4 matches the weight
 * used by Heroicons "outline" at this size.
 */
const FolderIcon: ReactNode = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {/* Folder body */}
    <path d="M1 4.5C1 3.67 1.67 3 2.5 3h2.93c.28 0 .54.11.73.3L7 4.25h4.5C12.33 4.25 13 4.92 13 5.75v5.75C13 12.33 12.33 13 11.5 13h-9C1.67 13 1 12.33 1 11.5V4.5z" />
    {/* Folder tab */}
    <path d="M1 6.5h12" />
  </svg>
)

/**
 * Document with corner-fold — the classic "page" icon.
 * The fold is a triangular cut from the top-right corner.
 */
const PageIcon: ReactNode = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {/* Page outline with top-right corner fold */}
    <path d="M3 1h6.5L11 2.5V13H3V1z" />
    {/* Corner fold triangle */}
    <path d="M9.5 1v2H11" />
    {/* Horizontal lines representing text on the page */}
    <line x1="4.5" y1="5.5" x2="9.5" y2="5.5" />
    <line x1="4.5" y1="7.5" x2="9.5" y2="7.5" />
    <line x1="4.5" y1="9.5" x2="7.5" y2="9.5" />
  </svg>
)

/**
 * Default / generic content-type icon — a small filled circle.
 * Used as the ultimate fallback for unknown contentType slugs.
 */
const DefaultIcon: ReactNode = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="currentColor"
    stroke="none"
    aria-hidden="true"
  >
    <circle cx="7" cy="7" r="3" />
  </svg>
)

// ─── Default registry ─────────────────────────────────────────────────────────

/**
 * The built-in icon registry.
 * Keys: `folder`, `page`, `default`.
 *
 * Consumers can pass a custom registry to getContentTypeIcon to override or
 * extend these entries without patching this module.
 */
export const DEFAULT_CONTENT_TYPE_ICONS: ContentTypeIconRegistry = {
  folder: FolderIcon,
  page: PageIcon,
  default: DefaultIcon,
}

// ─── Lookup function ──────────────────────────────────────────────────────────

/**
 * Look up an icon by contentType slug, with a two-level fallback chain.
 *
 * Resolution order:
 * 1. `registry[contentType]` — consumer-supplied exact match.
 * 2. `registry['default']`   — consumer-supplied fallback.
 * 3. `DEFAULT_CONTENT_TYPE_ICONS[contentType]` — built-in exact match.
 * 4. `DEFAULT_CONTENT_TYPE_ICONS['default']`  — built-in fallback.
 * 5. `null` — no icon available.
 *
 * @param contentType - The node's contentType slug (e.g. "folder", "page").
 * @param registry    - Optional consumer-supplied registry. Checked first.
 *                      Intended for future extensibility via ContentTreeView
 *                      props; not yet threaded through for v0.1.
 * @returns A ReactNode (inline SVG) or null.
 */
export function getContentTypeIcon(
  contentType: string,
  registry?: ContentTypeIconRegistry,
): ReactNode | null {
  // 1. Consumer exact match
  if (registry != null && Object.prototype.hasOwnProperty.call(registry, contentType)) {
    return registry[contentType] ?? null
  }

  // 2. Consumer default fallback
  if (registry != null && Object.prototype.hasOwnProperty.call(registry, 'default')) {
    return registry['default'] ?? null
  }

  // 3. Built-in exact match
  if (Object.prototype.hasOwnProperty.call(DEFAULT_CONTENT_TYPE_ICONS, contentType)) {
    return DEFAULT_CONTENT_TYPE_ICONS[contentType] ?? null
  }

  // 4. Built-in default fallback
  return DEFAULT_CONTENT_TYPE_ICONS['default'] ?? null
}
