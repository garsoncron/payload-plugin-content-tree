'use client'

/**
 * @description
 * The registered admin view component. Wraps the arborist tree, a TanStack
 * Query provider, and placeholder slots for the right-rail iframe and context
 * menu (Phase 3 / Phase 4).
 *
 * Key features:
 * - QueryClientProvider at the boundary so child hooks can use useQuery
 * - useQuery fetches GET /api/tree-{collectionSlug} and handles
 *   loading / error / empty / success states each with their own testid
 * - Selected node tracked in useState; passed to TreeArborist.onSelect
 * - Existing data-testid="page-content-tree" wrapper preserved for smoke test
 *
 * Data flow:
 *   ContentTreeView (QueryClientProvider boundary)
 *     └── ContentTreeInner
 *           ├── useQuery → GET /api/tree-{collectionSlug}
 *           └── TreeArborist (renders react-arborist Tree)
 *
 * @dependencies
 * - @tanstack/react-query: QueryClient, QueryClientProvider, useQuery
 * - TreeArborist: arborist wrapper (this package)
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

import React, { useState } from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import type { ContentTreePluginOptions, TreeNode } from '../shared/types'
import { TreeArborist } from './TreeArborist'
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
  const [selected, setSelected] = useState<TreeNode | null>(null)

  const { data, isLoading, isError, error } = useQuery<TreeApiResponse>({
    queryKey: ['tree', collectionSlug],
    queryFn: () =>
      fetch(`/api/tree-${collectionSlug}`).then((res) => {
        if (!res.ok) throw new Error(`Tree fetch failed: ${res.status} ${res.statusText}`)
        return res.json() as Promise<TreeApiResponse>
      }),
  })

  // Friendly error message with fallback
  const errorMessage =
    error instanceof Error ? error.message : 'An unexpected error occurred loading the tree.'

  return (
    <div data-testid="page-content-tree" className="ct-view">
      {isLoading && (
        <div data-testid="tree-loading" className="ct-status">
          Loading…
        </div>
      )}

      {isError && (
        <div data-testid="tree-error" className="ct-status ct-status--error">
          {errorMessage}
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
