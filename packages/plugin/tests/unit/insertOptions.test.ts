import { describe, it, expect } from 'vitest'
import { getAllowedInserts } from '../../src/shared/insertOptions'

describe('getAllowedInserts', () => {
  it.todo('returns empty when nodeDepth >= maxDepth')
  it.todo('returns root options when node is null')
  it.todo('returns config[node.contentType] for non-root nodes')
  it.todo('returns [] for unknown contentType')

  it('placeholder so the suite has at least one passing test', () => {
    expect(typeof getAllowedInserts).toBe('function')
  })
})
