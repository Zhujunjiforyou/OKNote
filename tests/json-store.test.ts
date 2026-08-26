import { createRequire } from 'node:module'
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
  readJsonWithRecovery: (filePath: string, label?: string) => unknown
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

  it('keeps both damaged files untouched when neither copy can be parsed', () => {
    const root = makeRoot()
    const filePath = join(root, 'tags.json')
    writeFileSync(filePath, '{broken-primary', 'utf8')
    writeFileSync(`${filePath}.bak`, '{broken-backup', 'utf8')

    expect(() => readJsonWithRecovery(filePath, 'tags')).toThrow(/及其备份均无法读取/)
    expect(readFileSync(filePath, 'utf8')).toBe('{broken-primary')
    expect(readFileSync(`${filePath}.bak`, 'utf8')).toBe('{broken-backup')
  })
})
