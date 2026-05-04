// Remove unused Electron locale files, keep only zh-CN
const fs = require('fs');
const path = require('path');

exports.default = async function (context) {
  const localesDir = path.join(context.appOutDir, 'locales');
  if (!fs.existsSync(localesDir)) return;

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
