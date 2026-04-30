# examples/basic

Minimal Payload sandbox used to develop and demo the plugin.

```bash
pnpm install        # from repo root
pnpm dev            # from repo root — boots this example
```

Open http://localhost:3000/admin → create a user → visit `/admin/tree`.

To populate fixtures: `pnpm --filter examples/basic seed`.

The SQLite DB lives at `./dev.db` and is gitignored.
