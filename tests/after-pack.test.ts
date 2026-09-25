import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { default: afterPack } = require('../scripts/afterPack.cjs') as {
  default: (context: { appOutDir: string; electronPlatformName?: string; arch?: string; packager?: { appInfo: { productFilename: string } } }) => Promise<void>
}
const nativeBuilder = require('../scripts/build-macos-native.cjs') as { buildMacNative: (arch: string) => string }
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
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('macOS package runtime validation', () => {
  function macRuntime(arch = 'arm64') {
    const appOutDir = mkdtempSync(join(tmpdir(), 'oknote-mac-pack-'))
    directories.push(appOutDir)
    const contents = join(appOutDir, 'OKNote.app', 'Contents')
    for (const name of ['Info.plist', 'MacOS/OKNote', 'Resources/app.asar',
      'Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
      'Frameworks/Electron Framework.framework/Versions/A/Resources/icudtl.dat',
      'Frameworks/Electron Framework.framework/Versions/A/Resources/resources.pak',
      'Frameworks/Electron Framework.framework/Versions/A/Resources/fr.lproj/locale.pak']) {
      const file = join(contents, name)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, `fixture:${name}`)
    }
    return { appOutDir, electronPlatformName: 'darwin', arch, packager: { appInfo: { productFilename: 'OKNote' } } }
  }

  it.each(['arm64', 'x64'])('keeps the Mac framework and includes the %s native window module', async (arch) => {
    const context = macRuntime(arch)
    const fixture = join(context.appOutDir, 'fixture.node')
    writeFileSync(fixture, `native:${arch}`)
    const build = vi.spyOn(nativeBuilder, 'buildMacNative').mockReturnValue(fixture)
    await afterPack(context)
    const resource = join(context.appOutDir, 'OKNote.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/fr.lproj/locale.pak')
    expect(readFileSync(resource, 'utf8')).toContain('fixture:')
    expect(build).toHaveBeenCalledWith(arch)
    expect(readFileSync(join(context.appOutDir, 'OKNote.app/Contents/Resources/native/desktop-window.node'), 'utf8')).toBe(`native:${arch}`)
  })

  it('blocks packaging when the native window module cannot be built', async () => {
    vi.spyOn(nativeBuilder, 'buildMacNative').mockImplementation(() => { throw new Error('native build failed') })
    await expect(afterPack(macRuntime())).rejects.toThrow('native build failed')
  })

  it('rejects a missing Mac runtime before creating an archive', async () => {
    const context = macRuntime()
    rmSync(join(context.appOutDir, 'OKNote.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/icudtl.dat'))
    await expect(afterPack(context)).rejects.toThrow('macOS Electron runtime is incomplete')
  })
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
