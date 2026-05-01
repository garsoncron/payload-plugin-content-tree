// @vitest-environment happy-dom

/**
 * Unit tests for useExpandState hook.
 *
 * Covers:
 *  - Initial state (empty localStorage)
 *  - setOpen reflects in openState
 *  - setOpen persists to localStorage (via debounced write — we advance timers)
 *  - Re-mounting rehydrates persisted state
 *  - Different collectionSlugs have isolated state
 *  - Different version strings bust persisted state
 *  - Malformed localStorage value falls back to {} and warns
 *  - clear() empties memory state and removes the localStorage key
 *  - SSR safety: when window is undefined, hook returns {} and doesn't throw
 *  - Eviction: inserting 5,001 entries caps state at 5,000, oldest is gone
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useExpandState } from '../../src/client/hooks/useExpandState'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Advance all fake timers to flush the 200ms debounce. */
function flushDebounce() {
  vi.advanceTimersByTime(250)
}

/** Read localStorage entry as a parsed object (or null). */
function readStorage(key: string): Record<string, boolean> | null {
  const raw = localStorage.getItem(key)
  if (raw === null) return null
  return JSON.parse(raw) as Record<string, boolean>
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useExpandState — initial state', () => {
  it('returns {} when localStorage is empty', () => {
    const { result } = renderHook(() => useExpandState({ collectionSlug: 'pages' }))
    expect(result.current.openState).toEqual({})
  })
})

describe('useExpandState — setOpen', () => {
  it('reflects setOpen(id, true) in openState immediately', () => {
    const { result } = renderHook(() => useExpandState({ collectionSlug: 'pages' }))

    act(() => {
      result.current.setOpen('node-1', true)
    })

    expect(result.current.openState).toEqual({ 'node-1': true })
  })

  it('persists to localStorage at the correct key after debounce', () => {
    const { result } = renderHook(() => useExpandState({ collectionSlug: 'pages' }))

    act(() => {
      result.current.setOpen('node-1', true)
      flushDebounce()
    })

    const stored = readStorage('content-tree:expand:pages:v1')
    expect(stored).toEqual({ 'node-1': true })
  })

  it('does not write to localStorage before the debounce fires', () => {
    const { result } = renderHook(() => useExpandState({ collectionSlug: 'pages' }))

    act(() => {
      result.current.setOpen('node-1', true)
      // Do NOT advance timers — debounce hasn't fired yet.
    })

    // The key should not be present yet (or empty from a previous write).
    const stored = localStorage.getItem('content-tree:expand:pages:v1')
    expect(stored).toBeNull()
  })
})

describe('useExpandState — rehydration across mounts', () => {
  it('rehydrates persisted state when a second instance mounts with the same collectionSlug', () => {
    // First mount — set some state and flush debounce to persist.
    const { result: first, unmount: unmountFirst } = renderHook(() =>
      useExpandState({ collectionSlug: 'pages' }),
    )

    act(() => {
      first.current.setOpen('node-42', true)
      flushDebounce()
    })

    unmountFirst()

    // Second mount — should rehydrate from localStorage.
    const { result: second } = renderHook(() => useExpandState({ collectionSlug: 'pages' }))

    // After mount the useEffect runs synchronously in the test environment.
    act(() => {
      // no-op — just flush pending effects
    })

    expect(second.current.openState['node-42']).toBe(true)
  })
})

describe('useExpandState — isolation between slugs', () => {
  it('keeps different collectionSlugs isolated', () => {
    const { result: pages } = renderHook(() => useExpandState({ collectionSlug: 'pages' }))
    const { result: posts } = renderHook(() => useExpandState({ collectionSlug: 'posts' }))

    act(() => {
      pages.current.setOpen('shared-id', true)
      flushDebounce()
    })

    // 'posts' hook should not see 'pages' data.
    expect(posts.current.openState['shared-id']).toBeUndefined()
  })
})

describe('useExpandState — version busting', () => {
  it('returns {} for v2 when v1 has data in localStorage', () => {
    // Seed v1 data directly into localStorage.
    localStorage.setItem(
      'content-tree:expand:pages:v1',
      JSON.stringify({ 'node-1': true, 'node-2': false }),
    )

    // Mount with version '2' — must NOT see v1 data.
    const { result } = renderHook(() => useExpandState({ collectionSlug: 'pages', version: '2' }))

    act(() => {
      // Flush effects
    })

    expect(result.current.openState).toEqual({})
  })
})

