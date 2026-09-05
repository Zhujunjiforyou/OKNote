import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
type Recovery = { reason: string; writeError?: Error }
type Validation = boolean | { valid: true; degraded: true; reason: string }
const { readJsonWithRecovery, writeJsonAtomic } = require('../electron/json-store.cjs') as {
  readJsonWithRecovery: (file: string, label?: string, options?: {
    decryptLegacyPayload?: (payload: Buffer) => string
    validate?: (value: unknown) => Validation
    migrateLegacyBackup?: boolean
    onRecovery?: (details: Recovery) => void
    onDegraded?: (details: { reason: string }) => void
    fs?: typeof fs
  }) => unknown
  writeJsonAtomic: (file: string, value: unknown) => void
}
const { dataDocumentValidator } = require('../electron/data-validation.cjs') as {
  dataDocumentValidator: (name: string) => (value: unknown) => Validation
}
const { listLegacyJsonFiles } = require('../electron/legacy-json.cjs') as {
  listLegacyJsonFiles: (directory: string) => string[]
}
const roots: string[] = []
const makeRoot = () => { const root = fs.mkdtempSync(join(tmpdir(), 'oknote-legacy-json-')); roots.push(root); return root }
const envelope = (value: unknown) => JSON.stringify({
  __oknoteEncrypted: 'oknote-safe-storage', version: 1,
  payload: Buffer.from(JSON.stringify(value)).toString('base64'),
})
const decode = (payload: Buffer) => payload.toString('utf8')
const event = (id: string) => ({ id, title: id, startDate: '2026-09-05' })
const options = (name: string) => ({ validate: dataDocumentValidator(name), decryptLegacyPayload: decode })
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'))
const archives = (root: string) => fs.readdirSync(join(root, '.legacy-json')).map(name => fs.readFileSync(join(root, '.legacy-json', name), 'utf8'))

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

