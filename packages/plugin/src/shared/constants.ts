/** Default mount path for the admin view. */
export const DEFAULT_ADMIN_PATH = '/tree'

/** Default tree depth cap. */
export const DEFAULT_MAX_DEPTH = 5

/** localStorage key for persisted expand state. */
export const EXPAND_STATE_KEY = 'fishtank-content-tree-expanded'

/** Workflow-state colors used by the optional gutter dot. */
export const WORKFLOW_STATE_COLORS: Record<string, string> = {
  draft: '#9CA3AF',
  in_review: '#3B82F6',
  needs_revision: '#EAB308',
  approved: '#22C55E',
  published: '#8B5CF6',
  unpublished: '#6B7280',
}
