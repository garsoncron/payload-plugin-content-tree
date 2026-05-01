/**
 * Unit tests for validateCollection.
 *
 * Uses lightweight hand-rolled Payload `Config` / `Field` objects rather than
 * importing the full Payload runtime, keeping the test suite fast and
 * hermetic.
 */

import { describe, it, expect } from 'vitest'
import type { Config, CollectionConfig, Field } from 'payload'
import { validateCollection } from '../../src/server/helpers/validateCollection'
import type { ContentTreePluginOptions } from '../../src/shared/types'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Minimal self-referencing relationship field. */
function parentField(name = 'parent', relationTo = 'pages'): Field {
  return { name, type: 'relationship', relationTo } as Field
}

/** Minimal number field. */
function numberField(name = 'sortOrder'): Field {
  return { name, type: 'number' } as Field
}

/** Minimal select field. */
function selectField(name = 'contentType'): Field {
  return { name, type: 'select', options: [] } as Field
}

/** Minimal text field. */
function textField(name = 'title'): Field {
  return { name, type: 'text' } as Field
}

/** All four required fields with their default names. */
function allRequiredFields(slug = 'pages'): Field[] {
  return [parentField('parent', slug), numberField(), selectField(), textField()]
}

/** Build a minimal collection config. */
function makeCollection(slug: string, fields: Field[]): CollectionConfig {
  return { slug, fields } as CollectionConfig
}

/** Build a minimal Payload Config with one collection. */
function makeConfig(collection: CollectionConfig): Config {
  return { collections: [collection] } as unknown as Config
}

