/**
 * TreeWithPuck — consumer wrapper component that adds editUrlBuilder to the
 * plugin's <ContentTreeView>.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `editUrlBuilder` is a function option on ContentTreePluginOptions. Functions
 * cannot cross the Next.js RSC→client boundary as JSON-serialisable `clientProps`
 * (Payload serialises plugin options to JSON when passing them to the admin view).
 * The plugin therefore strips all function-typed options before they reach the
 * client — the bare admin view at /admin/tree always falls back to Payload's
 * default edit URL.
 *
 * The solution is this file: a 'use client' component that imports ContentTreeView
 * directly and passes editUrlBuilder as a plain React prop. Register this wrapper
 * in payload.config.ts as a second admin view at /admin/tree-puck.
 *
 * INTEGRATION PATTERN (copy to your own project)
 * -----------------------------------------------
 * 1. Create a client component like this one.
 * 2. Register it as a custom admin view in payload.config.ts (see the treePuck
 *    view registration there).
 * 3. Add the component to your importMap.js so Payload can resolve it at runtime.
 * 4. Navigate to the custom path (/admin/tree-puck) instead of the default
 *    /admin/tree.
 */

'use client'

import { ContentTreeView } from '@garsoncron/payload-plugin-content-tree/client'
import type { TreeNode } from '@garsoncron/payload-plugin-content-tree'

/**
 * Build the URL that the right-rail iframe loads when a tree node is selected.
 * This version points at the Puck editor route (/puck/[id]).
 *
 * In a real integration you'd also pass onPublish to <Puck> so it PATCHes the
 * page back to Payload — see the Puck route file for the TODO note.
 */
function buildPuckUrl(node: TreeNode): string {
  return `/puck/${node.id}`
}

/**
 * Wraps <ContentTreeView> with Puck-specific props that cannot survive the
 * RSC clientProps boundary (i.e. function-typed options).
 *
 * The `props: any` type is intentional — Payload's admin-view prop shape is
 * internal and not part of the plugin's public API surface. Spreading unknown
 * server props through to the underlying component is the idiomatic pattern for
 * consumer wrapper views.
 */
export function TreeWithPuck(props: any) {
  return <ContentTreeView {...props} editUrlBuilder={buildPuckUrl} />
}

export default TreeWithPuck
