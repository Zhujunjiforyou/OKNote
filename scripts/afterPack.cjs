// Validate each platform's runtime layout before producing a distributable.
const fs = require('fs');
const path = require('path');

exports.default = async function (context) {
  if (context.electronPlatformName === 'darwin') {
    const appName = context.packager.appInfo.productFilename;
    const contents = path.join(context.appOutDir, `${appName}.app`, 'Contents');
    const framework = 'Frameworks/Electron Framework.framework/Versions/A';
    const required = ['Info.plist', `MacOS/${appName}`, 'Resources/app.asar',
      `${framework}/Electron Framework`, `${framework}/Resources/icudtl.dat`, `${framework}/Resources/resources.pak`];
    const missing = required.filter((name) => {
      try { const file = fs.statSync(path.join(contents, name)); return !file.isFile() || file.size === 0; }
      catch { return true; }
    });
    if (missing.length) throw new Error(`macOS Electron runtime is incomplete: ${missing.join(', ')}`);
    const arch = typeof context.arch === 'string' ? context.arch : require('builder-util').Arch[context.arch];
    const nativeModule = require('./build-macos-native.cjs').buildMacNative(arch);
    const nativeDir = path.join(contents, 'Resources', 'native');
    fs.mkdirSync(nativeDir, { recursive: true });
    fs.copyFileSync(nativeModule, path.join(nativeDir, 'desktop-window.node'));
    // macOS resources and locale bundles live in Frameworks; keep the framework
    // intact, including symlinks, instead of applying the Windows locale trim.
    console.log('  • verified macOS app and Electron framework');
    return;
  }
  const requiredFiles = [
    'icudtl.dat',
    'resources.pak',
    'chrome_100_percent.pak',
    'chrome_200_percent.pak',
    'snapshot_blob.bin',
    'v8_context_snapshot.bin',
    'locales/zh-CN.pak',
    'locales/en-US.pak',
  ];
  const missing = requiredFiles.filter((name) => {
    try {
      const file = fs.statSync(path.join(context.appOutDir, name));
      return !file.isFile() || file.size === 0;
    } catch {
      return true;
    }
  });
  if (missing.length > 0) {
    throw new Error(`Electron runtime is incomplete: ${missing.join(', ')}. Restore the complete Electron distribution before packaging.`);
  }

  const localesDir = path.join(context.appOutDir, 'locales');

  const keep = new Set(['zh-CN.pak', 'en-US.pak']);
  const files = fs.readdirSync(localesDir);
  let removed = 0;
  for (const f of files) {
    if (!keep.has(f)) {
      fs.unlinkSync(path.join(localesDir, f));
      removed++;
    }
  }
  console.log(`  • removed ${removed} unused locale files`);
};