/** Default plugin options for the "pages" collection. */
function defaultOpts(overrides?: Partial<ContentTreePluginOptions>): ContentTreePluginOptions {
  return { collectionSlug: 'pages', ...overrides }
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('validateCollection — happy path', () => {
  it('does not throw when all required fields are present with default names', () => {
    const config = makeConfig(makeCollection('pages', allRequiredFields()))
    expect(() => validateCollection(config, defaultOpts())).not.toThrow()
  })

  it('does not throw when required field is nested inside a tabs field', () => {
    const fields: Field[] = [
      {
        type: 'tabs',
        tabs: [
          {
            label: 'Content',
            fields: allRequiredFields(),
          },
        ],
      } as Field,
    ]
    const config = makeConfig(makeCollection('pages', fields))
    expect(() => validateCollection(config, defaultOpts())).not.toThrow()
  })

  it('does not throw when required field is nested inside a row field', () => {
    const fields: Field[] = [
      {
        type: 'row',
        fields: allRequiredFields(),
      } as Field,
    ]
    const config = makeConfig(makeCollection('pages', fields))
    expect(() => validateCollection(config, defaultOpts())).not.toThrow()
  })

  it('does not throw when required field is nested inside a collapsible field', () => {
    const fields: Field[] = [
      {
        type: 'collapsible',
        label: 'Meta',
        fields: allRequiredFields(),
      } as Field,
    ]
    const config = makeConfig(makeCollection('pages', fields))
    expect(() => validateCollection(config, defaultOpts())).not.toThrow()
  })

  it('does not throw when required field is nested inside a group field', () => {
    const fields: Field[] = [
      {
        type: 'group',
        name: 'meta',
        fields: allRequiredFields(),
      } as Field,
    ]
    const config = makeConfig(makeCollection('pages', fields))
    expect(() => validateCollection(config, defaultOpts())).not.toThrow()
  })

  it('does not throw when parent is renamed via opts.fields.parent and the renamed field exists', () => {
    const fields: Field[] = [
      parentField('parentDoc', 'pages'),
      numberField(),
      selectField(),
      textField(),
    ]
    const config = makeConfig(makeCollection('pages', fields))
    expect(() =>
      validateCollection(config, defaultOpts({ fields: { parent: 'parentDoc' } })),
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Missing collection slug
// ---------------------------------------------------------------------------

describe('validateCollection — missing collection', () => {
  it('throws when the target collection slug is not in config.collections', () => {
    const config = makeConfig(makeCollection('articles', allRequiredFields('articles')))
    expect(() => validateCollection(config, defaultOpts())).toThrow(
      /Collection "pages" was not found in config\.collections/,
    )
  })

  it('throws with the [content-tree-plugin] prefix', () => {
    const config: Config = { collections: [] } as unknown as Config
    expect(() => validateCollection(config, defaultOpts())).toThrow(/\[content-tree-plugin\]/)
  })
})

// ---------------------------------------------------------------------------
// Missing required fields
// ---------------------------------------------------------------------------

describe('validateCollection — missing required fields', () => {
  it('throws when the parent field is missing', () => {
    const fields = [numberField(), selectField(), textField()]
    const config = makeConfig(makeCollection('pages', fields))
    expect(() => validateCollection(config, defaultOpts())).toThrow(
      /missing required field "parent"/,
    )
  })

  it('throws when the sortOrder field is missing', () => {
    const fields = [parentField('parent', 'pages'), selectField(), textField()]
    const config = makeConfig(makeCollection('pages', fields))
    expect(() => validateCollection(config, defaultOpts())).toThrow(
      /missing required field "sortOrder"/,
    )
  })

  it('throws when the contentType field is missing', () => {
    const fields = [parentField('parent', 'pages'), numberField(), textField()]
    const config = makeConfig(makeCollection('pages', fields))
    expect(() => validateCollection(config, defaultOpts())).toThrow(
      /missing required field "contentType"/,
    )
  })

  it('throws when the title field is missing', () => {
    const fields = [parentField('parent', 'pages'), numberField(), selectField()]
    const config = makeConfig(makeCollection('pages', fields))
    expect(() => validateCollection(config, defaultOpts())).toThrow(
      /missing required field "title"/,
    )
  })

  it('includes the [content-tree-plugin] prefix in the missing-field error', () => {
    const config = makeConfig(makeCollection('pages', []))
    expect(() => validateCollection(config, defaultOpts())).toThrow(/\[content-tree-plugin\]/)
  })

  it('throws with the expected message format including type hint and override hint', () => {
    const fields = [numberField(), selectField(), textField()]
    const config = makeConfig(makeCollection('pages', fields))
    expect(() => validateCollection(config, defaultOpts())).toThrow(
      /\[content-tree-plugin\] Collection "pages" is missing required field "parent" \(type: relationship, relationTo: "pages"\)\. Add it to the collection, or pass plugin option `fields\.parent = "<your-field-name>"`\./,
    )
  })
})

// ---------------------------------------------------------------------------
// Wrong field type
// ---------------------------------------------------------------------------

describe('validateCollection — wrong field type', () => {
  it('throws when parent field exists but is text type (not relationship)', () => {
    const fields = [textField('parent'), numberField(), selectField(), textField()]
    const config = makeConfig(makeCollection('pages', fields))
    expect(() => validateCollection(config, defaultOpts())).toThrow(
      /field "parent" has type "text" but type "relationship" is required/,
    )
  })

  it('throws when sortOrder field exists but is text type (not number)', () => {
    const fields = [
      parentField('parent', 'pages'),
      textField('sortOrder'),
      selectField(),
      textField(),
    ]
    const config = makeConfig(makeCollection('pages', fields))
    expect(() => validateCollection(config, defaultOpts())).toThrow(
      /field "sortOrder" has type "text" but type "number" is required/,
    )
  })
})

// ---------------------------------------------------------------------------
// Parent field relationship assertions
// ---------------------------------------------------------------------------

describe('validateCollection — parent field relationTo assertions', () => {
  it('throws when parent is relationship but relationTo points to a different collection', () => {
    const fields = [
      parentField('parent', 'articles'), // wrong slug
      numberField(),
      selectField(),
      textField(),
    ]
    const config = makeConfig(makeCollection('pages', fields))
    expect(() => validateCollection(config, defaultOpts())).toThrow(
      /must relate to "pages" \(self-referencing\)/,
    )
  })

  it('throws when parent is a polymorphic relationship to multiple collections', () => {
    const fields: Field[] = [
      {
        name: 'parent',
        type: 'relationship',
        relationTo: ['pages', 'articles'], // polymorphic, not single self-ref
      } as Field,
      numberField(),
      selectField(),
      textField(),
    ]
    const config = makeConfig(makeCollection('pages', fields))
    expect(() => validateCollection(config, defaultOpts())).toThrow(
      /must relate to "pages" \(self-referencing\)/,
    )
  })

  it('does not throw when parent is a single-element array relationship to itself', () => {
    const fields: Field[] = [
      {
        name: 'parent',
        type: 'relationship',
        relationTo: ['pages'], // single-element array pointing to self
      } as Field,
      numberField(),
      selectField(),
      textField(),
    ]
    const config = makeConfig(makeCollection('pages', fields))
    expect(() => validateCollection(config, defaultOpts())).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Field-name overrides via opts.fields
// ---------------------------------------------------------------------------

describe('validateCollection — opts.fields name overrides', () => {
  it('throws when opts.fields.parent is set but the renamed field does not exist', () => {
    const fields = allRequiredFields() // has "parent", not "parentDoc"
    const config = makeConfig(makeCollection('pages', fields))
    expect(() =>
      validateCollection(config, defaultOpts({ fields: { parent: 'parentDoc' } })),
    ).toThrow(/missing required field "parentDoc"/)
  })

  it('validates against the overridden name, not the default', () => {
    // "parent" exists but opts says look for "parentDoc" which is absent
    const fields = allRequiredFields()
    const config = makeConfig(makeCollection('pages', fields))
    expect(() =>
      validateCollection(config, defaultOpts({ fields: { parent: 'parentDoc' } })),
    ).toThrow(/missing required field "parentDoc"/)
  })

  it('passes when all overridden field names are present', () => {
    const fields: Field[] = [
      parentField('myParent', 'pages'),
      numberField('myOrder'),
      selectField('myType'),
      textField('myTitle'),
    ]
    const config = makeConfig(makeCollection('pages', fields))
    expect(() =>
      validateCollection(
        config,
        defaultOpts({
          fields: {
            parent: 'myParent',
            sortOrder: 'myOrder',
            contentType: 'myType',
            title: 'myTitle',
          },
        }),
      ),
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// config.collections edge cases
// ---------------------------------------------------------------------------

describe('validateCollection — config edge cases', () => {
  it('throws gracefully when config.collections is undefined', () => {
    const config: Config = {} as unknown as Config
    expect(() => validateCollection(config, defaultOpts())).toThrow(
      /Collection "pages" was not found/,
    )
  })

  it('throws gracefully when config.collections is an empty array', () => {
    const config: Config = { collections: [] } as unknown as Config
    expect(() => validateCollection(config, defaultOpts())).toThrow(
      /Collection "pages" was not found/,
    )
  })

  it('finds the correct collection when multiple collections exist', () => {
    const config: Config = {
      collections: [
        makeCollection('articles', [
          parentField('parent', 'articles'),
          numberField(),
          selectField(),
          textField(),
        ]),
        makeCollection('pages', allRequiredFields('pages')),
      ],
    } as unknown as Config
    expect(() => validateCollection(config, defaultOpts())).not.toThrow()
  })
})
