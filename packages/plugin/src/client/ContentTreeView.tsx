'use client'

/**
 * @description
 * The registered admin view component. Wraps the arborist tree, a TanStack
 * Query provider, search input, and placeholder slots for the right-rail
 * iframe and context menu (Phase 3 / Phase 4).
 *
 * Key features:
 * - QueryClientProvider at the boundary so child hooks can use useQuery
 * - useQuery fetches GET /api/tree-{collectionSlug} for the full tree
 * - useQuery for search: GET /api/tree-{slug}/search?q=<term> (Phase 3, #16)
 *   · Fires only when debouncedQuery.length >= 2
 *   · Debounced 250ms inline (no external dep)
 *   · Results expand ancestors via useExpandState.replaceOpenState merge
 *   · Matching ids highlighted via highlightIds Set passed to TreeArborist
 * - useExpandState wired for localStorage-persisted expand state (#13 / #16)
 * - Selected node tracked in useState; passed to TreeArborist.onSelect
 * - Existing data-testid="page-content-tree" wrapper preserved for smoke test
 *
 * Data flow:
 *   ContentTreeView (QueryClientProvider boundary)
 *     └── ContentTreeInner
 *           ├── useExpandState → localStorage expand state
 *           ├── useQuery → GET /api/tree-{collectionSlug} (full tree)
 *           ├── useQuery → GET /api/tree-{slug}/search?q=... (search, #16)
 *           └── TreeArborist (renders react-arborist Tree)
 *
 * Search endpoint contract (implemented by #15 agent):
 *   GET /api/tree-{collectionSlug}/search?q=<string>
 *   → 200: { results: TreeNode[]; expandIds: (string | number)[]; total: number }
 *   → 400: { error: 'query too long' }  // q > 200 chars
 *   → 500: { error: string }
 *   Empty / <2-char query → { results: [], expandIds: [], total: 0 }
 *
 * @dependencies
 * - @tanstack/react-query: QueryClient, QueryClientProvider, useQuery
 * - TreeArborist: arborist wrapper (this package)
 * - useExpandState: localStorage expand state hook (this package)
 * - TreeNode, ContentTreePluginOptions: shared/types
 * - styles.css: plugin-scoped CSS custom properties + row styles
 *
 * @notes
 * - The endpoint is registered at Payload root (`/api/tree-{slug}`) not under
 *   /admin, so the fetch path works regardless of Next.js basePath.
 * - Function-shaped options (editUrlBuilder, canPerformAction) are NOT passed
 *   via clientProps because they cannot survive the RSC serialization boundary.
 *   Phase 3 will handle editUrlBuilder via the EditIframePane's default logic.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import type { ContentTreePluginOptions, TreeNode } from '../shared/types'
import { TreeArborist } from './TreeArborist'
import { useExpandState } from './hooks/useExpandState'
import './styles.css'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ViewProps {
  collectionSlug: string
  adminPath: string
  fields: NonNullable<ContentTreePluginOptions['fields']>
  insertOptions: Record<string, string[]>
  contentTypeLabels: Record<string, string>
  maxDepth: number
  features: { dragAndDrop: boolean; contextMenu: boolean; deepSearch: boolean }
  editUrlBuilder?: (node: TreeNode) => string
  canPerformAction?: ContentTreePluginOptions['canPerformAction']
}

/** Shape returned by GET /api/tree-{slug} */
interface TreeApiResponse {
  nodes: TreeNode[]
  total: number
}

/** Shape returned by GET /api/tree-{slug}/search?q=... */
interface SearchApiResponse {
  results: TreeNode[]
  expandIds: (string | number)[]
  total: number
  /** Present on 400/500 error responses */
  error?: string
}

// ─── QueryClient singleton ────────────────────────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false },
  },
})

// ─── Public entry ─────────────────────────────────────────────────────────────

export function ContentTreeView(props: ViewProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <ContentTreeInner {...props} />
    </QueryClientProvider>
  )
}

// ─── Inner (uses hooks) ───────────────────────────────────────────────────────

