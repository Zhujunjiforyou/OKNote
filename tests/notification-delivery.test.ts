import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
const require = createRequire(import.meta.url)
const { waitForNativeNotification } = require('../electron/notification-delivery.cjs')

function notification() {
  return Object.assign(new EventEmitter(), { id: 'ours', show: vi.fn(), close: vi.fn() })
}
afterEach(() => vi.useRealTimers())

describe('notification submission acknowledgement', () => {
  it('times out when macOS emits neither show nor failed', async () => {
    vi.useFakeTimers()
    const n = notification()
    const done = vi.fn()
    const delivery = waitForNativeNotification(n).then(done)
    await vi.advanceTimersByTimeAsync(4999)
    expect(done).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await delivery
    expect(done).toHaveBeenCalledWith(false)
    expect(n.close).toHaveBeenCalledOnce()
    n.emit('show')
    expect(done).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('accepts a delayed system acknowledgement and cancels its timeout', async () => {
    vi.useFakeTimers()
    const n = notification()
    const result = waitForNativeNotification(n)
    await vi.advanceTimersByTimeAsync(200)
    n.emit('show')
    expect(await result).toBe(true)
    expect(n.close).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['failed', 'close'])('rejects %s before acknowledgement', async signal => {
    const n = notification()
    const result = waitForNativeNotification(n)
    n.emit(signal)
    expect(await result).toBe(false)
  })

  it('accepts a user click even before the show callback', async () => {
    const n = notification()
    const result = waitForNativeNotification(n)
    n.emit('click')
    expect(await result).toBe(true)
  })

  it('handles a synchronous show failure without leaking timers', async () => {
    vi.useFakeTimers()
    const n = notification()
    n.show.mockImplementation(() => {throw new Error('OS rejected')})
    expect(await waitForNativeNotification(n)).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
