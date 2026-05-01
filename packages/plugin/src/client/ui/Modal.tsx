'use client'

/**
 * @description
 * Lightweight portal-based modal primitive for the content-tree admin view.
 *
 * Key features:
 * - Renders via createPortal into document.body so it is never clipped by
 *   ancestor overflow:hidden or z-index stacking contexts.
 * - Backdrop click closes the modal (calls onClose).
 * - Escape key closes the modal.
 * - Focus management: focuses the first focusable element in the body on open;
 *   restores focus to the previously-focused element on close.
 * - Accessible: role="dialog", aria-modal, aria-labelledby.
 *
 * @dependencies
 * - react-dom: createPortal
 *
 * @notes
 * - The focus trap is intentionally minimal — just "focus first focusable child
 *   on open, restore prior focus on close." Full tab-cycle trapping is deferred
 *   to a future a11y pass (#22 / #29).
 * - CSS classes follow the ct-* plugin prefix convention.
 * - Inline styles (fixed positioning, z-index) are used for the overlay and
 *   panel so consumers cannot accidentally break them with a reset.
 */

import React, { useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

// ─── Props ─────────────────────────────────────────────────────────────────────

export interface ModalProps {
  /** Whether the modal is visible. When false, renders null (no DOM node). */
  open: boolean
  /** Modal header title text. */
  title: string
  /** Called when the user dismisses the modal (backdrop click, Esc, Cancel). */
  onClose: () => void
  /** Label for the submit button. Default: 'Save'. */
  submitLabel?: string
  /** Body content — typically a form or a single labelled input. */
  children: React.ReactNode
  /** Called when the user clicks the submit button. */
  onSubmit: () => void
  /**
   * When true, the submit button is disabled.
   * Use for in-flight requests or validation failures.
   */
  submitDisabled?: boolean
}

// ─── Unique ID for aria-labelledby ───────────────────────────────────────────

let _modalIdCounter = 0
function nextModalId() {
  return `ct-modal-title-${(_modalIdCounter += 1)}`
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export function Modal({
  open,
  title,
  onClose,
  submitLabel = 'Save',
  children,
  onSubmit,
  submitDisabled = false,
}: ModalProps) {
  // Stable ID for aria-labelledby (created once per mount)
  const titleId = useRef(nextModalId())

  // Ref to the modal panel so we can find focusable children
  const panelRef = useRef<HTMLDivElement>(null)

  // Track which element had focus before the modal opened so we can restore it
  const priorFocusRef = useRef<Element | null>(null)

  // ── Focus management ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return

    // Store the previously-focused element so we can restore it on close
    priorFocusRef.current = document.activeElement

    // Focus the first focusable child inside the panel
    const panel = panelRef.current
    if (panel) {
      const focusable = panel.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (focusable) {
        // Defer by one frame so the portal is fully mounted
        requestAnimationFrame(() => focusable.focus())
      }
    }

    return () => {
      // Restore focus when the modal closes
      if (priorFocusRef.current && 'focus' in priorFocusRef.current) {
        ;(priorFocusRef.current as HTMLElement).focus()
      }
    }
  }, [open])

  // ── Escape key handler ────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    },
    [onClose],
  )

  useEffect(() => {
    if (!open) return
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, handleKeyDown])

  // ── Render ────────────────────────────────────────────────────────────────

  if (!open) return null

  const modal = (
    <>
      {/* Backdrop — click-away closes */}
      <div
        className="ct-modal-backdrop"
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.4)',
          zIndex: 9998,
        }}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="ct-modal"
        data-testid="ct-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId.current}
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 9999,
          background: 'var(--theme-elevation-0, #fff)',
          border: '1px solid var(--ct-border, #e5e7eb)',
          borderRadius: '8px',
          boxShadow: '0 10px 25px -5px rgba(0,0,0,0.15), 0 4px 10px -5px rgba(0,0,0,0.1)',
          padding: '16px 20px',
          maxWidth: '420px',
          width: 'calc(100vw - 32px)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}
        >
          <h2
            id={titleId.current}
            style={{
              margin: 0,
              fontSize: '15px',
              fontWeight: 600,
              color: 'var(--ct-text, #1f2937)',
              lineHeight: 1.4,
            }}
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '18px',
              lineHeight: 1,
              color: 'var(--ct-text-muted, #6b7280)',
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="ct-modal__body">{children}</div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
          }}
        >
          <button
            type="button"
            data-testid="ct-modal-cancel"
            onClick={onClose}
            style={{
              padding: '6px 14px',
              borderRadius: '4px',
              border: '1px solid var(--ct-border, #e5e7eb)',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: '13px',
              color: 'var(--ct-text, #1f2937)',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="ct-modal-submit"
            onClick={onSubmit}
            disabled={submitDisabled}
            style={{
              padding: '6px 14px',
              borderRadius: '4px',
              border: 'none',
              background: 'var(--theme-success-500, #3b82f6)',
              color: '#fff',
              cursor: submitDisabled ? 'not-allowed' : 'pointer',
              opacity: submitDisabled ? 0.6 : 1,
              fontSize: '13px',
              fontWeight: 500,
            }}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </>
  )

  // Render into document.body via portal (SSR guard: document may not exist)
  return typeof document !== 'undefined' ? createPortal(modal, document.body) : null
}

// ─── Legacy stub exports (kept for backwards-compat, now no-ops) ──────────────
// The old file exported ModalOverlay / ModalButton stubs. Any code importing
// them won't break — but they render nothing and are intentionally deprecated.

export function ModalOverlay(_props: {
  children: React.ReactNode
  onClose: () => void
  ariaLabel: string
}) {
  return null
}

export function ModalButton(_props: {
  label: string
  variant: 'primary' | 'ghost'
  onClick: () => void
  disabled?: boolean
}) {
  return null
}
