'use client'

/**
 * Inline SVG icons for tree rows. Keyed by contentType slug; falls back
 * to a generic page icon for unknown types.
 *
 * Inline (not Heroicons) to avoid bundle issues inside Payload admin.
 *
 * TODO(v0.1): port from FRAS spike ContentTypeIcon.
 */

export function ContentTypeIcon({ type: _type }: { type: string }) {
  // TODO(v0.1)
  return null
}
