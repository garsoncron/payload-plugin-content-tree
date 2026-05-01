'use client'

/**
 * Right-click context menu. Items: Insert ▸ (config-driven), Open in
 * new tab, Duplicate, Rename, Delete. Move-to is via drag, not the menu.
 *
 * Shown / hidden based on `canPerformAction(action, user, node)`.
 *
 * TODO(v0.1): port from FRAS spike TreeContextMenu.tsx.
 */

import type { ContentTreePluginOptions, TreeNode } from '../shared/types'

interface Props {
  x: number
  y: number
  node: TreeNode
  insertOptions: Record<string, string[]>
  contentTypeLabels: Record<string, string>
  maxDepth: number
  collectionSlug: string
  user: { id: string | number; role?: string } | null
  canPerformAction?: ContentTreePluginOptions['canPerformAction']
  onClose: () => void
  onAction: () => void
}

export function TreeContextMenu(_props: Props) {
  // TODO(v0.1)
  return null
}
