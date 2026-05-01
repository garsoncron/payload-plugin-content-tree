'use client'

/**
 * @description
 * Right-click context menu for the content tree. Renders as a fixed-position
 * floating overlay mounted via React portal into document.body so it's never
 * clipped by container overflow.
 *
 * Key features:
 * - Portal-based rendering (createPortal → document.body)
 * - Viewport clamping so the menu never overflows off-screen
 * - Insert submenu driven by getAllowedInserts (Sitecore-style insert options)
 * - Close on: click outside, Escape key, window scroll, window resize
 * - Full keyboard navigation: Up/Down to move, Right to open submenu, Enter to
 *   activate, Escape to close
 * - role="menu" + role="menuitem" + tabIndex/focus management for a11y
 * - data-testid + data-action attributes for test assertions
 *
 * Out of scope (per issue #19):
 * - canPerformAction gating — that's #22. All items render unconditionally.
 * - Actual action implementations — that's #20.
 *
 * @dependencies
 * - react-dom: createPortal
 * - getAllowedInserts: resolves allowed child contentTypes for the Insert submenu
 * - ContextMenuAction: shared type for action dispatch
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { ContextMenuAction, TreeNode } from '../shared/types'
import { getAllowedInserts } from './helpers/getAllowedInserts'

// ─── Menu geometry constants ──────────────────────────────────────────────────

/** Width of the context menu panel in pixels. */
const MENU_WIDTH = 200
/** Approximate height per menu item (used for vertical clamping heuristic). */
const ITEM_HEIGHT = 36
/** Width of the insert submenu panel. */
const SUBMENU_WIDTH = 180
/** Minimum distance the menu should keep from viewport edges. */
const EDGE_MARGIN = 8

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  /** null = closed; non-null = open at this screen position */
  open: { x: number; y: number; node: TreeNode } | null
  onClose: () => void
  onAction: (action: ContextMenuAction, payload?: { contentType?: string }) => void
  insertOptions: Record<string, string[]>
  contentTypeLabels?: Record<string, string>
  // canPerformAction is OUT OF SCOPE for this issue — #22 wires gating.
}

// ─── Clamp helper ─────────────────────────────────────────────────────────────

/**
 * Clamp the menu position to remain within the viewport.
 *
 * @param x - Requested left edge
 * @param y - Requested top edge
 * @param menuHeight - Approximate height of the menu
 * @returns Adjusted { left, top } values
 */
function clampToViewport(x: number, y: number, menuHeight: number): { left: number; top: number } {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768

  const left = Math.max(EDGE_MARGIN, Math.min(x, vw - MENU_WIDTH - EDGE_MARGIN))
  const top = Math.max(EDGE_MARGIN, Math.min(y, vh - menuHeight - EDGE_MARGIN))

  return { left, top }
}

// ─── TreeContextMenu ──────────────────────────────────────────────────────────

