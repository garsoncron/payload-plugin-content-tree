'use client'

/**
 * Thin wrapper around react-arborist's <Tree>. Owns: row rendering,
 * lazy-load on expand, persisted expand state, drag-handle wiring.
 *
 * TODO(v0.1): implement.
 */

import React from 'react'
import type { TreeNode } from '../shared/types'

interface Props {
  data: TreeNode[]
  onSelect: (node: TreeNode | null) => void
  onMove?: (args: { dragIds: string[]; parentId: string | null; index: number }) => void
  onContextMenu?: (e: React.MouseEvent, node: TreeNode) => void
}

export function TreeArborist(_props: Props) {
  // TODO(v0.1)
  return null
}
