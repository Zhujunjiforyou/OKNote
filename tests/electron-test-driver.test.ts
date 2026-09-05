import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'

interface Client {
  connect: () => Promise<void>
  call: (method: string) => Promise<unknown>
  evaluate: (expression: string) => Promise<unknown>
  close: () => void
  pending: Map<number, unknown>
}
const require = createRequire(import.meta.url)
const { DevToolsClient, stopChild } = require('../scripts/lib/electron-test-driver.cjs') as {
  DevToolsClient: new (url: string, timeoutMs?: number) => Client
  stopChild: (child: unknown) => Promise<void>
}

class TestSocket extends EventTarget {
  static OPEN = 1
  static latest: TestSocket
  readyState = 0
  sent: Array<{ id: number; method: string }> = []
  constructor() { super(); TestSocket.latest = this }
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')) }
  send(raw: string) { this.sent.push(JSON.parse(raw)) }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')) }
  reply(data: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })) }
}

async function connected() {
  vi.stubGlobal('WebSocket', TestSocket)
  const client = new DevToolsClient('ws://test', 100)
  const pending = client.connect()
  TestSocket.latest.open()
  await pending
  return { client, socket: TestSocket.latest }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('bounded Electron test transport', () => {
  it('recognizes signal-terminated children as stopped even without an exit code', async () => {
    const child = { exitCode: null, signalCode: 'SIGTERM', once: vi.fn(), kill: vi.fn() }
    await stopChild(child)
    expect(child.once).not.toHaveBeenCalled()
    expect(child.kill).not.toHaveBeenCalled()
  })
  it('routes concurrent replies by ID rather than arrival order', async () => {
    const { client, socket } = await connected()
    const first = client.call('first')
    const second = client.call('second')
    socket.reply({ id: 2, result: 'second result' })
    socket.reply({ id: 1, result: 'first result' })
    await expect(first).resolves.toBe('first result')
    await expect(second).resolves.toBe('second result')
    expect(client.pending.size).toBe(0)
    client.close()
  })

  it('rejects every pending call when the WebSocket closes', async () => {
    const { client, socket } = await connected()
    const results = Promise.allSettled([client.call('one'), client.call('two')])
    socket.close()
    expect((await results).every((result) => result.status === 'rejected')).toBe(true)
    expect(client.pending.size).toBe(0)
    await expect(client.call('late')).rejects.toThrow('not open')
  })

  it('times out a stalled renderer and releases pending requests', async () => {
    vi.useFakeTimers()
    const { client } = await connected()
    const result = expect(client.call('Runtime.evaluate')).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(101)
    await result
    expect(client.pending.size).toBe(0)
  })

  it('bounds the initial connection wait', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', TestSocket)
    const client = new DevToolsClient('ws://test', 100)
    const result = expect(client.connect()).rejects.toThrow('connection timed out')
    await vi.advanceTimersByTimeAsync(101)
    await result
    expect(TestSocket.latest.readyState).toBe(3)
  })

  it('propagates renderer exceptions instead of reporting a false pass', async () => {
    const { client, socket } = await connected()
    const result = expect(client.evaluate('throw new Error()')).rejects.toThrow('broken renderer')
    socket.reply({ id: 1, result: { exceptionDetails: { text: 'broken renderer' } } })
    await result
    client.close()
  })
})
