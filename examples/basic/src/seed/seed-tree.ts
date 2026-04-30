/**
 * Seed a 50-node fixture tree into examples/basic.
 *
 * Run: pnpm --filter examples/basic seed
 *
 * TODO(v0.1): generate ~50 nodes across 3 levels with sensible
 * folder/page mix so DnD has interesting targets.
 */

import { getPayload } from 'payload'
import config from '../payload.config'

async function main() {
  const payload = await getPayload({ config })
  void payload
  // TODO(v0.1): create root folders, child pages, deep grandchildren
  console.log('[seed] NOT_IMPLEMENTED — see TODO')
}

void main()
