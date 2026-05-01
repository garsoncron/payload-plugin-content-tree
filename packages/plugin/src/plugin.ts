/**
 * The Payload plugin factory.
 *
 * Validates the target collection's field shape, registers a custom
 * admin view at `opts.adminPath`, and mounts the tree + search REST
 * endpoints. All work happens at buildConfig time — no runtime hooks.
 */

import type { Config, Plugin } from 'payload'
import type { ContentTreePluginOptions } from './shared/types'
import { DEFAULT_ADMIN_PATH, DEFAULT_MAX_DEPTH } from './shared/constants'
import { validateCollection } from './server/helpers/validateCollection'
import { treeEndpoint } from './server/endpoints/tree'
import { searchEndpoint } from './server/endpoints/search'

const VIEW_KEY = 'fishtankContentTree'
const VIEW_PATH = '@fishtank/payload-plugin-content-tree/client#ContentTreeView'

export const contentTreePlugin =
  (opts: ContentTreePluginOptions): Plugin =>
  (incoming: Config): Config => {
    const adminPath = opts.adminPath ?? DEFAULT_ADMIN_PATH

    // Throws on a bad collection shape with a copy-pasteable message.
    validateCollection(incoming, opts)

    const config: Config = { ...incoming }
    config.admin = { ...(config.admin ?? {}) }
    config.admin.components = { ...(config.admin.components ?? {}) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const views = { ...((config.admin.components as any).views ?? {}) }

    views[VIEW_KEY] = {
      Component: VIEW_PATH,
      path: adminPath,
      clientProps: serializableOpts(opts, adminPath),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(config.admin.components as any).views = views

    config.endpoints = [...(config.endpoints ?? []), treeEndpoint(opts), searchEndpoint(opts)]

    return config
  }

/**
 * Strip non-serializable plugin options (functions) before they cross
 * the server→client boundary as Payload `clientProps`. Function-shaped
 * options are wired up by the consumer wrapping <ContentTreeView>
 * themselves; the bare admin view registration falls back to defaults.
 */
function serializableOpts(opts: ContentTreePluginOptions, adminPath: string) {
  return {
    collectionSlug: opts.collectionSlug,
    fields: opts.fields ?? {},
    adminPath,
    insertOptions: opts.insertOptions ?? {},
    contentTypeLabels: opts.contentTypeLabels ?? {},
    maxDepth: opts.maxDepth ?? DEFAULT_MAX_DEPTH,
    features: {
      dragAndDrop: opts.features?.dragAndDrop ?? true,
      contextMenu: opts.features?.contextMenu ?? true,
      deepSearch: opts.features?.deepSearch ?? true,
    },
  }
}
