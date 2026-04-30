'use client'

/**
 * Right-rail iframe pane. Renders Payload's edit view for the selected
 * node, or a placeholder when nothing is selected.
 *
 * TODO(v0.1): trivial — iframe + breadcrumb header.
 */

import React from 'react'
import type { TreeNode } from '../shared/types'

interface Props {
  node: TreeNode | null
  editUrl: string | null
}

export function EditIframePane(_props: Props) {
  // TODO(v0.1)
  return null
}
