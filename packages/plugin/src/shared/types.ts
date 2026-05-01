/**
 * Public types for @garsoncron/payload-plugin-content-tree.
 *
 * Anything exported from this file is part of the v0.1 stable contract.
 * Internal-only types live next to their consumers, not here.
 */

export interface ContentTreePluginOptions {
  /** Slug of the collection that backs the tree. Required. */
  collectionSlug: string

  /**
   * Field-name overrides. Plugin validates that these fields exist on the
   * target collection at buildConfig time. Required fields throw if missing;
   * optional fields silently disable their UI affordance.
   */
  fields?: {
    parent?: string
    sortOrder?: string
    contentType?: string
    title?: string
    slug?: string
    workflowState?: string | false
    lockedBy?: string | false
  }

  /** Mount path for the admin view. Default `/tree`. */
  adminPath?: string

  /**
   * Map of parent contentType slug → allowed child contentType slugs.
   * Default `{}` (insert menu hidden). Pass at least `{ root: ['page'] }`
   * to enable insert.
   */
  insertOptions?: Record<string, string[]>

  /** Human-readable labels for content types. Used by the insert menu. */
  contentTypeLabels?: Record<string, string>

  /** Hard cap on tree depth. Default 5. */
  maxDepth?: number

  /**
   * Override the right-rail iframe target. Default points at Payload's
   * built-in edit view. Use this to integrate a Puck-powered builder, etc.
   */
  editUrlBuilder?: (node: TreeNode) => string

  /**
   * Authorization callback. Default: always-true. Called before showing
   * destructive actions in the context menu.
   */
  canPerformAction?: (
    action: ContextMenuAction,
    user: { id: string | number; role?: string } | null,
    node: TreeNode,
  ) => boolean

  /** Per-feature toggles. */
  features?: {
    dragAndDrop?: boolean
    contextMenu?: boolean
    deepSearch?: boolean
  }
}

export type ContextMenuAction = 'insert' | 'duplicate' | 'rename' | 'delete' | 'move'

export interface TreeNode {
  id: string | number
  title: string
  slug?: string
  contentType: string
  parent: string | number | null
  sortOrder: number
  hasChildren: boolean
  workflowState?: string
  lockedBy?: string | number | null
  children?: TreeNode[]
}