describe('useExpandState — malformed localStorage', () => {
  it('falls back to {} and calls console.warn when value is malformed JSON', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    localStorage.setItem('content-tree:expand:pages:v1', '{ this is not json !!!}')

    const { result } = renderHook(() => useExpandState({ collectionSlug: 'pages' }))

    act(() => {
      // Flush effects
    })

    expect(result.current.openState).toEqual({})
    expect(warnSpy).toHaveBeenCalled()
    const warnArg: unknown = warnSpy.mock.calls[0]?.[0]
    expect(typeof warnArg === 'string' && warnArg).toContain('content-tree:expand:pages:v1')
  })
})

describe('useExpandState — clear()', () => {
  it('empties openState in memory and removes the localStorage key', () => {
    const { result } = renderHook(() => useExpandState({ collectionSlug: 'pages' }))

    act(() => {
      result.current.setOpen('node-1', true)
      flushDebounce()
    })

    // Verify it was stored.
    expect(readStorage('content-tree:expand:pages:v1')).toEqual({ 'node-1': true })

    act(() => {
      result.current.clear()
    })

    expect(result.current.openState).toEqual({})
    expect(localStorage.getItem('content-tree:expand:pages:v1')).toBeNull()
  })
})

describe('useExpandState — SSR safety', () => {
  it('returns {} without throwing when localStorage is completely unavailable', () => {
    // Simulate a storage-inaccessible environment by making localStorage.getItem throw.
    // This is the closest we can get to SSR in a happy-dom test context while keeping
    // the test runner itself functional. The hook must catch all storage errors and
    // fall back to {}.
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('localStorage is not available')
    })
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('localStorage is not available')
    })

    let hookResult: ReturnType<typeof useExpandState> | undefined

    try {
      expect(() => {
        const { result } = renderHook(() => useExpandState({ collectionSlug: 'pages' }))
        // Flush effects so the hydrateFromStorage useEffect runs.
        act(() => {})
        hookResult = result.current
      }).not.toThrow()
    } finally {
      getItemSpy.mockRestore()
      setItemSpy.mockRestore()
    }

    // Hook must return {} and not throw even when localStorage is inaccessible.
    expect(hookResult?.openState ?? {}).toEqual({})
  })
})

describe('useExpandState — eviction', () => {
  it('caps stored entries at 5,000 and evicts the oldest when 5,001 are inserted via replaceOpenState', () => {
    const { result } = renderHook(() => useExpandState({ collectionSlug: 'pages' }))

    // Build a 5,001-entry object in JS (fast — no React state update per entry).
    const bigState: Record<string, boolean> = {}
    for (let i = 0; i < 5_001; i++) {
      bigState[`node-${i}`] = true
    }

    act(() => {
      result.current.replaceOpenState(bigState)
      flushDebounce()
    })

    const state = result.current.openState
    const keys = Object.keys(state)

    // Must be capped at 5,000.
    expect(keys.length).toBe(5_000)

    // The oldest entry ('node-0') must have been evicted.
    expect(state['node-0']).toBeUndefined()

    // The newest entry ('node-5000') must still be present.
    expect(state['node-5000']).toBe(true)
  })

  it('caps stored entries at 5,000 when using setOpen sequentially', () => {
    const { result } = renderHook(() => useExpandState({ collectionSlug: 'pages' }))

    // Seed a full state first via replaceOpenState, then push one more via setOpen.
    const fullState: Record<string, boolean> = {}
    for (let i = 0; i < 5_000; i++) {
      fullState[`node-${i}`] = true
    }

    act(() => {
      result.current.replaceOpenState(fullState)
    })

    // Now add one more entry, which should evict node-0.
    act(() => {
      result.current.setOpen('node-5000', true)
      flushDebounce()
    })

    const state = result.current.openState
    expect(Object.keys(state).length).toBe(5_000)
    expect(state['node-0']).toBeUndefined()
    expect(state['node-5000']).toBe(true)
  })
})

describe('useExpandState — replaceOpenState', () => {
  it('replaces the entire openState and persists it', () => {
    const { result } = renderHook(() => useExpandState({ collectionSlug: 'pages' }))

    act(() => {
      result.current.setOpen('node-1', true)
    })

    act(() => {
      result.current.replaceOpenState({ 'node-99': true, 'node-100': false })
      flushDebounce()
    })

    expect(result.current.openState).toEqual({ 'node-99': true, 'node-100': false })

    const stored = readStorage('content-tree:expand:pages:v1')
    expect(stored).toEqual({ 'node-99': true, 'node-100': false })
  })
})