function ContentTreeInner({ collectionSlug }: ViewProps) {
  // ── Selection state ──────────────────────────────────────────────────────
  const [selected, setSelected] = useState<TreeNode | null>(null)

  // ── Expand state (localStorage-persisted, #13 follow-up) ────────────────
  const expand = useExpandState({ collectionSlug })

  // onToggle: called from TreeArborist row renderer with the NEW open state.
  // We pass a stable callback reference so the memoised BoundNodeRow in
  // TreeArborist doesn't recreate unnecessarily.
  const handleToggle = useCallback(
    (id: string, open: boolean) => {
      expand.setOpen(id, open)
    },
    // expand.setOpen is stable (useCallback inside useExpandState)
    [expand.setOpen],
  )

  // onAutoExpand: merges expand ids from search results into open state.
  // Does not collapse existing open nodes — additive merge only.
  const handleAutoExpand = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return
      expand.replaceOpenState({
        ...expand.openState,
        ...Object.fromEntries(ids.map((id) => [id, true])),
      })
    },
    // Re-create only when the openState reference changes (replaceOpenState is stable).
    [expand.openState, expand.replaceOpenState],
  )

  // ── Search state (#16) ────────────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  // Inline 250ms debounce: cancel previous timer on each query change.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query)
    }, 250)
    return () => {
      clearTimeout(timer)
    }
  }, [query])

  // Highlight set: populated from search results, cleared when search is empty.
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set())

  // ── Tree query (main) ────────────────────────────────────────────────────
  const { data, isLoading, isError, error } = useQuery<TreeApiResponse>({
    queryKey: ['tree', collectionSlug],
    queryFn: () =>
      fetch(`/api/tree-${collectionSlug}`).then((res) => {
        if (!res.ok) throw new Error(`Tree fetch failed: ${res.status} ${res.statusText}`)
        return res.json() as Promise<TreeApiResponse>
      }),
  })

  // ── Search query (#16) ───────────────────────────────────────────────────
  const isSearchActive = debouncedQuery.trim().length >= 2
  const {
    data: searchData,
    isLoading: searchLoading,
    isError: searchIsError,
    error: searchError,
  } = useQuery<SearchApiResponse>({
    queryKey: ['tree-search', collectionSlug, debouncedQuery],
    queryFn: () =>
      fetch(`/api/tree-${collectionSlug}/search?q=${encodeURIComponent(debouncedQuery)}`).then(
        (res) => res.json() as Promise<SearchApiResponse>,
      ),
    enabled: isSearchActive,
  })

  // When search results arrive, auto-expand ancestor chain and update highlights.
  useEffect(() => {
    if (!isSearchActive) {
      // Clear highlights when query is too short; do NOT collapse the tree.
      setHighlightIds(new Set())
      return
    }
    if (searchData == null) return

    // Coerce expandIds to string[]
    const expandIdsAsStrings = searchData.expandIds.map((id) => String(id))
    handleAutoExpand(expandIdsAsStrings)

    // Build highlight set from search result ids
    const resultIds = new Set(searchData.results.map((n) => String(n.id)))
    setHighlightIds(resultIds)
  }, [searchData, isSearchActive, handleAutoExpand])

  // ── Error messages ───────────────────────────────────────────────────────
  const treeErrorMessage =
    error instanceof Error ? error.message : 'An unexpected error occurred loading the tree.'

  /**
   * Derive a friendly search error message.
   * The search endpoint returns { error: 'query too long' } on 400.
   * We surface a friendlier copy for that specific case.
   */
  const searchErrorMessage = (() => {
    if (!searchIsError) return null
    // TanStack Query wraps fetch errors; check searchData.error for API-level
    // error strings (400 / 500 bodies).
    if (
      searchError instanceof Error &&
      (searchError.message.includes('query too long') || searchError.message.includes('400'))
    ) {
      return 'Try a shorter search.'
    }
    // Also check if we got a JSON error body (searchData typed for success path;
    // cast to check error field on error responses)
    const maybeErrorBody = searchData as SearchApiResponse | undefined
    if (maybeErrorBody?.error === 'query too long') return 'Try a shorter search.'
    return searchError instanceof Error ? searchError.message : 'Search failed. Please try again.'
  })()

  const showSearchEmpty =
    isSearchActive &&
    !searchLoading &&
    !searchIsError &&
    searchData != null &&
    searchData.results.length === 0

  // ── Friendly error message with fallback ─────────────────────────────────
  return (
    <div data-testid="page-content-tree" className="ct-view">
      {/* ── Search toolbar (#16) ── */}
      <div className="ct-toolbar">
        <input
          type="search"
          placeholder="Search..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="content-tree-search"
          aria-label="Search content tree"
        />
        {/* Inline search status — small, below the input, non-intrusive */}
        {isSearchActive && searchLoading && (
          <span data-testid="search-loading" className="ct-search-status">
            Searching…
          </span>
        )}
        {isSearchActive && searchIsError && (
          <span data-testid="search-error" className="ct-search-status ct-search-status--error">
            {searchErrorMessage}
          </span>
        )}
        {showSearchEmpty && (
          <span data-testid="search-empty" className="ct-search-status ct-search-status--muted">
            No results.
          </span>
        )}
      </div>

      {/* ── Tree loading / error / empty / success ── */}
      {isLoading && (
        <div data-testid="tree-loading" className="ct-status">
          Loading…
        </div>
      )}

      {isError && (
        <div data-testid="tree-error" className="ct-status ct-status--error">
          {treeErrorMessage}
        </div>
      )}

      {!isLoading && !isError && data && data.nodes.length === 0 && (
        <div data-testid="tree-empty" className="ct-status">
          No items yet.
        </div>
      )}

      {!isLoading && !isError && data && data.nodes.length > 0 && (
        <TreeArborist
          data={data.nodes}
          initialOpenState={expand.openState}
          onToggle={handleToggle}
          highlightIds={highlightIds}
          onSelect={(node) => {
            setSelected(node)
            // TODO(Phase 3): open EditIframePane with the selected node
            void selected
          }}
        />
      )}
    </div>
  )
}
