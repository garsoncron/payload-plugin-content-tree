'use client'

/**
 * @description
 * Minimal toast notification system for the content-tree admin view.
 * No external runtime dependencies — pure React state + CSS animations.
 *
 * Architecture:
 *   - ToastProvider  — holds the toast list in useState, exposes `push` via context.
 *   - useToast()     — returns the context value; must be called inside ToastProvider.
 *   - Toast[]        — internal state; each toast auto-dismisses after `duration` ms.
 *
 * Rendering:
 *   - The provider uses createPortal to mount the toast container into document.body
 *     so it is never clipped by ancestor overflow:hidden or z-index stacking contexts.
 *   - Toasts stack vertically (bottom-right) with 8px gap.
 *   - Each toast: a max-width:380px card with variant-specific colour tint, a text
 *     message, and a manual close button (×).
 *   - Animations: CSS fade-in + slide-up via a @keyframes rule injected once at
 *     module load (no stylesheet required).
 *
 * testids:
 *   - Container:    data-testid="ct-toast-container"
 *   - Each toast:   data-testid="ct-toast"  +  data-variant="<variant>"
 *   - Close button: data-testid="ct-toast-close"
 *
 * @notes
 * - If document is unavailable (SSR), createPortal falls back to null.
 * - The `push` function is stable across renders (useCallback with stable deps).
 * - Auto-dismiss timers are stored in a Map keyed by toast id so they can be
 *   cleared when the user manually closes a toast.
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ToastVariant = 'info' | 'success' | 'error'

export interface Toast {
  id: string
  variant: ToastVariant
  message: string
  /**
   * Auto-dismiss timeout in ms.
   * Default: 5000 for 'info' + 'success', 8000 for 'error'.
   */
  duration?: number
}

interface ToastContextValue {
  push: (toast: Omit<Toast, 'id'>) => void
}

// ─── Default durations ─────────────────────────────────────────────────────────

const DEFAULT_DURATION: Record<ToastVariant, number> = {
  info: 5_000,
  success: 5_000,
  error: 8_000,
}

// ─── Context ───────────────────────────────────────────────────────────────────

export const ToastContext = createContext<ToastContextValue>({
  push: () => undefined,
})

// ─── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Returns the toast context value. Must be called inside <ToastProvider>.
 */
export function useToast(): ToastContextValue {
  return useContext(ToastContext)
}

// ─── CSS injection ─────────────────────────────────────────────────────────────

/**
 * Inject toast animation keyframes into document.head once.
 * This avoids requiring the consumer to import a stylesheet.
 */
let _animationsInjected = false
function injectAnimations(): void {
  if (_animationsInjected || typeof document === 'undefined') return
  _animationsInjected = true

  const style = document.createElement('style')
  style.setAttribute('data-ct-toast-styles', 'true')
  style.textContent = `
    @keyframes ct-toast-in {
      from {
        opacity: 0;
        transform: translateY(12px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    @keyframes ct-toast-out {
      from {
        opacity: 1;
        transform: translateY(0);
      }
      to {
        opacity: 0;
        transform: translateY(12px);
      }
    }
  `
  document.head.appendChild(style)
}

// ─── ToastProvider ─────────────────────────────────────────────────────────────

/**
 * Provides the toast context and renders the fixed-position toast container.
 * Wrap your component tree (or the ContentTreeView) in this provider.
 */
export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([])

  // Map of toastId → setTimeout handle, so we can clear on manual dismiss
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Inject CSS keyframes once on mount
  useEffect(() => {
    injectAnimations()
  }, [])

  // Cleanup all timers on unmount
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((handle) => clearTimeout(handle))
      timers.clear()
    }
  }, [])

  /**
   * Add a new toast. Auto-schedules removal after `duration` ms.
   * The id is a collision-resistant string built from timestamp + random.
   */
  const push = useCallback((input: Omit<Toast, 'id'>) => {
    const id = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
    const duration = input.duration ?? DEFAULT_DURATION[input.variant]

    const toast: Toast = { ...input, id }

    setToasts((prev) => [...prev, toast])

    const handle = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
      timersRef.current.delete(id)
    }, duration)

    timersRef.current.set(id, handle)
  }, [])

  /** Remove a toast immediately (user clicked ×). */
  const dismiss = useCallback((id: string) => {
    const handle = timersRef.current.get(id)
    if (handle !== undefined) {
      clearTimeout(handle)
      timersRef.current.delete(id)
    }
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <div
            data-testid="ct-toast-container"
            className="ct-toast-container"
            aria-live="polite"
            aria-label="Notifications"
          >
            {toasts.map((toast) => (
              <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  )
}

// ─── ToastCard ─────────────────────────────────────────────────────────────────

/**
 * Renders a single toast notification card.
 *
 * Variant colours:
 *   - info:    blue tint
 *   - success: green tint
 *   - error:   red tint
 */
function ToastCard({
  toast,
  onDismiss,
}: {
  toast: Toast
  onDismiss: (id: string) => void
}): React.JSX.Element {
  return (
    <div
      data-testid="ct-toast"
      data-variant={toast.variant}
      className={`ct-toast ct-toast--${toast.variant}`}
      role="alert"
      aria-atomic="true"
    >
      <span className="ct-toast__message">{toast.message}</span>
      <button
        type="button"
        data-testid="ct-toast-close"
        className="ct-toast__close"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
      >
        ×
      </button>
    </div>
  )
}
