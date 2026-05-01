/**
 * Puck visual editor route — /puck/[id]
 *
 * This page renders the Puck editor for a given page ID. The content tree's
 * right-rail iframe navigates here when a page node is clicked, courtesy of
 * the `editUrlBuilder` prop wired in <TreeWithPuck>.
 *
 * STUB STATUS
 * -----------
 * This is a minimal demonstration. It intentionally does NOT:
 *  - Load existing page data from Payload (no GET /api/pages/[id])
 *  - Persist Puck's output back to Payload on publish (no PATCH /api/pages/[id])
 *
 * TODO: To make this production-ready, wire Puck's `onPublish` callback to a
 * server action or API route that PATCHes the page's content field via the
 * Payload local API. See https://puckeditor.com/docs/integrating-puck for
 * the recommended data-persistence pattern.
 *
 * The value this example delivers is demonstrating that `editUrlBuilder` correctly
 * swaps the iframe target from Payload's default edit view to a Puck-powered URL —
 * the data-persistence layer is deliberately out of scope for v0.1.
 */

// Puck requires a browser environment — keep this a client component.
'use client'

import { Puck } from '@measured/puck'
import type { Config, ComponentConfig } from '@measured/puck'
import '@measured/puck/puck.css'

/** Field definitions for the Heading component. */
interface HeadingProps {
  text: string
}

/** Field definitions for the Paragraph component. */
interface ParagraphProps {
  text: string
}

const HeadingConfig: ComponentConfig<HeadingProps> = {
  fields: {
    text: { type: 'text' },
  },
  render: ({ text }) => <h1>{text}</h1>,
}

const ParagraphConfig: ComponentConfig<ParagraphProps> = {
  fields: {
    text: { type: 'textarea' },
  },
  render: ({ text }) => <p>{text}</p>,
}

/**
 * Minimal Puck component registry.
 * Real projects will have a richer config; this stub proves the route renders.
 */
const config: Config = {
  components: {
    Heading: HeadingConfig,
    Paragraph: ParagraphConfig,
  },
}

/** Empty initial data — a real integration would fetch from Payload here. */
const emptyData = { content: [], root: { props: {} } }

interface PuckEditorPageProps {
  params: { id: string }
}

/**
 * Renders the Puck visual editor for the page identified by `id`.
 *
 * The `id` comes from the content tree node's `id` field, which maps to a
 * Payload document ID. A full integration would:
 *  1. fetch(`/api/pages/${id}`) to load saved Puck JSON
 *  2. pass it as `data` to <Puck>
 *  3. use `onPublish` to PATCH the page with updated Puck JSON
 */
export default function PuckEditorPage({ params }: PuckEditorPageProps) {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: '8px 16px',
          background: '#1a1a2e',
          color: '#e0e0e0',
          fontSize: '12px',
          fontFamily: 'monospace',
        }}
      >
        Puck editor — page ID: {params.id} (stub — data not persisted)
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Puck
          config={config}
          // TODO: Replace with data fetched from GET /api/pages/[id] and pass
          // onPublish to PATCH the page. See file-level TODO above.
          data={emptyData}
        />
      </div>
    </div>
  )
}
