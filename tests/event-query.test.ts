import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { eventsByTag } = require('../electron/event-query.cjs') as {
  eventsByTag: (events: unknown, tagId: string, loadError?: string | null) => unknown[]
}

describe('tag event query', () => {
  it('returns matching events when the snapshot is readable', () => {
    expect(eventsByTag([
      { id: 'one', tagId: 'work' },
      { id: 'two', tagId: 'home' },
      null,
    ], 'work')).toEqual([{ id: 'one', tagId: 'work' }])
  })

  it('propagates a damaged event-file error instead of reporting an empty tag', () => {
    expect(() => eventsByTag([], 'work', '事件主文件与备份均无法读取'))
      .toThrow('事件主文件与备份均无法读取')
  })
})
