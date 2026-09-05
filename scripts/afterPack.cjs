// Validate the Windows runtime before producing an installer, then trim locales.
const fs = require('fs');
const path = require('path');

exports.default = async function (context) {
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
