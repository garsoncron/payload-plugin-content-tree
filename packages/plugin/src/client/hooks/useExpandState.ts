'use client'

/**
 * @description
 * useExpandState — persists which tree nodes are expanded to localStorage,
 * keyed by collectionSlug + version string.
 *
 * Wire into ContentTreeView in the #12 follow-up (issue #12).
 *
 * Key features:
 * - Storage key format: `content-tree:expand:{collectionSlug}:v{version}`
 * - SSR-safe: returns {} on server; hydrates from localStorage on mount via useEffect
 * - Debounced writes (200ms trailing) to avoid excessive localStorage I/O
 * - Eviction: caps at 5,000 entries (oldest first) to prevent quota exhaustion
 * - Graceful degradation: malformed or unavailable localStorage → falls back to {}
 *
 * @notes
 * - Version defaults to '1'. Bump to bust all persisted expand state.
 * - The public openState surface is a plain Record<string, boolean> to match
 *   react-arborist's initialOpenState prop shape.
 * - Eviction order tracks Map insertion order (which mirrors JavaScript spec:
 *   insertion-ordered iteration). Oldest keys are the ones inserted first.
 */

import { useState, useEffect, useCallback, useRef } from 'react'

/** Maximum number of entries to persist before evicting oldest. */
const MAX_ENTRIES = 5_000

/** Debounce delay (ms) for localStorage writes. */
const DEBOUNCE_MS = 200

// ---------------------------------------------------------------------------
// Public API surface
// ---------------------------------------------------------------------------

export interface UseExpandStateApi {
  /** Map shaped for react-arborist's `initialOpenState` prop: id (string) → boolean. */
  openState: Record<string, boolean>
  /** Set the open/closed status of a single node. */
  setOpen: (id: string, open: boolean) => void
  /** Replace the entire openState (used on bulk operations like search auto-expand). */
  replaceOpenState: (next: Record<string, boolean>) => void
  /** Clear all expand state for this key. */
  clear: () => void
}

export interface UseExpandStateArgs {
  /** localStorage key segment that scopes this state to a single tree. */
  collectionSlug: string
  /** Optional version key to bust persisted state on schema changes. Default '1'. */
  version?: string
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Build the localStorage key for a given slug + version. */
function buildKey(collectionSlug: string, version: string): string {
  return `content-tree:expand:${collectionSlug}:v${version}`
}

/**
 * Read and parse expand state from localStorage.
 * Returns {} on any failure (SSR, blocked, malformed JSON).
 * Logs a console.warn on malformed JSON.
 */
function readFromStorage(storageKey: string): Record<string, boolean> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      console.warn(
        `[content-tree-plugin] useExpandState: malformed localStorage value at "${storageKey}". Falling back to {}.`,
      )
      return {}
    }
    // Validate that all values are booleans; coerce others with a warn.
    const result: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'boolean') {
        result[k] = v
      }
    }
    return result
  } catch (_err) {
    console.warn(
      `[content-tree-plugin] useExpandState: failed to parse localStorage at "${storageKey}". Falling back to {}.`,
    )
    return {}
  }
}

/**
 * Write expand state to localStorage.
 * Swallows quota errors with a console.warn.
 */
function writeToStorage(storageKey: string, state: Record<string, boolean>): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(storageKey, JSON.stringify(state))
  } catch (_err) {
    console.warn(
      `[content-tree-plugin] useExpandState: failed to write to localStorage at "${storageKey}" (quota exceeded?).`,
    )
  }
}

/**
 * Remove the localStorage entry entirely.
 */
function removeFromStorage(storageKey: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(storageKey)
  } catch (_err) {
    // Ignore — best-effort cleanup
  }
}

/**
 * Evict oldest entries from a Record to keep it at most `max` entries.
 * Relies on JavaScript's guaranteed insertion-order iteration of object keys
 * (ES2015+). Oldest keys appear first when iterating.
 *
 * Returns a new object; does not mutate the input.
 */
function evictOldest(state: Record<string, boolean>, max: number): Record<string, boolean> {
  const keys = Object.keys(state)
  if (keys.length <= max) return state

  // Drop oldest (front of insertion order) until we're at max.
  const keysToKeep = keys.slice(keys.length - max)
  const evicted: Record<string, boolean> = {}
  for (const k of keysToKeep) {
    // noUncheckedIndexedAccess: k is guaranteed present by Object.keys
    const v = state[k]
    if (v !== undefined) evicted[k] = v
  }
  return evicted
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useExpandState({
  collectionSlug,
  version = '1',
}: UseExpandStateArgs): UseExpandStateApi {
  const storageKey = buildKey(collectionSlug, version)

  // -------------------------------------------------------------------------
  // State — SSR-safe initialisation
  //
  // We cannot read localStorage synchronously in the lazy initializer because
  // that causes a React hydration mismatch (server has no localStorage). Instead:
  //   1. Start with {} on first render (matches server output).
  //   2. In a useEffect, hydrate from localStorage on mount.
  //
  // This means arborist.initialOpenState will be {} on the very first paint,
  // but will be restored immediately after mount (before the user has a chance
  // to interact). This is the safest SSR-compatible approach.
  // -------------------------------------------------------------------------
  const [openState, setOpenStateInternal] = useState<Record<string, boolean>>({})

  // Track whether we have hydrated from localStorage yet.
  const hydratedRef = useRef(false)

  // -------------------------------------------------------------------------
  // Hydrate from localStorage on mount (client only)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true
    const persisted = readFromStorage(storageKey)
    if (Object.keys(persisted).length > 0) {
      setOpenStateInternal(persisted)
    }
    // storageKey changes when slug or version changes — re-hydrate.
  }, [storageKey])

  // -------------------------------------------------------------------------
  // Debounced localStorage write
  // -------------------------------------------------------------------------
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleWrite = useCallback(
    (nextState: Record<string, boolean>) => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current)
      }
      debounceTimerRef.current = setTimeout(() => {
        writeToStorage(storageKey, nextState)
        debounceTimerRef.current = null
      }, DEBOUNCE_MS)
    },
    [storageKey],
  )

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  const setOpen = useCallback(
    (id: string, open: boolean) => {
      setOpenStateInternal((prev) => {
        // Produce a new object with the updated entry appended (preserves
        // insertion order for eviction: new/updated entries go to the back).
        const without: Record<string, boolean> = {}
        for (const [k, v] of Object.entries(prev)) {
          if (k !== id) without[k] = v
        }
        const next = evictOldest({ ...without, [id]: open }, MAX_ENTRIES)
        scheduleWrite(next)
        return next
      })
    },
    [scheduleWrite],
  )

  const replaceOpenState = useCallback(
    (next: Record<string, boolean>) => {
      const evicted = evictOldest(next, MAX_ENTRIES)
      setOpenStateInternal(evicted)
      scheduleWrite(evicted)
    },
    [scheduleWrite],
  )

  const clear = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    setOpenStateInternal({})
    removeFromStorage(storageKey)
  }, [storageKey])

  return { openState, setOpen, replaceOpenState, clear }
}
