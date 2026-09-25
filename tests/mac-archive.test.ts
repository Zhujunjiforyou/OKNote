import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createMacArchive, verifyMacArchive } = require('../scripts/lib/mac-archive.cjs')
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'oknote-mac-archive-'))
  roots.push(root)
  const app = join(root, 'OKNote.app')
  const contents = join(app, 'Contents')
  const framework = join(contents, 'Frameworks/Electron Framework.framework')
  const binary = Buffer.alloc(32)
  binary.writeUInt32LE(0xfeedfacf, 0)
  binary.writeUInt32LE(0x0100000c, 4)
  const icon = Buffer.from('69636e7300000008', 'hex')
  const put = (name: string, data: string | Buffer) => {
    const file = join(contents, name)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, data)
  }
  put('MacOS/OKNote', binary)
  put('Info.plist', '<plist><dict><key>CFBundleIdentifier</key><string>com.oknote.app</string><key>CFBundleExecutable</key><string>OKNote</string><key>CFBundleIconFile</key><string>app.icns</string></dict></plist>')
  put('Resources/app.icns', icon)
  put('Resources/app.asar', 'application fixture')
  put('Resources/icons/app.ico', 'icon fixture')
  put('Resources/icons/trayTemplate@2x.png', 'tray fixture')
  put('Frameworks/Electron Framework.framework/Versions/A/Electron Framework', binary)
  put('Frameworks/Electron Framework.framework/Versions/A/Resources/icudtl.dat', 'runtime fixture')
  symlinkSync('A', join(framework, 'Versions/Current'), 'dir')
  symlinkSync('Versions/Current/Electron Framework', join(framework, 'Electron Framework'), 'file')
  symlinkSync('Versions/Current/Resources', join(framework, 'Resources'), 'dir')
  return { root, app, zip: join(root, 'preview.zip'), icon }
}

describe('portable Mac app archives', () => {
  it('round-trips executable modes and relative framework links on Windows too', async () => {
    const data = fixture()
    await createMacArchive(data.app, data.zip)
    const result = await verifyMacArchive(data.zip, 'arm64', { icon: data.icon })
    expect(result.frameworkLinksPreserved).toBe(true)
    expect(result.executableCount).toBe(1)
    expect(result.iconMatchesSource).toBe(true)
    expect(result.runtimeTestedOnMac).toBe(false)
    await expect(verifyMacArchive(data.zip, 'x64')).rejects.toThrow('Wrong Mach-O architecture')
  })

  it('rejects a stale icon instead of validating any unrelated ICNS', async () => {
    const data = fixture()
    await createMacArchive(data.app, data.zip)
    await expect(verifyMacArchive(data.zip, 'arm64', { icon: Buffer.from('different icon') })).rejects.toThrow('differs from the current source')
  })

  it('refuses links escaping the .app so unrelated files cannot be shipped', async () => {
    const data = fixture()
    writeFileSync(join(data.root, 'outside.txt'), 'must not be packaged')
    symlinkSync('../outside.txt', join(data.app, 'outside-link'), 'file')
    await expect(createMacArchive(data.app, data.zip)).rejects.toThrow('Link escapes app')
    expect(existsSync(data.zip)).toBe(false)
  })
})
