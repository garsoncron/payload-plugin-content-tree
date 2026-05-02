#!/usr/bin/env bash
# Pre-publish smoke test.
#
# Builds + packs the plugin into a tarball, copies examples/basic to /tmp,
# replaces the workspace dep with the tarball install, boots the dev server,
# and probes /api/tree-pages to verify the published artifact actually loads
# in a non-workspace context.
#
# Usage:
#   ./scripts/preflight-publish.sh                 # default test dir in /tmp
#   ./scripts/preflight-publish.sh /path/to/dir    # custom test dir
#   ./scripts/preflight-publish.sh --keep          # keep test dir on success
#
# Exit codes: 0 on success, non-zero on any failure.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEEP=0
TEST_DIR=""

for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    *) TEST_DIR="$arg" ;;
  esac
done

if [ -z "$TEST_DIR" ]; then
  TEST_DIR="/tmp/payload-tree-preflight-$(date +%s)"
fi

PLUGIN_DIR="$REPO_ROOT/packages/plugin"
PLUGIN_NAME="@garsoncron/payload-plugin-content-tree"
PLUGIN_VERSION="$(node -p "require('$PLUGIN_DIR/package.json').version")"
TARBALL_NAME="garsoncron-payload-plugin-content-tree-${PLUGIN_VERSION}.tgz"

