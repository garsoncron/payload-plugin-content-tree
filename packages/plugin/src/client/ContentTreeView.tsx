'use client'

/**
 * The registered admin view. Wraps the arborist tree, the right-rail
 * iframe, and the context menu in a TanStack Query provider.
 *
 * Receives a serializable subset of plugin options as `clientProps` from
 * Payload. Function-shaped options (editUrlBuilder, canPerformAction)
 * are passed by consumers wrapping this component in their own admin
 * file — they don't survive the clientProps boundary.
 *
 * TODO(v0.1): port from FRAS spike Section 3.12. arborist <Tree>
 * + onMove + context menu wiring.
 */

import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ContentTreePluginOptions, TreeNode } from '../shared/types'

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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false },
  },
})

export function ContentTreeView(props: ViewProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <ContentTreeInner {...props} />
    </QueryClientProvider>
  )
}

function ContentTreeInner(_props: ViewProps) {
  // TODO(v0.1): arborist <Tree> + iframe pane + context menu.
  return (
    <div data-testid="page-content-tree" style={{ padding: 24 }}>
      content-tree v0.1 — view scaffold (NOT_IMPLEMENTED)
    </div>
  )
}