export function TreeContextMenu({
  open,
  onClose,
  onAction,
  insertOptions,
  contentTypeLabels,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [isSubmenuOpen, setIsSubmenuOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [focusedSubmenuIndex, setFocusedSubmenuIndex] = useState(0)

  // ── Derived data ──────────────────────────────────────────────────────────

  // Resolve allowed inserts for the current node
  const allowedInserts = open
    ? getAllowedInserts(open.node.contentType, insertOptions, contentTypeLabels)
    : []
  const hasInserts = allowedInserts.length > 0

  // Build the ordered list of top-level menu items.
  // Insert only appears when there are allowed child types.
  type MenuItem = { action: ContextMenuAction; label: string; isDestructive?: boolean }
  const menuItems: MenuItem[] = [
    ...(hasInserts ? [{ action: 'insert' as ContextMenuAction, label: 'Insert' }] : []),
    { action: 'duplicate', label: 'Duplicate' },
    { action: 'rename', label: 'Rename' },
    { action: 'delete', label: 'Delete', isDestructive: true },
  ]

  // ── Position calculation ──────────────────────────────────────────────────

  const menuHeight = menuItems.length * ITEM_HEIGHT + EDGE_MARGIN * 2
  const position = open ? clampToViewport(open.x, open.y, menuHeight) : { left: 0, top: 0 }

  // ── Submenu position ──────────────────────────────────────────────────────

  // Determine whether to open the submenu to the left or right of the menu
  const submenuLeft =
    typeof window !== 'undefined' && position.left + MENU_WIDTH + SUBMENU_WIDTH > window.innerWidth
      ? position.left - SUBMENU_WIDTH
      : position.left + MENU_WIDTH

  // ── Close on outside click, Escape, scroll, resize ───────────────────────

  const handleItemAction = useCallback(
    (action: ContextMenuAction, extra?: { contentType?: string }) => {
      onAction(action, extra)
      onClose()
    },
    [onAction, onClose],
  )

  useEffect(() => {
    if (!open) return

    // Reset focus + submenu on re-open
    setFocusedIndex(0)
    setFocusedSubmenuIndex(0)
    setIsSubmenuOpen(false)

    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isSubmenuOpen) {
          setIsSubmenuOpen(false)
        } else {
          onClose()
        }
        e.preventDefault()
        return
      }

      if (isSubmenuOpen) {
        // Navigate submenu
        if (e.key === 'ArrowDown') {
          setFocusedSubmenuIndex((i) => (i + 1) % allowedInserts.length)
          e.preventDefault()
        } else if (e.key === 'ArrowUp') {
          setFocusedSubmenuIndex((i) => (i - 1 + allowedInserts.length) % allowedInserts.length)
          e.preventDefault()
        } else if (e.key === 'Enter') {
          const item = allowedInserts[focusedSubmenuIndex]
          if (item) handleItemAction('insert', { contentType: item.value })
          e.preventDefault()
        } else if (e.key === 'ArrowLeft') {
          setIsSubmenuOpen(false)
          e.preventDefault()
        }
      } else {
        // Navigate main menu
        if (e.key === 'ArrowDown') {
          setFocusedIndex((i) => (i + 1) % menuItems.length)
          e.preventDefault()
        } else if (e.key === 'ArrowUp') {
          setFocusedIndex((i) => (i - 1 + menuItems.length) % menuItems.length)
          e.preventDefault()
        } else if (e.key === 'Enter') {
          const item = menuItems[focusedIndex]
          if (item) {
            if (item.action === 'insert') {
              setIsSubmenuOpen(true)
              setFocusedSubmenuIndex(0)
            } else {
              handleItemAction(item.action)
            }
          }
          e.preventDefault()
        } else if (e.key === 'ArrowRight') {
          const item = menuItems[focusedIndex]
          if (item?.action === 'insert') {
            setIsSubmenuOpen(true)
            setFocusedSubmenuIndex(0)
          }
          e.preventDefault()
        }
      }
    }

    const handleScrollOrResize = () => onClose()

    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleScrollOrResize, { capture: true })
    window.addEventListener('resize', handleScrollOrResize)

    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', handleScrollOrResize, { capture: true })
      window.removeEventListener('resize', handleScrollOrResize)
    }
  }, [
    open,
    isSubmenuOpen,
    focusedIndex,
    focusedSubmenuIndex,
    allowedInserts,
    menuItems,
    onClose,
    handleItemAction,
  ])

  // ── Focus management ──────────────────────────────────────────────────────

  // Move DOM focus to the focused item whenever focusedIndex changes
  useEffect(() => {
    if (!open || !menuRef.current) return
    const items = menuRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]')
    const target = items[focusedIndex]
    if (target) target.focus()
  }, [open, focusedIndex])

  // ── Render ────────────────────────────────────────────────────────────────

  if (!open) return null

  const menu = (
    <div
      ref={menuRef}
      className="ct-context-menu"
      data-testid="tree-context-menu"
      role="menu"
      aria-label="Node actions"
      style={{ left: position.left, top: position.top, width: MENU_WIDTH }}
    >
      {menuItems.map((item, index) => {
        const isInsert = item.action === 'insert'
        const isFocused = focusedIndex === index

        return (
          <div
            key={item.action}
            className={[
              'ct-context-menu__item',
              item.isDestructive ? 'ct-context-menu__item--destructive' : '',
              isFocused ? 'ct-context-menu__item--focused' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            data-testid="ctx-menu-item"
            data-action={item.action}
            role="menuitem"
            tabIndex={-1}
            aria-haspopup={isInsert ? 'menu' : undefined}
            aria-expanded={isInsert ? isSubmenuOpen : undefined}
            onMouseEnter={() => {
              setFocusedIndex(index)
              if (isInsert) {
                setIsSubmenuOpen(true)
                setFocusedSubmenuIndex(0)
              } else {
                setIsSubmenuOpen(false)
              }
            }}
            onClick={(e) => {
              e.stopPropagation()
              if (isInsert) {
                setIsSubmenuOpen((prev) => !prev)
              } else {
                handleItemAction(item.action)
              }
            }}
          >
            <span className="ct-context-menu__item-label">{item.label}</span>
            {isInsert && (
              <span className="ct-context-menu__item-arrow" aria-hidden="true">
                ▸
              </span>
            )}
          </div>
        )
      })}

      {/* Insert submenu — portalled as a sibling of the main menu */}
      {isSubmenuOpen && hasInserts && (
        <div
          className="ct-context-menu ct-context-menu--submenu"
          data-testid="ctx-menu-insert-submenu"
          role="menu"
          aria-label="Insert content type"
          style={{
            left: submenuLeft,
            top: position.top,
            width: SUBMENU_WIDTH,
            position: 'fixed',
          }}
        >
          {allowedInserts.map((opt, index) => (
            <div
              key={opt.value}
              className={[
                'ct-context-menu__item',
                focusedSubmenuIndex === index ? 'ct-context-menu__item--focused' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-testid="ctx-menu-insert-item"
              data-content-type={opt.value}
              role="menuitem"
              tabIndex={-1}
              onMouseEnter={() => setFocusedSubmenuIndex(index)}
              onClick={(e) => {
                e.stopPropagation()
                handleItemAction('insert', { contentType: opt.value })
              }}
            >
              <span className="ct-context-menu__item-label">{opt.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  // Use a portal so the menu renders into document.body, bypassing any
  // ancestor overflow:hidden or z-index stacking contexts.
  return typeof document !== 'undefined' ? createPortal(menu, document.body) : null
}