cleanup() {
  local exit_code=$?
  # Always kill the dev server if we started one
  if [ -n "${DEV_PID:-}" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    echo "[preflight] Killing dev server (pid $DEV_PID)..." >&2
    kill -9 "$DEV_PID" 2>/dev/null || true
  fi
  if [ "$exit_code" -eq 0 ] && [ "$KEEP" -eq 0 ]; then
    echo "[preflight] Cleaning up test dir: $TEST_DIR"
    rm -rf "$TEST_DIR"
  elif [ "$exit_code" -ne 0 ]; then
    echo "[preflight] FAILED — leaving test dir for inspection: $TEST_DIR" >&2
  else
    echo "[preflight] Keeping test dir: $TEST_DIR"
  fi
  rm -f "$PLUGIN_DIR/$TARBALL_NAME"
}
trap cleanup EXIT

echo "[preflight] Plugin: $PLUGIN_NAME@$PLUGIN_VERSION"
echo "[preflight] Test dir: $TEST_DIR"

# ── 1. Build + pack ────────────────────────────────────────────────────────
echo "[preflight] Building plugin..."
( cd "$PLUGIN_DIR" && pnpm build > /dev/null 2>&1 )

echo "[preflight] Packing plugin into tarball..."
( cd "$PLUGIN_DIR" && rm -f "$TARBALL_NAME" && pnpm pack > /dev/null 2>&1 )
TARBALL_PATH="$PLUGIN_DIR/$TARBALL_NAME"

if [ ! -f "$TARBALL_PATH" ]; then
  echo "[preflight] ERROR: tarball not produced at $TARBALL_PATH" >&2
  exit 1
fi
echo "[preflight] Tarball: $TARBALL_PATH ($(du -h "$TARBALL_PATH" | cut -f1))"

# Sanity-check tarball contains README.md + LICENSE
if ! tar -tzf "$TARBALL_PATH" | grep -q "package/README.md$"; then
  echo "[preflight] ERROR: README.md missing from tarball" >&2
  exit 1
fi
if ! tar -tzf "$TARBALL_PATH" | grep -q "package/LICENSE$"; then
  echo "[preflight] ERROR: LICENSE missing from tarball" >&2
  exit 1
fi

# ── 2. Stage a fresh test project from examples/basic ─────────────────────
echo "[preflight] Staging test project from examples/basic..."
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR"
# Copy without .next, node_modules, dev.db
( cd "$REPO_ROOT/examples/basic" && tar -cf - \
  --exclude=node_modules \
  --exclude=.next \
  --exclude=dev.db \
  --exclude=tsconfig.tsbuildinfo \
  . ) | ( cd "$TEST_DIR" && tar -xf - )

# Replace tsconfig "extends" path (basic extends ../../tsconfig.base.json)
# Inline the base config so the test project doesn't depend on the repo
TSCONFIG_BASE="$REPO_ROOT/tsconfig.base.json"
if [ -f "$TSCONFIG_BASE" ]; then
  cp "$TSCONFIG_BASE" "$TEST_DIR/tsconfig.base.json"
  # Patch tsconfig.json to point at the local copy
  node -e "
    const fs = require('fs'), path = require('path');
    const p = path.join('$TEST_DIR', 'tsconfig.json');
    const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
    cfg.extends = './tsconfig.base.json';
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
  "
fi

# Replace the workspace dep with the tarball
PKG_PATH="$TEST_DIR/package.json"
node -e "
  const fs = require('fs');
  const p = '$PKG_PATH';
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  cfg.name = 'payload-tree-preflight';
  if (cfg.dependencies && cfg.dependencies['$PLUGIN_NAME']) {
    cfg.dependencies['$PLUGIN_NAME'] = 'file:$TARBALL_PATH';
  }
  // Remove any workspace: protocol references — turn them into latest fixed versions
  // pnpm in a non-workspace context will fail on workspace:* otherwise
  for (const dep of Object.keys(cfg.dependencies || {})) {
    if (cfg.dependencies[dep].startsWith('workspace:')) {
      // Should not happen for examples/basic, but guard anyway
      delete cfg.dependencies[dep];
    }
  }
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
"

# ── 3. Install ─────────────────────────────────────────────────────────────
echo "[preflight] Installing deps + plugin tarball (this can take a minute)..."
(
  cd "$TEST_DIR"
  # Use a fresh pnpm store for hermeticity? Skip — share the global store for speed.
  # --ignore-workspace keeps pnpm from auto-detecting our parent monorepo
  pnpm install --ignore-workspace > "$TEST_DIR/install.log" 2>&1 || {
    echo "[preflight] ERROR: install failed. Tail of install.log:"
    tail -30 "$TEST_DIR/install.log"
    exit 1
  }
)
echo "[preflight] Install complete."

# Verify the plugin actually got resolved
RESOLVED="$TEST_DIR/node_modules/$PLUGIN_NAME"
if [ ! -d "$RESOLVED" ]; then
  echo "[preflight] ERROR: $RESOLVED not present after install" >&2
  exit 1
fi
if [ ! -f "$RESOLVED/dist/index.js" ]; then
  echo "[preflight] ERROR: $RESOLVED/dist/index.js missing" >&2
  exit 1
fi
echo "[preflight] Plugin resolved at $RESOLVED"

# ── 4. Generate Payload importMap (in case it differs from the source) ────
echo "[preflight] Generating Payload importMap..."
( cd "$TEST_DIR" && pnpm exec payload generate:importmap > /dev/null 2>&1 ) || {
  echo "[preflight] WARN: generate:importmap failed (non-fatal — using committed importMap.js)"
}

# ── 5. Boot dev server ─────────────────────────────────────────────────────
PORT=3030  # avoid clashing with our own example on 3000
echo "[preflight] Booting dev server on port $PORT..."
(
  cd "$TEST_DIR"
  PORT=$PORT pnpm exec next dev -p $PORT > "$TEST_DIR/dev.log" 2>&1 &
  echo $! > "$TEST_DIR/dev.pid"
)
DEV_PID=$(cat "$TEST_DIR/dev.pid")
echo "[preflight] Dev pid: $DEV_PID"

# Wait for server to respond
echo "[preflight] Waiting for server to be ready..."
TIMEOUT=60
ELAPSED=0
until curl -sf -o /dev/null "http://localhost:$PORT/admin"; do
  sleep 2
  ELAPSED=$((ELAPSED + 2))
  if [ $ELAPSED -ge $TIMEOUT ]; then
    echo "[preflight] ERROR: server did not respond in ${TIMEOUT}s. Tail of dev.log:" >&2
    tail -40 "$TEST_DIR/dev.log" >&2
    exit 1
  fi
  if ! kill -0 "$DEV_PID" 2>/dev/null; then
    echo "[preflight] ERROR: dev server died. Tail of dev.log:" >&2
    tail -40 "$TEST_DIR/dev.log" >&2
    exit 1
  fi
done
echo "[preflight] Server ready (took ${ELAPSED}s)."

# ── 6. Smoke probe ─────────────────────────────────────────────────────────
echo "[preflight] Probing /api/tree-pages..."
HTTP_CODE=$(curl -sw '%{http_code}' -o "$TEST_DIR/tree-pages.json" "http://localhost:$PORT/api/tree-pages")
if [ "$HTTP_CODE" != "200" ]; then
  echo "[preflight] ERROR: /api/tree-pages returned $HTTP_CODE (expected 200). Body:" >&2
  cat "$TEST_DIR/tree-pages.json" >&2
  exit 1
fi

# Validate response shape: { nodes: [], total: N }
if ! node -e "
  const body = JSON.parse(require('fs').readFileSync('$TEST_DIR/tree-pages.json', 'utf8'));
  if (!Array.isArray(body.nodes)) { console.error('nodes is not an array:', body); process.exit(1); }
  if (typeof body.total !== 'number') { console.error('total is not a number:', body); process.exit(1); }
  console.log('  /api/tree-pages → 200 { nodes: [' + body.nodes.length + ' items], total: ' + body.total + ' }');
" 2>&1; then
  echo "[preflight] ERROR: /api/tree-pages response shape invalid" >&2
  exit 1
fi

# Probe /admin/tree (HTML — just check it's not 500)
echo "[preflight] Probing /admin/tree..."
HTTP_CODE=$(curl -sw '%{http_code}' -o /dev/null "http://localhost:$PORT/admin/tree")
if [ "$HTTP_CODE" -ge 500 ]; then
  echo "[preflight] ERROR: /admin/tree returned $HTTP_CODE (server error)" >&2
  exit 1
fi
echo "  /admin/tree → $HTTP_CODE"

# ── 7. Seed data + verify it flows ─────────────────────────────────────────
echo "[preflight] Seeding test data via REST API..."
EMAIL="preflight@test.local"
PASS="preflight-pass-1234"

# Create the first user (or log in if it already exists from a prior --keep run)
TOKEN=$(curl -s -X POST "http://localhost:$PORT/api/users/first-register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" \
  | node -e "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).token||'')}catch{console.log('')}})")

if [ -z "$TOKEN" ]; then
  TOKEN=$(curl -s -X POST "http://localhost:$PORT/api/users/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" \
    | node -e "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).token||'')}catch{console.log('')}})")
fi

if [ -z "$TOKEN" ]; then
  echo "[preflight] ERROR: could not auth (first-register and login both failed)" >&2
  exit 1
fi
echo "  authenticated"

# Seed a 3-level tree: Root folder → Subfolder → Page
seed_doc() {
  local title="$1" content_type="$2" parent="$3" sort_order="$4"
  local data
  if [ -z "$parent" ] || [ "$parent" = "null" ]; then
    data="{\"title\":\"$title\",\"contentType\":\"$content_type\",\"sortOrder\":$sort_order}"
  else
    data="{\"title\":\"$title\",\"contentType\":\"$content_type\",\"parent\":$parent,\"sortOrder\":$sort_order}"
  fi
  curl -s -X POST "http://localhost:$PORT/api/pages" \
    -H "Content-Type: application/json" \
    -H "Authorization: JWT $TOKEN" \
    -d "$data" \
    | node -e "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d); if(r.errors){console.error('create failed:', JSON.stringify(r.errors));process.exit(1)} console.log(r.doc.id)})"
}

ROOT_ID=$(seed_doc "Preflight Root" "folder" "" 0)
CHILD_ID=$(seed_doc "Preflight Child" "folder" "$ROOT_ID" 0)
LEAF_ID=$(seed_doc "Preflight Leaf" "page" "$CHILD_ID" 0)
echo "  seeded: root=$ROOT_ID, child=$CHILD_ID, leaf=$LEAF_ID"

# Verify the tree endpoint returns the seeded structure
echo "[preflight] Verifying seeded tree structure..."
curl -s -H "Authorization: JWT $TOKEN" "http://localhost:$PORT/api/tree-pages" \
  > "$TEST_DIR/tree-pages-seeded.json"

if ! node -e "
  const body = JSON.parse(require('fs').readFileSync('$TEST_DIR/tree-pages-seeded.json', 'utf8'));
  const findById = (nodes, id) => {
    for (const n of nodes) {
      if (String(n.id) === String(id)) return n;
      if (n.children) { const sub = findById(n.children, id); if (sub) return sub; }
    }
    return null;
  };
  const root = findById(body.nodes, $ROOT_ID);
  if (!root) { console.error('Root not found in tree.'); process.exit(1); }
  if (!root.children || root.children.length === 0) { console.error('Root has no children.'); process.exit(1); }
  const child = findById(body.nodes, $CHILD_ID);
  if (!child) { console.error('Child not found.'); process.exit(1); }
  const leaf = findById(body.nodes, $LEAF_ID);
  if (!leaf) { console.error('Leaf not found.'); process.exit(1); }
  console.log('  tree shape ok: 3-level chain found');
"; then
  echo "[preflight] ERROR: seeded tree structure not reflected by /api/tree-pages" >&2
  exit 1
fi

# Verify search finds the leaf and its ancestors
echo "[preflight] Verifying search returns ancestor expandIds..."
curl -s -H "Authorization: JWT $TOKEN" "http://localhost:$PORT/api/tree-pages/search?q=Preflight%20Leaf" \
  > "$TEST_DIR/search.json"

if ! node -e "
  const body = JSON.parse(require('fs').readFileSync('$TEST_DIR/search.json', 'utf8'));
  if (!Array.isArray(body.results) || body.results.length === 0) {
    console.error('Search returned no results:', body); process.exit(1);
  }
  const expand = (body.expandIds || []).map(String);
  if (!expand.includes(String($ROOT_ID)) || !expand.includes(String($CHILD_ID))) {
    console.error('expandIds missing ancestors. Got:', expand); process.exit(1);
  }
  console.log('  search ok: ' + body.results.length + ' result(s), ' + expand.length + ' ancestor id(s)');
"; then
  echo "[preflight] ERROR: search response shape unexpected" >&2
  exit 1
fi

# Verify reorder endpoint moves a node
echo "[preflight] Verifying reorder endpoint..."
REORDER=$(curl -s -X POST "http://localhost:$PORT/api/tree-pages/reorder" \
  -H "Content-Type: application/json" \
  -H "Authorization: JWT $TOKEN" \
  -d "{\"nodeId\":$LEAF_ID,\"newParentId\":$ROOT_ID,\"newIndex\":0}")
if ! echo "$REORDER" | node -e "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d); if(!r.ok){console.error('reorder failed:', d);process.exit(1)} console.log('  reorder ok')})"; then
  exit 1
fi

# Confirm the leaf now reports root as parent
NEW_PARENT=$(curl -s -H "Authorization: JWT $TOKEN" "http://localhost:$PORT/api/pages/$LEAF_ID?depth=0" \
  | node -e "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d).parent)})")
if [ "$NEW_PARENT" != "$ROOT_ID" ]; then
  echo "[preflight] ERROR: after reorder, leaf parent is $NEW_PARENT (expected $ROOT_ID)" >&2
  exit 1
fi
echo "  reorder persisted at the data layer"

# ── 8. Done ────────────────────────────────────────────────────────────────
echo ""
echo "[preflight] ✓ All checks passed."
echo ""
echo "  Plugin:   $PLUGIN_NAME@$PLUGIN_VERSION"
echo "  Tarball:  $(du -h "$TARBALL_PATH" 2>/dev/null | cut -f1 || echo 'n/a')"
echo "  Test dir: $TEST_DIR"
echo "  Admin:    http://localhost:$PORT/admin/tree"
echo ""
if [ "$KEEP" -eq 1 ]; then
  echo "  Server is still running (PID $DEV_PID). Kill with: kill $DEV_PID"
  # Don't trigger cleanup — the user wants to inspect
  trap - EXIT
fi
