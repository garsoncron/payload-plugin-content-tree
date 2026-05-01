'use client'

/**
 * Minimal modal primitive. Replaces native prompt() for rename actions.
 *
 * TODO(v0.1): port from FRAS Modal — overlay + content + dismissable.
 */

import type React from 'react'

export function ModalOverlay(_props: {
  children: React.ReactNode
  onClose: () => void
  ariaLabel: string
}) {
  // TODO(v0.1)
  return null
}

export function ModalButton(_props: {
  label: string
  variant: 'primary' | 'ghost'
  onClick: () => void
  disabled?: boolean
}) {
  // TODO(v0.1)
  return null
}
