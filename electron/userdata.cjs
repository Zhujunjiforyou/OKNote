const path = require('path');
const fs = require('fs');

function samePath(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function ensureWritableDir(dir) {
  const probe = path.join(dir, `.oknote-write-test-${Date.now()}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(probe, 'ok', 'utf-8');
    fs.unlinkSync(probe);
    return true;
  } catch (e) {
    try { if (fs.existsSync(probe)) fs.unlinkSync(probe); } catch {}
    console.error('ensureWritableDir failed:', dir, e.message);
    return false;
  }
}

function copyMissingRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyMissingRecursive(path.join(src, name), path.join(dest, name));
    }
    return;
  }
  if (fs.existsSync(dest)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function migrateUserData(fromDir, toDir) {
  if (!fromDir || !toDir || samePath(fromDir, toDir) || !fs.existsSync(fromDir)) return;
  for (const name of ['settings.json', 'window-bounds.json', 'data', 'Local Storage']) {
    try {
      copyMissingRecursive(path.join(fromDir, name), path.join(toDir, name));
    } catch (e) {
      console.error('migrateUserData failed:', name, e.message);
    }
  }
}

module.exports = { ensureWritableDir, copyMissingRecursive, migrateUserData, samePath };
