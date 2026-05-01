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
 * Context-menu actions (#20):
 *   - Insert:    Opens a modal to name the new child; POSTs to Payload's
 *                built-in POST /api/{collectionSlug}.
 *   - Duplicate: POSTs to the plugin's custom endpoint
 *                POST /api/tree-{collectionSlug}/duplicate/{id}.
 *   - Rename:    Opens a modal with the current title pre-filled; PATCHes to
 *                Payload's built-in PATCH /api/{collectionSlug}/{id}.
 *   - Delete:    Prompts with window.confirm(); DELETEs via Payload's
 *                built-in DELETE /api/{collectionSlug}/{id}.
 *
 * All mutations invalidate the TanStack Query cache key ['tree', collectionSlug]
 * so the tree re-fetches on success. Errors are captured in lastActionError
 * state (data-testid="action-error") as a precursor to toasts (#22).
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
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ContentTreePluginOptions, ContextMenuAction, TreeNode } from '../shared/types'
import { TreeArborist } from './TreeArborist'
import { EditIframePane } from './EditIframePane'
import { TreeContextMenu } from './TreeContextMenu'
import { Modal } from './ui/Modal'
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

/**
 * State for the insert/rename modal.
 * kind: 'insert' opens with blank title; 'rename' opens pre-filled.
 */
interface ModalState {
  kind: 'insert' | 'rename'
  node: TreeNode
  /** Only present when kind === 'insert' */
  contentType?: string
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

function ContentTreeInner({
  collectionSlug,
  editUrlBuilder,
  insertOptions,
  contentTypeLabels,
  fields,
}: ViewProps) {
  // ── QueryClient (for cache invalidation) ─────────────────────────────────
  const qc = useQueryClient()

  /** Invalidate the tree cache so the tree re-fetches after a mutation. */
  const invalidateTree = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['tree', collectionSlug] })
  }, [qc, collectionSlug])

  // ── Field name resolution ────────────────────────────────────────────────
  const titleField = fields.title ?? 'title'
  const parentField = fields.parent ?? 'parent'
  const sortOrderField = fields.sortOrder ?? 'sortOrder'
  // contentType is not overridable per validateCollection spec
  const contentTypeField = 'contentType'

  // ── Selection state ──────────────────────────────────────────────────────
  const [selected, setSelected] = useState<TreeNode | null>(null)

  // ── Context menu state (#19) ─────────────────────────────────────────────
  const [menuState, setMenuState] = useState<{ x: number; y: number; node: TreeNode } | null>(null)

  // ── Modal state (#20) ────────────────────────────────────────────────────
  const [modalState, setModalState] = useState<ModalState | null>(null)
  const [modalTitle, setModalTitle] = useState('')
  const [modalInFlight, setModalInFlight] = useState(false)

  // ── Last-action error state (precursor to toasts — #22) ──────────────────
  const [lastActionError, setLastActionError] = useState<string | null>(null)

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

  // ── Context menu action handler (#20) ────────────────────────────────────

  const handleContextMenu = useCallback((e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault()
    setMenuState({ x: e.clientX, y: e.clientY, node })
  }, [])

  /**
   * Compute the next sortOrder for a new child of `parentNode`.
   * Looks at the current tree data already in memory to avoid an extra fetch.
   * Falls back to 0 if the parent has no children.
   */
  const computeChildSortOrder = useCallback(
    (parentNode: TreeNode): number => {
      if (!data?.nodes) return 0
      // Walk the tree to find the node's children
      const findNode = (nodes: TreeNode[], id: string | number): TreeNode | null => {
        for (const n of nodes) {
          if (n.id === id) return n
          if (n.children) {
            const found = findNode(n.children, id)
            if (found) return found
          }
        }
        return null
      }
      const target = findNode(data.nodes, parentNode.id)
      if (!target?.children?.length) return 0
      const max = target.children.reduce((m, c) => Math.max(m, c.sortOrder), 0)
      return max + 10
    },
    [data],
  )

  const closeModal = useCallback(() => {
    setModalState(null)
    setModalTitle('')
    setModalInFlight(false)
  }, [])

  /**
   * Submit handler for the Insert / Rename modal.
   * Dispatches to the appropriate Payload REST endpoint and invalidates the
   * tree cache on success.
   */
  const handleModalSubmit = useCallback(async () => {
    if (!modalState) return
    setModalInFlight(true)
    setLastActionError(null)

    try {
      if (modalState.kind === 'insert') {
        // POST /api/{collectionSlug} — Payload built-in create
        const sortOrder = computeChildSortOrder(modalState.node)
        const body: Record<string, unknown> = {
          [titleField]: modalTitle,
          [contentTypeField]: modalState.contentType ?? '',
          [parentField]: modalState.node.id,
          [sortOrderField]: sortOrder,
        }

        const res = await fetch(`/api/${collectionSlug}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            message?: string
            errors?: Array<{ message: string }>
          }
          const msg = body.errors?.[0]?.message ?? body.message ?? `Insert failed: ${res.status}`
          throw new Error(msg)
        }

        invalidateTree()
        closeModal()
      } else if (modalState.kind === 'rename') {
        // PATCH /api/{collectionSlug}/{id} — Payload built-in update
        const res = await fetch(`/api/${collectionSlug}/${String(modalState.node.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [titleField]: modalTitle }),
        })

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            message?: string
            errors?: Array<{ message: string }>
          }
          const msg = body.errors?.[0]?.message ?? body.message ?? `Rename failed: ${res.status}`
          throw new Error(msg)
        }

        invalidateTree()
        closeModal()
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Action failed.'
      setLastActionError(msg)
      setModalInFlight(false)
    }
  }, [
    modalState,
    modalTitle,
    titleField,
    contentTypeField,
    parentField,
    sortOrderField,
    collectionSlug,
    computeChildSortOrder,
    invalidateTree,
    closeModal,
  ])

  /**
   * Main dispatch for context-menu actions.
   *
   * - insert:    opens modal with kind='insert'
   * - duplicate: calls the plugin duplicate endpoint directly
   * - rename:    opens modal with kind='rename' pre-filled
   * - delete:    shows window.confirm(), then DELETE
   * - move:      out of scope (#24 / Phase 5)
   */
  const handleMenuAction = useCallback(
    (action: ContextMenuAction, payload?: { contentType?: string }) => {
      const node = menuState?.node
      setMenuState(null)

      if (!node) return
      setLastActionError(null)

      switch (action) {
        case 'insert': {
          setModalState({ kind: 'insert', node, contentType: payload?.contentType })
          setModalTitle('')
          break
        }

        case 'duplicate': {
          // Fire-and-forget — no modal needed
          void (async () => {
            try {
              const res = await fetch(`/api/tree-${collectionSlug}/duplicate/${String(node.id)}`, {
                method: 'POST',
              })
              if (!res.ok) {
                const body = (await res.json().catch(() => ({}))) as { error?: string }
                throw new Error(body.error ?? `Duplicate failed: ${res.status}`)
              }
              invalidateTree()
            } catch (err) {
              setLastActionError(err instanceof Error ? err.message : 'Duplicate failed.')
            }
          })()
          break
        }

        case 'rename': {
          setModalState({ kind: 'rename', node })
          setModalTitle(node.title)
          break
        }

        case 'delete': {
          // window.confirm is fine for v0.1; custom confirm modal is a future issue
          const confirmed = window.confirm(`Delete "${node.title}"? This cannot be undone.`)
          if (!confirmed) break

          void (async () => {
            try {
              const res = await fetch(`/api/${collectionSlug}/${String(node.id)}`, {
                method: 'DELETE',
              })
              if (!res.ok) {
                const body = (await res.json().catch(() => ({}))) as {
                  message?: string
                  errors?: Array<{ message: string }>
                }
                const msg =
                  body.errors?.[0]?.message ?? body.message ?? `Delete failed: ${res.status}`
                throw new Error(msg)
              }
              invalidateTree()
              // Clear selection if the deleted node was selected
              if (selected?.id === node.id) {
                setSelected(null)
              }
            } catch (err) {
              setLastActionError(err instanceof Error ? err.message : 'Delete failed.')
            }
          })()
          break
        }

        case 'move': {
          // Phase 5 (#24) — DnD wired to reorderNodes
          console.warn('[ContentTree] move action not yet implemented (Phase 5 #24)')
          break
        }
      }
    },
    [menuState, collectionSlug, invalidateTree, selected],
  )

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

      {/* Last-action error banner — replaced by toasts in #22 */}
      {lastActionError !== null && (
        <div
          data-testid="action-error"
          className="ct-status ct-status--error"
          style={{ padding: '6px 8px', fontSize: '12px', flexShrink: 0 }}
        >
          {lastActionError}
        </div>
      )}

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
              onContextMenu={handleContextMenu}
            />
          )}
        </div>

        <div data-testid="edit-pane" className="ct-pane--edit">
          <EditIframePane node={selected} editUrl={editUrl} />
        </div>
      </div>

      {/* Context menu portal — mounted outside the layout split so it isn't
          clipped by overflow:hidden on .ct-pane--tree. The component itself
          uses createPortal(…, document.body) as a second layer of safety. */}
      <TreeContextMenu
        open={menuState}
        onClose={() => setMenuState(null)}
        onAction={handleMenuAction}
        insertOptions={insertOptions}
        contentTypeLabels={contentTypeLabels}
      />

      {/* Insert / Rename modal */}
      <Modal
        open={modalState !== null}
        title={modalState?.kind === 'insert' ? 'Insert page' : 'Rename'}
        onClose={closeModal}
        submitLabel={modalState?.kind === 'insert' ? 'Insert' : 'Rename'}
        onSubmit={() => void handleModalSubmit()}
        submitDisabled={modalInFlight || modalTitle.trim().length === 0}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label
            htmlFor="ct-modal-title-input"
            style={{ fontSize: '13px', color: 'var(--ct-text-muted, #6b7280)' }}
          >
            {modalState?.kind === 'insert' ? 'Page title' : 'New title'}
          </label>
          <input
            id="ct-modal-title-input"
            type="text"
            data-testid="ct-modal-input"
            value={modalTitle}
            onChange={(e) => setModalTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !modalInFlight && modalTitle.trim().length > 0) {
                void handleModalSubmit()
              }
            }}
            placeholder="Enter title…"
            autoComplete="off"
            style={{
              padding: '6px 8px',
              border: '1px solid var(--ct-border, #e5e7eb)',
              borderRadius: '4px',
              fontSize: '14px',
              background: 'transparent',
              color: 'var(--ct-text, #1f2937)',
              outline: 'none',
            }}
          />
        </div>
      </Modal>
    </div>
  )
}
