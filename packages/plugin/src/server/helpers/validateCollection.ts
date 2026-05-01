/**
 * Validates that the target collection exposes the fields the plugin
 * requires. Throws with a copy-pasteable error pointing at exactly
 * which field is missing or wrongly typed.
 *
 * Walk order:
 *  - Find the collection by `opts.collectionSlug` in `config.collections`.
 *  - For each REQUIRED field entry, resolve the effective field name
 *    (prefer `opts.fields?.[key]`, else the default name).
 *  - Recursively search the collection's `fields` array, descending into
 *    `tabs` (each tab has `.fields`), `row` (`.fields`), `collapsible`
 *    (`.fields`), and `group` (`.fields`). Array and blocks sub-schemas
 *    are NOT descended — they are sub-documents, not the doc shape.
 *  - Assert each required field exists and has the expected `type`.
 *  - For `parent` additionally assert `relationTo === opts.collectionSlug`.
 *
 * Tests: tests/unit/validation.test.ts
 */

import type { Config, Field } from 'payload'
import type { ContentTreePluginOptions } from '../../shared/types'

// ---------------------------------------------------------------------------
// Required field manifest
// ---------------------------------------------------------------------------

type RequiredFieldKey = 'parent' | 'sortOrder' | 'contentType' | 'title'

interface RequiredEntry {
  readonly key: RequiredFieldKey
  /** Payload field type that must match. */
  readonly type: string
  /** Default field name when opts.fields[key] is not set. */
  readonly default: string
}

const REQUIRED: readonly RequiredEntry[] = [
  { key: 'parent', type: 'relationship', default: 'parent' },
  { key: 'sortOrder', type: 'number', default: 'sortOrder' },
  { key: 'contentType', type: 'select', default: 'contentType' },
  { key: 'title', type: 'text', default: 'title' },
] as const

// ---------------------------------------------------------------------------
// Field-walking helpers
// ---------------------------------------------------------------------------

/**
 * Recursively search `fields` for a field with the given `name`, descending
 * into layout containers (tabs, row, collapsible, group) but NOT into array
 * or blocks sub-schemas (those are sub-documents).
 *
 * Returns the matching `Field` or `undefined` if not found.
 */
function findFieldByName(fields: Field[], name: string): Field | undefined {
  for (const field of fields) {
    // Named leaf-ish field — check directly.
    if ('name' in field && field.name === name) {
      return field
    }

    // Tabs field: each tab has its own `.fields` array.
    if (field.type === 'tabs') {
      for (const tab of field.tabs) {
        const found = findFieldByName(tab.fields, name)
        if (found !== undefined) return found
      }
      continue
    }

    // Layout containers that carry `.fields` but NOT array/blocks.
    if (
      field.type === 'row' ||
      field.type === 'collapsible' ||
      (field.type === 'group' && 'fields' in field)
    ) {
      const found = findFieldByName((field as { fields: Field[] }).fields, name)
      if (found !== undefined) return found
    }

    // array and blocks are deliberately NOT descended — they are sub-docs.
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

function missingFieldError(
  slug: string,
  fieldName: string,
  expectedType: string,
  optionKey: RequiredFieldKey,
  extra = '',
): string {
  return (
    `[content-tree-plugin] Collection "${slug}" is missing required field "${fieldName}" ` +
    `(type: ${expectedType}${extra}). ` +
    `Add it to the collection, or pass plugin option \`fields.${optionKey} = "<your-field-name>"\`.`
  )
}

function wrongTypeError(
  slug: string,
  fieldName: string,
  expectedType: string,
  actualType: string,
  optionKey: RequiredFieldKey,
  extra = '',
): string {
  return (
    `[content-tree-plugin] Collection "${slug}" field "${fieldName}" has type "${actualType}" ` +
    `but type "${expectedType}" is required${extra}. ` +
    `Rename or retype the field, or pass plugin option \`fields.${optionKey} = "<your-field-name>"\`.`
  )
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function validateCollection(config: Config, opts: ContentTreePluginOptions): void {
  const slug = opts.collectionSlug

  // ── 1. Find the collection ──────────────────────────────────────────────
  const collection = (config.collections ?? []).find((c) => c.slug === slug)
  if (collection === undefined) {
    throw new Error(
      `[content-tree-plugin] Collection "${slug}" was not found in config.collections. ` +
        `Add a collection with slug "${slug}" or correct the \`collectionSlug\` plugin option.`,
    )
  }

  // ── 2. Validate each required field ────────────────────────────────────
  for (const entry of REQUIRED) {
    // Resolve effective name (override wins).
    const effectiveName: string = opts.fields?.[entry.key] ?? entry.default

    const found = findFieldByName(collection.fields, effectiveName)

    if (found === undefined) {
      // Special-case parent: include the relationTo hint.
      const extra = entry.key === 'parent' ? `, relationTo: "${slug}"` : ''
      throw new Error(missingFieldError(slug, effectiveName, entry.type, entry.key, extra))
    }

    if (found.type !== entry.type) {
      const extra = entry.key === 'parent' ? ` with relationTo: "${slug}"` : ''
      throw new Error(wrongTypeError(slug, effectiveName, entry.type, found.type, entry.key, extra))
    }

    // ── 3. Additional assertion for `parent` ───────────────────────────
    if (entry.key === 'parent') {
      // RelationshipField is either Single or Polymorphic.
      // Single: relationTo is a string. Polymorphic: relationTo is string[].
      const rel = found as { type: 'relationship'; relationTo: string | string[] }
      const relTo = rel.relationTo

      const isSelfRef =
        typeof relTo === 'string'
          ? relTo === slug
          : Array.isArray(relTo) && relTo.length === 1 && relTo[0] === slug

      if (!isSelfRef) {
        const relToStr = Array.isArray(relTo) ? `[${relTo.join(', ')}]` : `"${relTo}"`
        throw new Error(
          `[content-tree-plugin] Collection "${slug}" field "${effectiveName}" ` +
            `is a relationship to ${relToStr} but must relate to "${slug}" (self-referencing). ` +
            `Fix the field's \`relationTo\`, or pass plugin option \`fields.parent = "<your-field-name>"\`.`,
        )
      }
    }
  }
}