describe('withdrawn local format compatibility (plain JSON writes only)', () => {
  it('does not invoke legacy decoding or rewrite ordinary old JSON', () => {
    const file = join(makeRoot(), 'events.json')
    const original = '[ { "id": "old", "startDate": "2026-09-05" } ]'
    fs.writeFileSync(file, original)
    expect(readJsonWithRecovery(file, '事件', { ...options('events.json'), decryptLegacyPayload: () => { throw new Error('must not decode plain JSON') } })).toEqual(JSON.parse(original))
    expect(fs.readFileSync(file, 'utf8')).toBe(original)
  })

  it('keeps the current primary and the distinct, larger backup without merging deleted records', () => {
    const root = makeRoot(), file = join(root, 'events.json')
    const current = [event('current')], previous = [event('old'), event('deleted')]
    const primary = envelope(current), backup = envelope(previous)
    fs.writeFileSync(file, primary); fs.writeFileSync(`${file}.bak`, backup)
    const recovery: Recovery[] = []
    expect(readJsonWithRecovery(file, '事件', { ...options('events.json'), onRecovery: details => recovery.push(details) })).toEqual(current)
    expect(read(file)).toEqual(current)
    expect(read(`${file}.bak`)).toEqual(previous)
    expect(archives(root).sort()).toEqual([primary, backup].sort())
    expect(recovery).toEqual([expect.objectContaining({ reason: 'legacy-format' })])
    expect(recovery[0].writeError).toBeUndefined()
    writeJsonAtomic(file, [event('edited')])
    expect(read(file)).toEqual([event('edited')])
    expect(read(`${file}.bak`)).toEqual(current)
    expect(archives(root)).toHaveLength(2)
  })

  it('converts notes, tags, reminder state/history, settings, bounds and trash without changing fields', () => {
    const root = makeRoot()
    const note = { id: 'n1', title: '便签', noteType: 'independent', revision: 7, items: [{ id: 'todo1', content: '保留', completed: true }] }
    const documents: Record<string, unknown> = {
      'note_n1.json': note, 'notes.json': [note],
      'tags.json': [{ id: 'tag1', name: '工作', color: '#123456' }],
      'reminder-state.json': { fired: { key: '2026-09-05T01:00:00Z' }, lastCheckedAt: '2026-09-05T02:00:00Z' },
      'reminder-history.json': [{ id: 'r1', eventId: 'e1', startDate: '2026-09-05', firedAt: '2026-09-05T01:00:00Z', read: true }],
      'settings.json': { themeMode: 'light', globalFontSize: 22 },
      'window-bounds.json': { calendar: { x: 10, y: 20, width: 800, height: 600 } },
      'trash_t1.json': { trashId: 'trash_t1', noteId: 'n1', note, deletedAt: '2026-09-05T01:00:00Z' },
    }
    for (const [name, value] of Object.entries(documents)) {
      const file = join(root, name)
      fs.writeFileSync(file, envelope(value))
      expect(readJsonWithRecovery(file, name, options(name))).toEqual(value)
      expect(read(file)).toEqual(value)
    }
  })

  it('converts a legacy backup even when the primary is already plain', () => {
    const file = join(makeRoot(), 'events.json')
    fs.writeFileSync(file, JSON.stringify([event('current')]))
    fs.writeFileSync(`${file}.bak`, envelope([event('old')]))
    expect(readJsonWithRecovery(file, '事件', { ...options('events.json'), migrateLegacyBackup: true })).toEqual([event('current')])
    expect(read(`${file}.bak`)).toEqual([event('old')])
  })

  it('restores a missing or unreadable primary from a valid legacy backup', () => {
    for (const original of [undefined, '{broken', envelope({ invalid: true })]) {
      const file = join(makeRoot(), 'events.json')
      if (original !== undefined) fs.writeFileSync(file, original)
      fs.writeFileSync(`${file}.bak`, envelope([event('recovered')]))
      expect(readJsonWithRecovery(file, '事件', options('events.json'))).toEqual([event('recovered')])
      expect(read(file)).toEqual([event('recovered')])
      expect(read(`${file}.bak`)).toEqual([event('recovered')])
    }
  })

  it('returns decoded content but keeps original copies and reports write protection when conversion fails', () => {
    const root = makeRoot(), file = join(root, 'events.json'), original = envelope([event('current')])
    fs.writeFileSync(file, original)
    const reports: Recovery[] = []
    const failingFs = { ...fs, renameSync: () => { throw new Error('disk full') } } as typeof fs
    expect(readJsonWithRecovery(file, '事件', { ...options('events.json'), fs: failingFs, onRecovery: details => reports.push(details) })).toEqual([event('current')])
    expect(fs.readFileSync(file, 'utf8')).toBe(original)
    expect(reports[0].writeError?.message).toBe('disk full')
    expect(archives(root)).toEqual([original])
    expect(readJsonWithRecovery(file, '事件', options('events.json'))).toEqual([event('current')])
    expect(read(file)).toEqual([event('current')])
    expect(archives(root)).toHaveLength(1)
  })

  it('retries a failed backup conversion even after the primary conversion succeeded', () => {
    const file = join(makeRoot(), 'events.json')
    fs.writeFileSync(file, envelope([event('current')]))
    fs.writeFileSync(`${file}.bak`, envelope([event('old')]))
    const failingFs = { ...fs, renameSync: (from: fs.PathLike, to: fs.PathLike) => {
      if (String(to).endsWith('.bak')) throw new Error('backup locked')
      fs.renameSync(from, to)
    } } as typeof fs
    const reports: Recovery[] = []
    readJsonWithRecovery(file, '事件', { ...options('events.json'), fs: failingFs, onRecovery: details => reports.push(details) })
    expect(reports[0].writeError?.message).toBe('backup locked')
    expect(read(file)).toEqual([event('current')])
    expect(read(`${file}.bak`).__oknoteEncrypted).toBe('oknote-safe-storage')
    readJsonWithRecovery(file, '事件', options('events.json'))
    expect(read(`${file}.bak`)).toEqual([event('old')])
  })

  it('never replaces either copy when the original archive cannot be created', () => {
    const file = join(makeRoot(), 'events.json'), original = envelope([event('current')])
    fs.writeFileSync(file, original)
    const failingFs = { ...fs, mkdirSync: () => { throw new Error('archive denied') } } as typeof fs
    const reports: Recovery[] = []
    expect(readJsonWithRecovery(file, '事件', { ...options('events.json'), fs: failingFs, onRecovery: details => reports.push(details) })).toEqual([event('current')])
    expect(fs.readFileSync(file, 'utf8')).toBe(original)
    expect(reports[0].writeError?.message).toBe('archive denied')
  })

  it('rejects unavailable keys, unknown versions and malformed envelopes without overwriting originals', () => {
    for (const value of [
      { __oknoteEncrypted: 'oknote-safe-storage', version: 9, payload: 'e30=' },
      { __oknoteEncrypted: 'oknote-safe-storage', version: 1, payload: '**bad**' },
      { __oknoteEncrypted: 'unknown', version: 1, payload: 'e30=' },
      JSON.parse(envelope([event('current')])),
    ]) {
      const file = join(makeRoot(), 'events.json'), original = JSON.stringify(value)
      fs.writeFileSync(file, original)
      expect(() => readJsonWithRecovery(file, '事件', { ...options('events.json'), decryptLegacyPayload: () => { throw new Error('key unavailable') } })).toThrow()
      expect(fs.readFileSync(file, 'utf8')).toBe(original)
    }
  })

  it('keeps mixed-validity decoded data read-only and does not replace a more complete backup', () => {
    const file = join(makeRoot(), 'events.json'), original = envelope([event('current'), null]), backup = envelope([event('old')])
    fs.writeFileSync(file, original); fs.writeFileSync(`${file}.bak`, backup)
    const reports: string[] = []
    expect(readJsonWithRecovery(file, '事件', { ...options('events.json'), onDegraded: details => reports.push(details.reason) })).toEqual([event('current'), null])
    expect(reports).toEqual(['degraded-primary'])
    expect(fs.readFileSync(file, 'utf8')).toBe(original)
    expect(fs.readFileSync(`${file}.bak`, 'utf8')).toBe(backup)
  })

  it('finds backup-only and unused records but never scans archives or unrelated profile files', () => {
    const root = makeRoot()
    fs.mkdirSync(join(root, 'data', '.trash'), { recursive: true })
    fs.mkdirSync(join(root, 'data', '.legacy-json'))
    for (const relative of ['settings.json', 'data/events.json.bak', 'data/note_unused.json', 'data/.trash/trash_n.json', 'data/.legacy-json/ignored.json', 'Preferences']) {
      fs.writeFileSync(join(root, relative), envelope([]))
    }
    fs.writeFileSync(join(root, 'window-bounds.json'), '{}')
    expect(listLegacyJsonFiles(root).sort()).toEqual([
      join(root, 'settings.json'), join(root, 'data/events.json'), join(root, 'data/note_unused.json'), join(root, 'data/.trash/trash_n.json'),
    ].sort())
  })
})
