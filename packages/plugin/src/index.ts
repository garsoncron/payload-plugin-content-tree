/**
 * Server entry — @fishtank/payload-plugin-content-tree
 *
 * Exports the Payload plugin factory. The client-side admin view is
 * exported separately from "./client" so server-only deps don't bleed
 * into the admin bundle.
 */

export { contentTreePlugin } from './plugin'
export type {
  ContentTreePluginOptions,
  TreeNode,
  ContextMenuAction,
} from './shared/types'
