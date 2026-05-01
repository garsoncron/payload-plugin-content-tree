'use client'

/**
 * The registered admin view component. Wraps the arborist tree, a
 * TanStack Query provider, the search input, and the right-rail iframe
 * pane (EditIframePane) in a horizontal split layout.
 *
 * Layout:
 *   [data-testid="page-content-tree"]  .ct-view
 *     ├── .ct-toolbar                  (search input + status, #16)
 *     └── .ct-layout                   (flex row, #17)
 *           ├── [data-testid="tree-pane"]  .ct-pane--tree
 *           │     └── TreeArborist
 *           └── [data-testid="edit-pane"]  .ct-pane--edit
 *                 └── EditIframePane
 *
 * Search endpoint contract (#15):
 *   GET /api/tree-{collectionSlug}/search?q=<string>
 *   → 200: { results: TreeNode[]; expandIds: (string|number)[]; total: number }
 *   → 400: { error: 'query too long' }
 *   → 500: { error: string }
 *
 * editUrl resolution (in priority order):
 *   1. props.editUrlBuilder(node) — consumer-supplied (Puck, etc.)
 *   2. /admin/collections/{collectionSlug}/{node.id} — Payload 3 default
 *   3. null — when no node is selected
 */

import React, { useState, useEffect, useCallback } from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import type { ContentTreePluginOptions, TreeNode } from '../shared/types'
import { TreeArborist } from './TreeArborist'
import { EditIframePane } from './EditIframePane'
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
  /**
   * Optional consumer-supplied URL builder. Cannot survive the RSC clientProps
   * boundary; consumers wanting a custom builder wrap ContentTreeView in their
   * own 'use client' shim.
   */
  editUrlBuilder?: (node: TreeNode) => string
  canPerformAction?: ContentTreePluginOptions['canPerformAction']
}

interface TreeApiResponse {
  nodes: TreeNode[]
  total: number
}

interface SearchApiResponse {
  results: TreeNode[]
  expandIds: (string | number)[]
  total: number
  /** Present on 400/500 error responses. */
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

function ContentTreeInner({ collectionSlug, editUrlBuilder }: ViewProps) {
  // ── Selection state ──────────────────────────────────────────────────────
  const [selected, setSelected] = useState<TreeNode | null>(null)

  // ── Expand state (localStorage-persisted, #13) ───────────────────────────
  const expand = useExpandState({ collectionSlug })

  const handleToggle = useCallback(
    (id: string, open: boolean) => {
      expand.setOpen(id, open)
    },
    [expand.setOpen],
  )

  const handleAutoExpand = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return
      expand.replaceOpenState({
        ...expand.openState,
        ...Object.fromEntries(ids.map((id) => [id, true])),
      })
    },
    [expand.openState, expand.replaceOpenState],
  )

  // ── Search state (#16) ───────────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250)
    return () => clearTimeout(timer)
  }, [query])

  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set())

  // ── Tree query ───────────────────────────────────────────────────────────
  const { data, isLoading, isError, error } = useQuery<TreeApiResponse>({
    queryKey: ['tree', collectionSlug],
    queryFn: () =>
      fetch(`/api/tree-${collectionSlug}`).then((res) => {
        if (!res.ok) throw new Error(`Tree fetch failed: ${res.status} ${res.statusText}`)
        return res.json() as Promise<TreeApiResponse>
      }),
  })

  // ── Search query ─────────────────────────────────────────────────────────
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

  useEffect(() => {
    if (!isSearchActive) {
      setHighlightIds(new Set())
      return
    }
    if (searchData == null) return
    const expandIdsAsStrings = searchData.expandIds.map((id) => String(id))
    handleAutoExpand(expandIdsAsStrings)
    setHighlightIds(new Set(searchData.results.map((n) => String(n.id))))
  }, [searchData, isSearchActive, handleAutoExpand])

  // ── Error messages ───────────────────────────────────────────────────────
  const treeErrorMessage =
    error instanceof Error ? error.message : 'An unexpected error occurred loading the tree.'

  const searchErrorMessage = (() => {
    if (!searchIsError) return null
    if (
      searchError instanceof Error &&
      (searchError.message.includes('query too long') || searchError.message.includes('400'))
    ) {
      return 'Try a shorter search.'
    }
    const maybeBody = searchData as SearchApiResponse | undefined
    if (maybeBody?.error === 'query too long') return 'Try a shorter search.'
    return searchError instanceof Error ? searchError.message : 'Search failed. Please try again.'
  })()

  const showSearchEmpty =
    isSearchActive &&
    !searchLoading &&
    !searchIsError &&
    searchData != null &&
    searchData.results.length === 0

  // ── editUrl resolution ───────────────────────────────────────────────────
  const editUrl: string | null =
    selected === null
      ? null
      : editUrlBuilder
        ? editUrlBuilder(selected)
        : `/admin/collections/${collectionSlug}/${String(selected.id)}`

  return (
    <div data-testid="page-content-tree" className="ct-view">
      <div className="ct-toolbar">
        <input
          type="search"
          placeholder="Search..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="content-tree-search"
          aria-label="Search content tree"
        />
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

      <div className="ct-layout">
        <div data-testid="tree-pane" className="ct-pane--tree">
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
              onSelect={setSelected}
            />
          )}
        </div>

        <div data-testid="edit-pane" className="ct-pane--edit">
          <EditIframePane node={selected} editUrl={editUrl} />
        </div>
      </div>
    </div>
  )
}
