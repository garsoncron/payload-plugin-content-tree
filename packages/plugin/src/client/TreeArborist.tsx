'use client'

/**
 * @description
 * Thin wrapper around react-arborist's <Tree> component. Owns row rendering,
 * id coercion from `string | number` to `string`, and disclosure chevrons.
 *
 * Key features:
 * - idAccessor coerces TreeNode.id (string | number) to string for arborist
 * - Row renderer with data-testid and data-node-id for test assertions
 * - Chevron disclosure indicator when node.hasChildren is true
 * - disableDrag=true — read-only for Phase 2; DnD wired in Phase 5 (#24)
 * - Fixed height of 600px with TODO for resize-observer upgrade
 *
 * Out of scope for this issue (#12):
 * - DnD (Phase 5, #24) — onMove prop accepted but unused
 * - Context menu (Phase 4, #19) — onContextMenu prop accepted but unused
 * - localStorage expand state (Phase 2 parallel, #13) — arborist default
 *   open-state used; #13 will plug in `initialOpenState` later
 *
 * @dependencies
 * - react-arborist: Tree component, NodeApi, NodeRendererProps
 * - TreeNode: from shared/types
 */

import React from 'react'
import { Tree } from 'react-arborist'
import type { NodeRendererProps } from 'react-arborist'
import type { TreeNode } from '../shared/types'

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  data: TreeNode[]
  onSelect: (node: TreeNode | null) => void
  onMove?: (args: { dragIds: string[]; parentId: string | null; index: number }) => void
  onContextMenu?: (e: React.MouseEvent, node: TreeNode) => void
}

// ─── Row renderer ─────────────────────────────────────────────────────────────

/**
 * NodeRow renders a single tree row.
 *
 * `style` from arborist positions the row absolutely via react-window
 * (top offset + height). We apply it to the outermost element.
 *
 * Chevron logic: if the underlying TreeNode has `hasChildren === true` we
 * show a disclosure indicator regardless of whether arborist has loaded
 * children yet. This matches the lazy-load pattern planned for Phase 3.
 */
function NodeRow({ style, node }: NodeRendererProps<TreeNode>) {
  const treeNode = node.data
  // Chevron direction based on arborist open/closed state
  const isOpen = node.isOpen
  const showChevron = treeNode.hasChildren

  return (
    <div
      style={style}
      className={[
        'ct-row',
        node.isSelected ? 'ct-row--selected' : '',
        node.isFocused ? 'ct-row--focused' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid="content-tree-row"
      data-node-id={String(treeNode.id)}
      onClick={node.handleClick}
    >
      {/* Indentation — arborist sets paddingLeft via style.paddingLeft from
          the indent prop on <Tree>; we add our own chevron + label */}
      <span className="ct-row__chevron" aria-hidden="true">
        {showChevron ? (isOpen ? '▾' : '▸') : null}
      </span>
      <span className="ct-row__label">{treeNode.title}</span>
    </div>
  )
}

// ─── TreeArborist ─────────────────────────────────────────────────────────────

export function TreeArborist(props: Props) {
  const { data, onSelect } = props
  // onMove and onContextMenu are accepted for forward-compat (#24, #19)
  // but not wired in this phase — disableDrag keeps the tree read-only.

  return (
    <Tree<TreeNode>
      data={data}
      // Coerce string | number id to string for arborist
      idAccessor={(node) => String(node.id)}
      // childrenAccessor: arborist looks for node.children by default;
      // TreeNode.children is already `TreeNode[] | undefined` which matches.
      childrenAccessor="children"
      // Phase 2: read-only. DnD unlocked in Phase 5 (#24).
      disableDrag={true}
      // Editing (rename inline) is Phase 4 (#19) — disable for now.
      disableEdit={true}
      // Width fills the container; height is fixed at 600px.
      // TODO(#12): upgrade to useResizeObserver so the tree fills its parent.
      width="100%"
      height={600}
      rowHeight={28}
      indent={20}
      // openByDefault: let arborist manage open state.
      // TODO(#13): wire initialOpenState from localStorage once #13 lands.
      openByDefault={false}
      // onSelect fires whenever the selection set changes (may be empty).
      onSelect={(nodes) => {
        const first = nodes[0]
        onSelect(first ? first.data : null)
      }}
    >
      {NodeRow}
    </Tree>
  )
}
