/**
 * Unit tests for the getAllowedInserts client helper (issue #19).
 *
 * Tests cover:
 *  1. null parent with root key present → returns entries in order
 *  2. null parent with no root key → returns []
 *  3. non-root parent with matching key → returns entries
 *  4. non-root parent with no matching key → returns []
 *  5. labels resolve from contentTypeLabels when provided
 *  6. labels fall back to value with first char uppercased
 *  7. order preserved from insertOptions
 */

import { describe, it, expect } from 'vitest'
import { getAllowedInserts } from '../../src/client/helpers/getAllowedInserts'

describe('getAllowedInserts', () => {
  // ── 1. null parent with root key ───────────────────────────────────────────

  it('returns options from insertOptions["root"] when parentContentType is null', () => {
    const result = getAllowedInserts(null, { root: ['page', 'folder'] })
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ value: 'page', label: 'Page' })
    expect(result[1]).toEqual({ value: 'folder', label: 'Folder' })
  })

  // ── 2. null parent with no root key ───────────────────────────────────────

  it('returns [] when parentContentType is null and no "root" key exists', () => {
    const result = getAllowedInserts(null, { folder: ['page'] })
    expect(result).toEqual([])
  })

  it('returns [] when insertOptions is empty and parentContentType is null', () => {
    const result = getAllowedInserts(null, {})
    expect(result).toEqual([])
  })

  // ── 3. non-root parent with matching key ──────────────────────────────────

  it('returns options from insertOptions[parentContentType] for non-root nodes', () => {
    const result = getAllowedInserts('folder', { folder: ['page', 'folder'] })
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ value: 'page', label: 'Page' })
    expect(result[1]).toEqual({ value: 'folder', label: 'Folder' })
  })

  // ── 4. non-root parent with no matching key ───────────────────────────────

  it('returns [] when parentContentType has no entry in insertOptions', () => {
    const result = getAllowedInserts('page', { folder: ['page'] })
    expect(result).toEqual([])
  })

  it('returns [] when insertOptions is empty and parentContentType is set', () => {
    const result = getAllowedInserts('page', {})
    expect(result).toEqual([])
  })

  // ── 5. labels from contentTypeLabels ──────────────────────────────────────

  it('uses contentTypeLabels[value] when the label map is provided and has the key', () => {
    const result = getAllowedInserts(
      null,
      { root: ['page', 'folder'] },
      {
        page: 'Web Page',
        folder: 'Content Folder',
      },
    )
    expect(result[0]).toEqual({ value: 'page', label: 'Web Page' })
    expect(result[1]).toEqual({ value: 'folder', label: 'Content Folder' })
  })

  it('uses only the matched keys from contentTypeLabels — falls back for unmapped values', () => {
    const result = getAllowedInserts(
      null,
      { root: ['page', 'folder'] },
      {
        page: 'Web Page',
        // no entry for 'folder' → fallback
      },
    )
    expect(result[0]).toEqual({ value: 'page', label: 'Web Page' })
    expect(result[1]).toEqual({ value: 'folder', label: 'Folder' }) // fallback
  })

  // ── 6. fallback label — first char uppercased ─────────────────────────────

  it('uppercases the first char of value when no label is available', () => {
    const result = getAllowedInserts('folder', { folder: ['newsArticle'] })
    expect(result[0]).toEqual({ value: 'newsArticle', label: 'NewsArticle' })
  })

  it('handles an empty-string value gracefully (returns empty string label)', () => {
    const result = getAllowedInserts('folder', { folder: [''] })
    expect(result[0]).toEqual({ value: '', label: '' })
  })

  // ── 7. order preserved ────────────────────────────────────────────────────

  it('preserves the insertion order from insertOptions', () => {
    const insertOptions = {
      root: ['zPage', 'aPage', 'mPage'],
    }
    const result = getAllowedInserts(null, insertOptions)
    expect(result.map((r) => r.value)).toEqual(['zPage', 'aPage', 'mPage'])
  })

  it('preserves order for a non-root parent', () => {
    const insertOptions = {
      folder: ['blogPost', 'landingPage', 'newsArticle'],
    }
    const result = getAllowedInserts('folder', insertOptions)
    expect(result.map((r) => r.value)).toEqual(['blogPost', 'landingPage', 'newsArticle'])
  })
})
