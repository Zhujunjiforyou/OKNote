const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { writeJsonAtomic } = require('./json-store.cjs');

function copyMissingRecursive(source, destination) {
  if (!fs.existsSync(source)) return;
  if (fs.statSync(source).isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const name of fs.readdirSync(source)) {
      copyMissingRecursive(path.join(source, name), path.join(destination, name));
    }
    return;
  }
  if (fs.existsSync(destination)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
}

function migrateUserData(fromDir, toDir, onError = () => {}, sourceId) {
  if (!fromDir || !toDir || path.resolve(fromDir).toLowerCase() === path.resolve(toDir).toLowerCase()
    || !fs.existsSync(fromDir)) return;
  const identity = sourceId || path.resolve(fromDir).toLowerCase();
  const receipt = path.join(toDir, '.legacy-imports', `${createHash('sha256').update(identity).digest('hex')}.json`);
  try {
    if (fs.existsSync(receipt)) {
      const previous = JSON.parse(fs.readFileSync(receipt, 'utf8'));
      if (previous.sourceId !== identity || previous.complete !== true) throw new Error('Invalid legacy import receipt');
      return; // Do not resurrect files deleted after a successful import.
    }
  } catch (error) { onError('legacy import receipt', error); return; }
  let complete = true;
  // Keep root backups and the old OS profile key with their data. Never replace
  // a destination file (including a newer primary, backup or Local State).
  for (const name of ['Local State', '.legacy-imports', 'settings.json', 'settings.json.bak', 'window-bounds.json', 'window-bounds.json.bak', 'data', 'Local Storage']) {
    try { copyMissingRecursive(path.join(fromDir, name), path.join(toDir, name)); }
    catch (error) { complete = false; onError(name, error); }
  }
  if (complete) {
    try { writeJsonAtomic(receipt, { sourceId: identity, complete: true }, false); }
    catch (error) { onError('legacy import receipt', error); }
  }
}

module.exports = { migrateUserData };
