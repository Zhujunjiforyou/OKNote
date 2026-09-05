import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { default: afterPack } = require('../scripts/afterPack.cjs') as {
  default: (context: { appOutDir: string }) => Promise<void>
}
const directories: string[] = []

function runtime(locales: Record<string, string> | null) {
  const appOutDir = mkdtempSync(join(tmpdir(), 'oknote-after-pack-'))
  directories.push(appOutDir)
  for (const name of ['icudtl.dat', 'resources.pak', 'chrome_100_percent.pak',
    'chrome_200_percent.pak', 'snapshot_blob.bin', 'v8_context_snapshot.bin']) {
    writeFileSync(join(appOutDir, name), `fixture:${name}`)
  }
  if (locales !== null) {
    mkdirSync(join(appOutDir, 'locales'))
    for (const [name, content] of Object.entries(locales)) {
      writeFileSync(join(appOutDir, 'locales', name), content)
    }
  }
  return appOutDir
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Windows package runtime validation', () => {
  it.each([null, {}])('blocks a missing or empty locales directory', async (locales) => {
    await expect(afterPack({ appOutDir: runtime(locales) })).rejects.toThrow('locales/zh-CN.pak, locales/en-US.pak')
  })

  it.each(['zh-CN.pak', 'en-US.pak'])('blocks a missing %s before trimming any files', async (missing) => {
    const locales: Record<string, string> = { 'zh-CN.pak': 'Chinese', 'en-US.pak': 'English', 'fr.pak': 'French' }
    delete locales[missing]
    const appOutDir = runtime(locales)
    await expect(afterPack({ appOutDir })).rejects.toThrow(`locales/${missing}`)
    expect(readFileSync(join(appOutDir, 'locales', 'fr.pak'), 'utf8')).toBe('French')
  })

  it('blocks a zero-byte language resource', async () => {
    const appOutDir = runtime({ 'zh-CN.pak': '', 'en-US.pak': 'English' })
    await expect(afterPack({ appOutDir })).rejects.toThrow('locales/zh-CN.pak')
  })

  it('blocks a missing core runtime resource', async () => {
    const appOutDir = runtime({ 'zh-CN.pak': 'Chinese', 'en-US.pak': 'English' })
    rmSync(join(appOutDir, 'icudtl.dat'))
    await expect(afterPack({ appOutDir })).rejects.toThrow('icudtl.dat')
  })

  it('preserves both required locales and removes only unused locales', async () => {
    const appOutDir = runtime({ 'zh-CN.pak': 'Chinese', 'en-US.pak': 'English', 'fr.pak': 'French' })
    await afterPack({ appOutDir })
    expect(readdirSync(join(appOutDir, 'locales')).sort()).toEqual(['en-US.pak', 'zh-CN.pak'])
    expect(readFileSync(join(appOutDir, 'locales', 'zh-CN.pak'), 'utf8')).toBe('Chinese')
    expect(readFileSync(join(appOutDir, 'locales', 'en-US.pak'), 'utf8')).toBe('English')
  })
})
