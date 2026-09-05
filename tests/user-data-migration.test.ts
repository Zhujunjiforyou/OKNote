import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { migrateUserData } = require('../electron/user-data-migration.cjs') as {
  migrateUserData: (source: string, target: string, onError?: (name: string, error: Error) => void, sourceId?: string) => void
}
const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'oknote-copy-upgrade-'))
  roots.push(root)
  const source = join(root, 'old', 'user-data'), target = join(root, 'current')
  mkdirSync(source, { recursive: true })
  mkdirSync(target, { recursive: true })
  const put = (base: string, name: string, content: string) => {
    mkdirSync(join(base, name, '..'), { recursive: true })
    writeFileSync(join(base, name), content)
  }
  return { source, target, put }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('old installation user-data migration', () => {
  it('copies backup-only settings, bounds and notes, including trash and profile key, without changing originals', () => {
    const { source, target, put } = fixture()
    const names = ['settings.json.bak', 'window-bounds.json.bak', 'data/note_old.json.bak',
      'data/events.json', 'data/events.json.bak', 'data/.trash/trash_old.json', 'Local State', 'Local Storage/leveldb/000001.log']
    for (const name of names) put(source, name, `old:${name}`)
    migrateUserData(source, target)
    for (const name of names) {
      expect(readFileSync(join(target, name), 'utf8')).toBe(`old:${name}`)
      expect(readFileSync(join(source, name), 'utf8')).toBe(`old:${name}`)
    }
  })

  it('never overwrites current files or resurrects an older events snapshot on repeated copies', () => {
    const { source, target, put } = fixture()
    for (const name of ['settings.json', 'settings.json.bak', 'data/events.json', 'data/events.json.bak', 'Local State']) {
      put(source, name, 'old')
      put(target, name, 'current')
    }
    migrateUserData(source, target)
    migrateUserData(source, target)
    for (const name of ['settings.json', 'settings.json.bak', 'data/events.json', 'data/events.json.bak', 'Local State']) {
      expect(readFileSync(join(target, name), 'utf8')).toBe('current')
    }
  })

  it('reports failed families, preserves sources and continues copying independent files', () => {
    const { source, target, put } = fixture()
    put(source, 'data/events.json', 'old events')
    put(target, 'data', 'not a directory')
    put(source, 'settings.json.bak', 'recoverable settings')
    const failures: string[] = []
    migrateUserData(source, target, name => failures.push(name))
    expect(failures).toEqual(['data'])
    expect(readFileSync(join(source, 'data/events.json'), 'utf8')).toBe('old events')
    expect(readFileSync(join(target, 'settings.json.bak'), 'utf8')).toBe('recoverable settings')
    rmSync(join(target, 'data'))
    migrateUserData(source, target)
    expect(readFileSync(join(target, 'data/events.json'), 'utf8')).toBe('old events')
  })

  it('does not re-import deleted notes after restart or an install-directory change', () => {
    const { source, target, put } = fixture()
    put(source, 'data/note_old.json', 'old note')
    migrateUserData(source, target, undefined, 'installation')
    rmSync(join(target, 'data/note_old.json'))
    const moved = join(source, '..', '..', 'new-install', 'user-data')
    put(moved, 'data/note_old.json', 'old note')
    migrateUserData(moved, target, undefined, 'installation')
    expect(() => readFileSync(join(target, 'data/note_old.json'))).toThrow()
    expect(readFileSync(join(moved, 'data/note_old.json'), 'utf8')).toBe('old note')
  })
})
