# examples/with-puck

Demonstrates `@garsoncron/payload-plugin-content-tree` integration with [Puck](https://puckeditor.com) as the right-rail iframe target via `editUrlBuilder`.

## Running the example

```bash
pnpm install
pnpm --filter examples-with-puck dev
```

Open `http://localhost:3001/admin` (or whichever port Next reports), complete the first-user setup, then visit:

- `/admin/tree` — plugin default view (iframe points at Payload's built-in edit page)
- `/admin/tree-puck` — wrapper view (iframe points at `/puck/[id]` — the Puck editor)

## The integration: why a wrapper component?

`editUrlBuilder` is a function on `ContentTreePluginOptions`. Functions cannot survive the Next.js RSC→client boundary as JSON when passed through Payload's `clientProps` mechanism. The plugin strips them before they reach the admin view.

The solution is a **consumer-owned wrapper client component**:

```tsx
// src/components/TreeWithPuck.tsx
'use client'

import { ContentTreeView } from '@garsoncron/payload-plugin-content-tree/client'
import type { TreeNode } from '@garsoncron/payload-plugin-content-tree'

function buildPuckUrl(node: TreeNode): string {
  return `/puck/${node.id}`
}

export function TreeWithPuck(props: any) {
  return <ContentTreeView {...props} editUrlBuilder={buildPuckUrl} />
}
```

Register this wrapper as a second admin view in `payload.config.ts`:

```ts
admin: {
  components: {
    views: {
      treePuck: {
        Component: {
          path: './components/TreeWithPuck#TreeWithPuck',
        },
        path: '/tree-puck',
      },
    },
  },
},
```

Add the wrapper to your `importMap.js` so Payload can resolve it at runtime:

```js
import { TreeWithPuck as TreeWithPuck_xxx } from '../../../components/TreeWithPuck.js'

export const importMap = {
  // ...existing entries...
  './components/TreeWithPuck#TreeWithPuck': TreeWithPuck_xxx,
}
```

> **Tip:** After your first `pnpm dev` run, Payload regenerates `importMap.js` automatically. Commit the updated file.

## Puck route

`/puck/[id]` renders a stub Puck editor (`src/app/puck/[id]/page.tsx`). In this example it does **not** load or persist page data — its sole purpose is to demonstrate that the iframe target swap works.

See the Puck docs on [integrating Puck with a CMS](https://puckeditor.com/docs/integrating-puck) for the recommended `onPublish` + API pattern to persist edits back to Payload.

## What's deliberately out of scope

- Persisting Puck's output back to Payload (no `onPublish` wired to a PATCH request)
- Loading existing page content into the Puck editor on open
- Authentication / authorization for the Puck route

These are standard Puck integration steps, not plugin-specific concerns. The plugin's responsibility ends at routing the iframe to the correct URL — what that URL renders is up to you.

## Links

- [Puck docs](https://puckeditor.com/docs)
- [Plugin README](../../README.md)
- [PRD §6 — editUrlBuilder API contract](../../PRD.md)
