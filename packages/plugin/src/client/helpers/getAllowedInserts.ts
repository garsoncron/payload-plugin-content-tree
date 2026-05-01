/**
 * @description
 * Pure helper that resolves which child contentTypes are allowed to be
 * inserted under a given parent node, based on the plugin's `insertOptions`
 * configuration (Sitecore-style insert options).
 *
 * Key features:
 * - Null parent means root-level insertion; resolves from `insertOptions['root']`
 * - Returns `[]` when the parent has no configured insert options (hides menu)
 * - Maps raw slug values to `{ value, label }` pairs for UI rendering
 * - Label priority: contentTypeLabels[value] → value with first char uppercased
 * - Preserves consumer-controlled insertion order from `insertOptions`
 *
 * @notes
 * - This is a pure function with no side effects — safe to call in render
 * - canPerformAction gating is out of scope for this helper (#22)
 * - maxDepth enforcement is handled at the component level, not here
 */

export interface AllowedInsert {
  value: string
  label: string
}

/**
 * Resolve which child contentTypes are allowed under the given parent.
 *
 * @param parentContentType - The contentType slug of the parent node.
 *   Pass `null` for root-level insertions (looks up `insertOptions['root']`).
 * @param insertOptions - Map of parent contentType slug → allowed child slugs.
 *   Use `'root'` as the key for top-level insertions.
 * @param contentTypeLabels - Optional map of contentType slug → human label.
 *   When a label is not found, falls back to value with first char uppercased.
 * @returns Ordered array of `{ value, label }` pairs. Empty array means the
 *   Insert menu item should be hidden entirely.
 */
export function getAllowedInserts(
  parentContentType: string | null,
  insertOptions: Record<string, string[]>,
  contentTypeLabels?: Record<string, string>,
): AllowedInsert[] {
  // Determine the lookup key: null parent → 'root'
  const key = parentContentType === null ? 'root' : parentContentType

  // If no entry for this key, insertion is not allowed here
  const allowed = insertOptions[key]
  if (!allowed || allowed.length === 0) return []

  // Map each slug to a labelled option, preserving order
  return allowed.map((value) => {
    const label =
      contentTypeLabels?.[value] ??
      // Fallback: uppercase the first character of the value
      (value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value)

    return { value, label }
  })
}
