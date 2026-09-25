import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
const require = createRequire(import.meta.url)
const { watchMouseRelease } = require('../electron/drag-release-watch.cjs')
afterEach(() => vi.useRealTimers())

describe('drag release recovery', () => {
  it('finishes once after a release even when the renderer sends no mouseup', () => {
    vi.useFakeTimers()
    let down = true
    const finish = vi.fn()
    watchMouseRelease({ isPressed: () => down, onRelease: finish, onError: vi.fn() })
    vi.advanceTimersByTime(5000)
    expect(finish).not.toHaveBeenCalled()
    down = false
    vi.advanceTimersByTime(1000)
    expect(finish).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cancels its watcher when a drag ends normally or its owner closes', () => {
    vi.useFakeTimers()
    const finish = vi.fn()
    const stop = watchMouseRelease({ isPressed: () => false, onRelease: finish, onError: vi.fn() })
    stop()
    stop()
    vi.advanceTimersByTime(1000)
    expect(finish).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('recovers a release that already happened before the first native sample', () => {
    vi.useFakeTimers()
    const finish = vi.fn()
    watchMouseRelease({ isPressed: () => false, onRelease: finish, onError: vi.fn() })
    vi.advanceTimersByTime(120)
    expect(finish).toHaveBeenCalledTimes(1)
  })
  it('cleans up on a native reader failure without committing a drop', () => {
    vi.useFakeTimers()
    const finish = vi.fn(), cancel = vi.fn()
    watchMouseRelease({ isPressed: () => { throw Error('window closed') }, onRelease: finish, onError: cancel })
    vi.advanceTimersByTime(1000)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(finish).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
