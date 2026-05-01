'use client'

/**
 * @description
 * Right-rail iframe pane. Renders Payload's built-in edit view (or a
 * consumer-supplied URL) for the currently selected tree node.
 *
 * Key features:
 * - Empty placeholder when no node is selected or no URL is available.
 * - Breadcrumb header showing node title (+ slug when present).
 * - Bare <iframe> without forced remount — browser handles src changes
 *   naturally so any in-progress form state is preserved when the parent
 *   re-renders but the URL hasn't changed.
 *
 * @notes
 * - The sandbox attribute is intentionally OMITTED.  The iframe targets
 *   Payload's own admin (same-origin) and needs full permissions: scripts,
 *   forms, same-origin storage, popups, etc.  Adding sandbox would break
 *   the Payload admin editor.
 * - Do NOT add key={editUrl} to the <iframe>.  A key change forces a full
 *   React remount which destroys any draft / unsaved state the editor may
 *   hold.  Let the browser's natural src-change behavior handle navigation.
 */

import React from 'react'
import type { TreeNode } from '../shared/types'

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  /** The currently selected tree node, or null when nothing is selected. */
  node: TreeNode | null
  /**
   * Pre-resolved edit URL for the node.  Computed by the parent so that URL
   * strategy (default Payload route vs. consumer editUrlBuilder) stays in one
   * place.  null when node is null.
   */
  editUrl: string | null
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EditIframePane({ node, editUrl }: Props) {
  // ── Empty state: nothing selected yet ─────────────────────────────────────
  if (node === null || editUrl === null) {
    return (
      <div data-testid="edit-pane-empty" className="ct-edit-empty">
        Select a node to edit
      </div>
    )
  }

  // ── Breadcrumb label: "Title · slug" when slug is present ─────────────────
  const breadcrumbLabel = node.slug ? `${node.title} · ${node.slug}` : node.title

  return (
    <>
      {/* Small header bar identifying the currently loaded document */}
      <div data-testid="edit-pane-breadcrumb" className="ct-edit-breadcrumb">
        {breadcrumbLabel}
      </div>

      {/*
       * The iframe loads Payload's edit view for the selected document.
       *
       * sandbox is NOT set — same-origin admin needs unrestricted access
       * (scripts, forms, same-origin storage). See module-level note.
       *
       * key is NOT set — we let the browser update src rather than forcing
       * a React remount.  See module-level note.
       */}
      <iframe
        data-testid="edit-pane-iframe"
        src={editUrl}
        title={`Editing: ${node.title}`}
        className="ct-edit-iframe"
      />
    </>
  )
}
