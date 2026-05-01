#!/usr/bin/env node
/**
 * CLI: pnpm compat-check
 *
 * Validates a target Payload's collection against the plugin contract
 * before adoption. Reads DATABASE_URI from env, loads payload, walks
 * fields, prints a pass/fail report.
 *
 * TODO(v0.1): implement.
 */

async function main() {
  const slug = process.argv[2]
  if (!slug) {
    console.error('Usage: compat-check <collection-slug>')
    process.exit(2)
  }
  console.log(
    `[content-tree-plugin] compat-check for collection "${slug}" — NOT_IMPLEMENTED (v0.1)`,
  )
  process.exit(0)
}

void main()
