# Migrating

## From a homegrown content tree (e.g. FRAS Canada) to v0.1

This is the FRAS-shaped path. Adapt as needed.

### 1. Verify your collection shape

Run the compat check against your dev DB:

```bash
DATABASE_URI=postgres://… pnpm compat-check pages
```

If it fails, add the missing fields. The error message lists exactly which.

### 2. Install the plugin

```bash
pnpm add github:getfishtank/payload-plugin-content-tree#v0.1.0
```

### 3. Replace the homegrown view + endpoints

Delete:

```
src/admin/views/ContentTree.tsx
src/admin/views/ContentTreeClient.tsx
src/admin/components/TreeContextMenu.tsx
src/admin/components/TreeDndWrapper.tsx
src/admin/types/tree.ts
src/admin/config/insertOptions.ts          # the values move into the plugin config
src/app/api/tree/route.ts
src/app/api/tree/search/route.ts
```

Add to `payload.config.ts`:

```ts
import { contentTreePlugin } from '@fishtank/payload-plugin-content-tree'

plugins: [
  contentTreePlugin({
    collectionSlug: 'pages',
    fields: { workflowState: 'workflowState', lockedBy: 'lockedBy' },
    insertOptions: {
      /* paste from old insertOptions.ts */
    },
    contentTypeLabels: {
      /* paste */
    },
    canPerformAction: (action, user) => !(action === 'delete' && user?.role === 'author'),
  }),
]
```

Remove the `admin.components.views.contentTree` block — the plugin registers it for you.

### 4. Re-run importmap generation

```bash
pnpm payload generate:importmap
```

### 5. Verify

- `/admin/tree` loads
- expand/collapse persists across reloads
- right-click insert/duplicate/rename/delete all work
- DnD reorder + reparent persists

### 6. Net change

~2,100 LOC removed; ~10 lines added in `payload.config.ts`.
