/**
 * Playwright smoke test — happy-path tree interaction.
 *
 * TODO(v0.1): boot examples/basic, log in, expand a node, drag it to
 * a new parent, reload, assert the move persisted.
 */

import { test, expect } from '@playwright/test'

test.skip('smoke: drag a node to a new parent and reload', async ({ page }) => {
  await page.goto('/admin/tree')
  await expect(page.getByTestId('page-content-tree')).toBeVisible()
  // TODO(v0.1): full happy path
})
