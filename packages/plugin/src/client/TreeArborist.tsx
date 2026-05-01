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
 * - initialOpenState wired from useExpandState (#13 follow-up, #16)
 * - onToggle callback: we read node.isOpen from NodeRendererProps (the state
 *   BEFORE the toggle fires) so we know the direction; called as
 *   onToggle(id, !node.isOpen) from the chevron/row click. This is cleaner
 *   than using the arborist-level onToggle(id) which gives no open/closed
 *   direction, and avoids needing a TreeApi ref.
 * - highlightIds: Set<string> passed down from search results — adds
 *   ct-row--highlighted to matching rows.
 *
 * Out of scope for this issue (#16):
 * - DnD (Phase 5, #24) — onMove prop accepted but unused
 * - Context menu (Phase 4, #19) — onContextMenu prop accepted but unused
 *
 * @dependencies
 * - react-arborist: Tree component, NodeApi, NodeRendererProps
 * - TreeNode: from shared/types
 */

import React, { useEffect, useRef } from 'react'
import { Tree } from 'react-arborist'
import type { MoveHandler, NodeRendererProps, TreeApi } from 'react-arborist'
import type { TreeNode } from '../shared/types'

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  data: TreeNode[]
  onSelect: (node: TreeNode | null) => void
  onMove?: (args: { dragIds: string[]; parentId: string | null; index: number }) => void
  onContextMenu?: (e: React.MouseEvent, node: TreeNode) => void
  /**
   * Initial open/closed map from useExpandState (localStorage-persisted).
   * Passed directly to react-arborist's `initialOpenState` prop.
   */
  initialOpenState?: Record<string, boolean>
  /**
   * Called when a node is toggled open or closed.
   * id: the string id of the toggled node
   * open: the NEW open state after the toggle
   *
   * We derive `open` from the row renderer's node.isOpen (the state BEFORE the
   * toggle) and flip it: open = !node.isOpen. The row renderer's handleClick
   * drives the actual toggle in arborist; we just mirror the direction.
   */
  onToggle?: (id: string, open: boolean) => void
  /**
   * Set of node ids to highlight (from search results).
   * Rows with ids in this set get the ct-row--highlighted class.
   */
  highlightIds?: Set<string>
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
 *
 * onToggle approach: arborist's built-in onToggle(id) callback only tells us
 * WHICH node was toggled, not the NEW state. Instead, we read `node.isOpen`
 * (the CURRENT state, BEFORE the click fires) from NodeRendererProps and call
 * `onToggle(id, !node.isOpen)` in the onClick handler — BEFORE delegating to
 * `node.handleClick`, which performs the actual arborist state update. This
 * gives us the correct new open value without needing a TreeApi ref.
 */
type NodeRowProps = NodeRendererProps<TreeNode> & {
  onToggleProp?: (id: string, open: boolean) => void
  highlightIds?: Set<string>
  onContextMenuProp?: (e: React.MouseEvent, node: TreeNode) => void
}

function NodeRow({ style, node, onToggleProp, highlightIds, onContextMenuProp }: NodeRowProps) {
  const treeNode = node.data
  // Chevron direction based on arborist open/closed state
  const isOpen = node.isOpen
  const showChevron = treeNode.hasChildren
  const isHighlighted = highlightIds != null && highlightIds.has(String(treeNode.id))

  return (
    <div
      style={style}
      className={[
        'ct-row',
        node.isSelected ? 'ct-row--selected' : '',
        node.isFocused ? 'ct-row--focused' : '',
        isHighlighted ? 'ct-row--highlighted' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid="content-tree-row"
      data-node-id={String(treeNode.id)}
      onClick={(e) => {
        // Mirror the toggle direction to the parent callback BEFORE arborist
        // updates its own state. At this point node.isOpen is still the OLD
        // state, so !node.isOpen is the NEW state the user is toggling to.
        if (showChevron && onToggleProp) {
          onToggleProp(String(treeNode.id), !isOpen)
        }
        node.handleClick(e)
      }}
      onContextMenu={(e) => {
        // Prevent the native browser context menu from appearing.
        e.preventDefault()
        if (onContextMenuProp) {
          onContextMenuProp(e, treeNode)
        }
      }}
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
  const { data, onSelect, initialOpenState, onToggle, highlightIds, onContextMenu, onMove } = props

  // react-arborist's `initialOpenState` only seeds on mount and does not
  // react to subsequent prop changes. To make search-driven auto-expand
  // (and any other runtime expand-state mutation) actually move the UI, we
  // grab a TreeApi ref and diff against the last applied open map, calling
  // tree.open(id) / tree.close(id) for each changed node.
  //
  // appliedOpenRef stays null until the first effect tick so we don't
  // re-apply the initial state arborist already consumed via the prop.
  const treeRef = useRef<TreeApi<TreeNode> | null>(null)
  const appliedOpenRef = useRef<Record<string, boolean> | null>(null)

  useEffect(() => {
    const tree = treeRef.current
    if (!tree || !initialOpenState) return

    if (appliedOpenRef.current === null) {
      appliedOpenRef.current = { ...initialOpenState }
      return
    }

    const prev = appliedOpenRef.current
    for (const [id, open] of Object.entries(initialOpenState)) {
      const prevOpen = prev[id] === true
      if (open && !prevOpen) tree.open(id)
      else if (!open && prevOpen) tree.close(id)
    }
    appliedOpenRef.current = { ...initialOpenState }
  }, [initialOpenState])

  // Bind the extra props (onToggle, highlightIds) into the row renderer via a
  // stable wrapper. We cannot pass them via React context here without
  // significant indirection; instead we wrap NodeRow in a closure so arborist
  // receives a component that already has those values in scope.
  //
  // NOTE: This creates a new function reference on every render of TreeArborist.
  // react-arborist re-renders the row list on data changes anyway, so this does
  // not cause visible jank. If perf becomes a concern, wrap in useMemo.
  const BoundNodeRow = React.useCallback(
    (rowProps: NodeRendererProps<TreeNode>) => (
      <NodeRow
        {...rowProps}
        onToggleProp={onToggle}
        highlightIds={highlightIds}
        onContextMenuProp={onContextMenu}
      />
    ),
    // Re-memoize only when the callbacks / highlight set reference changes.
    [onToggle, highlightIds, onContextMenu],
  )

  /**
   * Adapt arborist's MoveHandler to the simpler Props.onMove interface.
   *
   * Single-select drag only — multi-select drag is out of scope for v0.1.
   * When multiple nodes are dragged (e.g. via keyboard multi-select), only
   * the first id is honoured. This is consistent with the server endpoint
   * which operates on a single nodeId per request.
   *
   * The arborist MoveHandler signature (react-arborist 3.5.x):
   *   { dragIds: string[], dragNodes: NodeApi[], parentId: string | null, parentNode: NodeApi | null, index: number }
   */
  const handleArboristMove: MoveHandler<TreeNode> | undefined = onMove
    ? ({ dragIds, parentId, index }) => {
        if (dragIds.length === 0) return
        // Only honour the first dragged id for single-select drag
        const firstId = dragIds[0]
        if (!firstId) return
        onMove({ dragIds: [firstId], parentId, index })
      }
    : undefined

  return (
    <Tree<TreeNode>
      ref={treeRef}
      data={data}
      // Coerce string | number id to string for arborist
      idAccessor={(node) => String(node.id)}
      // childrenAccessor: arborist looks for node.children by default;
      // TreeNode.children is already `TreeNode[] | undefined` which matches.
      childrenAccessor="children"
      // Phase 5 (#24): DnD enabled. disableDrag was true in Phase 2.
      // Editing (rename inline) is via context menu — keep disableEdit.
      disableEdit={true}
      // Wire arborist's onMove to our adapter
      onMove={handleArboristMove}
      // Width fills the container; height is fixed at 600px.
      // TODO(#12): upgrade to useResizeObserver so the tree fills its parent.
      width="100%"
      height={600}
      rowHeight={28}
      indent={20}
      // Wire localStorage-persisted expand state from useExpandState (#13).
      // On the first render this will be {} (SSR-safe); after mount it
      // hydrates from localStorage.
      initialOpenState={initialOpenState ?? {}}
      // openByDefault: false — let initialOpenState drive the open state.
      openByDefault={false}
      // onSelect fires whenever the selection set changes (may be empty).
      onSelect={(nodes) => {
        const first = nodes[0]
        onSelect(first ? first.data : null)
      }}
    >
      {BoundNodeRow}
    </Tree>
  )
}
