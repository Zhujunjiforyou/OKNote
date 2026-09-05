import { createRequire } from 'node:module'
import * as nodeFs from 'node:fs'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  readJsonWithRecovery,
  removeJsonArtifacts,
  writeJsonAtomic,
} = require('../electron/json-store.cjs') as {
  readJsonWithRecovery: (
    filePath: string,
    label?: string,
    options?: {
      validate?: (value: unknown) => boolean | { valid: true; degraded: true; reason: string }
      onRecovery?: (details: {
        filePath: string
        backupPath: string
        label: string
        primaryError: Error
        reason: 'invalid-primary' | 'missing-primary'
        writeError?: Error
      }) => void
      onDegraded?: (details: {
        filePath: string
        backupPath: string
        label: string
        reason: 'degraded-primary' | 'degraded-backup'
        backupStatus: 'valid' | 'degraded' | 'invalid' | 'missing'
      }) => void
      fs?: typeof nodeFs
    },
  ) => unknown
  removeJsonArtifacts: (filePath: string) => boolean
  writeJsonAtomic: (filePath: string, value: unknown, preserveBackup?: boolean) => boolean
}

const temporaryRoots: string[] = []

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'oknote-json-store-'))
  temporaryRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('plain JSON store', () => {
  it('keeps exactly one previous version and restores it when the primary JSON is damaged', () => {
    const root = makeRoot()
    const filePath = join(root, 'events.json')

    expect(writeJsonAtomic(filePath, [{ title: '第一版' }])).toBe(true)
    expect(writeJsonAtomic(filePath, [{ title: '第二版' }])).toBe(true)
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual([{ title: '第二版' }])
    expect(JSON.parse(readFileSync(`${filePath}.bak`, 'utf8'))).toEqual([{ title: '第一版' }])

    writeFileSync(filePath, '{broken', 'utf8')
    expect(readJsonWithRecovery(filePath, 'events')).toEqual([{ title: '第一版' }])
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual([{ title: '第一版' }])
    expect(readdirSync(root).sort()).toEqual(['events.json', 'events.json.bak'])
  })

  it('removes the primary and its single backup without creating recovery protocols', () => {
    const root = makeRoot()
    const filePath = join(root, 'note_example.json')
    writeJsonAtomic(filePath, { id: 'example', items: [] })
    writeJsonAtomic(filePath, { id: 'example', items: [{ id: '1', content: 'todo' }] })

    expect(removeJsonArtifacts(filePath)).toBe(true)
    expect(existsSync(filePath)).toBe(false)
    expect(existsSync(`${filePath}.bak`)).toBe(false)
    expect(readdirSync(root)).toEqual([])
  })

  it('reports a successful backup recovery so the UI can explain the repair', () => {
    const root = makeRoot()
    const filePath = join(root, 'settings.json')
    const recoveries: Array<{
      filePath: string
      backupPath: string
      label: string
      primaryError: Error
      reason: 'invalid-primary' | 'missing-primary'
    }> = []
    writeFileSync(filePath, '{broken-primary', 'utf8')
    writeFileSync(`${filePath}.bak`, '{"theme":"dark"}', 'utf8')

    expect(readJsonWithRecovery(filePath, '设置', { onRecovery: (details) => recoveries.push(details) }))
      .toEqual({ theme: 'dark' })
    expect(recoveries).toHaveLength(1)
    expect(recoveries[0]).toMatchObject({ filePath, backupPath: `${filePath}.bak`, label: '设置' })
    expect(recoveries[0].primaryError).toBeInstanceOf(SyntaxError)
    expect(recoveries[0].reason).toBe('invalid-primary')
  })

  it('restores a valid backup when the primary file is missing', () => {
    const root = makeRoot()
    const filePath = join(root, 'note_backup_only.json')
    const recoveries: Array<{ reason: string }> = []
    writeFileSync(`${filePath}.bak`, '{"id":"backup_only","items":[]}', 'utf8')

    expect(readJsonWithRecovery(filePath, '便签', {
      validate: (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value)),
      onRecovery: (details) => recoveries.push(details),
    })).toEqual({ id: 'backup_only', items: [] })
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({ id: 'backup_only', items: [] })
    expect(recoveries).toMatchObject([{ reason: 'missing-primary' }])
  })

  it('uses a structurally valid backup when the primary JSON has the wrong shape', () => {
    const root = makeRoot()
    const filePath = join(root, 'events.json')
    writeFileSync(filePath, '{"events":[]}', 'utf8')
    writeFileSync(`${filePath}.bak`, '[{"id":"event_ok"}]', 'utf8')

    expect(readJsonWithRecovery(filePath, '事件', { validate: Array.isArray }))
      .toEqual([{ id: 'event_ok' }])
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual([{ id: 'event_ok' }])
  })

  it('uses a business-valid backup when a parsed primary contains no recoverable records', () => {
    const root = makeRoot()
    const filePath = join(root, 'events.json')
    const validate = (require('../electron/data-validation.cjs') as {
      dataDocumentValidator: (fileName: string) => (value: unknown) => boolean
    }).dataDocumentValidator('events.json')
    writeFileSync(filePath, '[null]', 'utf8')
    writeFileSync(`${filePath}.bak`, '[{"id":"event_ok","startDate":"2025-05-01"}]', 'utf8')

    expect(readJsonWithRecovery(filePath, '事件', { validate }))
      .toEqual([{ id: 'event_ok', startDate: '2025-05-01' }])
  })

  it('loads a mixed-validity primary read-only without replacing either copy', () => {
    const root = makeRoot()
    const filePath = join(root, 'events.json')
    const primary = '[{"id":"new_event","startDate":"2025-05-02"},null]'
    const backup = '[{"id":"old_event","startDate":"2025-05-01"},{"id":"older_event","startDate":"2025-04-01"}]'
    const degradations: Array<{ reason: string; backupStatus: string }> = []
    const validate = (require('../electron/data-validation.cjs') as {
      dataDocumentValidator: (fileName: string) => (value: unknown) => boolean | {
        valid: true
        degraded: true
        reason: string
      }
    }).dataDocumentValidator('events.json')
    writeFileSync(filePath, primary, 'utf8')
    writeFileSync(`${filePath}.bak`, backup, 'utf8')

    expect(readJsonWithRecovery(filePath, '事件', {
      validate,
      onDegraded: (details) => degradations.push(details),
    })).toEqual([{ id: 'new_event', startDate: '2025-05-02' }, null])
    expect(degradations).toMatchObject([{ reason: 'degraded-primary', backupStatus: 'valid' }])
    expect(readFileSync(filePath, 'utf8')).toBe(primary)
    expect(readFileSync(`${filePath}.bak`, 'utf8')).toBe(backup)
  })

  it('returns a degraded backup without writing it over an invalid primary', () => {
    const root = makeRoot()
    const filePath = join(root, 'reminder-history.json')
    const primary = '[null]'
    const backup = '[{"id":"reminder_1","eventId":"event_1","startDate":"2025-05-01","firedAt":"2025-05-01T01:00:00.000Z"},null]'
    const degradations: Array<{ reason: string }> = []
    const validate = (require('../electron/data-validation.cjs') as {
      dataDocumentValidator: (fileName: string) => (value: unknown) => boolean | {
        valid: true
        degraded: true
        reason: string
      }
    }).dataDocumentValidator('reminder-history.json')
    writeFileSync(filePath, primary, 'utf8')
    writeFileSync(`${filePath}.bak`, backup, 'utf8')

    expect(readJsonWithRecovery(filePath, '提醒历史', {
      validate,
      onDegraded: (details) => degradations.push(details),
    })).toEqual([
      { id: 'reminder_1', eventId: 'event_1', startDate: '2025-05-01', firedAt: '2025-05-01T01:00:00.000Z' },
      null,
    ])
    expect(degradations).toMatchObject([{ reason: 'degraded-backup' }])
    expect(readFileSync(filePath, 'utf8')).toBe(primary)
    expect(readFileSync(`${filePath}.bak`, 'utf8')).toBe(backup)
  })

  it('returns a valid backup even when repairing the main file fails', () => {
    const root = makeRoot()
    const filePath = join(root, 'note_note_1.json')
    const recoveries: Array<{ writeError?: Error }> = []
    writeFileSync(filePath, '{"id":"note_1"}', 'utf8')
    writeFileSync(`${filePath}.bak`, '{"id":"note_1","items":[]}', 'utf8')
    const validate = (require('../electron/data-validation.cjs') as {
      dataDocumentValidator: (fileName: string) => (value: unknown) => boolean
    }).dataDocumentValidator('note_note_1.json')
    const failingFs = {
      ...nodeFs,
      renameSync: () => { throw new Error('disk is read-only') },
    } as typeof nodeFs

    expect(readJsonWithRecovery(filePath, '便签', {
      fs: failingFs,
      validate,
      onRecovery: (details) => recoveries.push(details),
    })).toEqual({ id: 'note_1', items: [] })
    expect(recoveries[0]?.writeError?.message).toBe('disk is read-only')
    expect(readFileSync(filePath, 'utf8')).toBe('{"id":"note_1"}')
    expect(readFileSync(`${filePath}.bak`, 'utf8')).toBe('{"id":"note_1","items":[]}')
  })

  it('keeps both damaged files untouched when neither copy can be parsed', () => {
    const root = makeRoot()
    const filePath = join(root, 'tags.json')
    writeFileSync(filePath, '{broken-primary', 'utf8')
    writeFileSync(`${filePath}.bak`, '{broken-backup', 'utf8')

    expect(() => readJsonWithRecovery(filePath, 'tags')).toThrow(/及其备份均无法读取/)
    expect(readFileSync(filePath, 'utf8')).toBe('{broken-primary')
    expect(readFileSync(`${filePath}.bak`, 'utf8')).toBe('{broken-backup')
  })

  it('keeps structurally invalid primary and backup files untouched', () => {
    const root = makeRoot()
    const filePath = join(root, 'tags.json')
    writeFileSync(filePath, '{"tags":[]}', 'utf8')
    writeFileSync(`${filePath}.bak`, 'null', 'utf8')

    expect(() => readJsonWithRecovery(filePath, '标签', { validate: Array.isArray }))
      .toThrow(/及其备份均无法读取/)
    expect(readFileSync(filePath, 'utf8')).toBe('{"tags":[]}')
    expect(readFileSync(`${filePath}.bak`, 'utf8')).toBe('null')
  })
})
