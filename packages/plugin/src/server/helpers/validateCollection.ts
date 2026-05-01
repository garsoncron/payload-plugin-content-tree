/**
 * Validates that the target collection exposes the fields the plugin
 * requires. Throws with a copy-pasteable error pointing at exactly
 * which field is missing or wrongly typed.
 *
 * TODO(v0.1): port from FRAS spike Section 3.9.
 * Tests: tests/unit/validation.test.ts
 */

import type { Config } from 'payload'
import type { ContentTreePluginOptions } from '../../shared/types'

const REQUIRED = [
  { key: 'parent', type: 'relationship', default: 'parent' },
  { key: 'sortOrder', type: 'number', default: 'sortOrder' },
  { key: 'contentType', type: 'select', default: 'contentType' },
  { key: 'title', type: 'text', default: 'title' },
] as const

export function validateCollection(_config: Config, _opts: ContentTreePluginOptions): void {
  // TODO(v0.1): walk config.collections, find by slug, walk its fields
  // (recursively into tabs), assert each REQUIRED entry is present and
  // of the correct type. Throw with the message:
  //   `[content-tree-plugin] Collection "<slug>" is missing required
  //    field "<name>". Add it (type: "<type>") or pass fields.<key>.`
  void REQUIRED
}
