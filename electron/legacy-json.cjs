// Read-only compatibility for a withdrawn local format. New writes are plain JSON.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isPlainRecord } = require('./data-rules.cjs');

function isLegacyJsonEnvelope(value) {
  return isPlainRecord(value) && Object.prototype.hasOwnProperty.call(value, '__oknoteEncrypted');
}

function decodeLegacyJson(value, decryptPayload) {
  if (!isLegacyJsonEnvelope(value)) return { value, legacy: false };
  if (value.__oknoteEncrypted !== 'oknote-safe-storage' || value.version !== 1) {
    throw new Error('不支持的旧版本本地数据格式；原文件已保留');
  }
  const payload = value.payload;
  if (typeof payload !== 'string' || !payload || payload.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) {
    throw new Error('旧版本本地数据内容无效；原文件已保留');
  }
  const bytes = Buffer.from(payload, 'base64');
  if (bytes.toString('base64') !== payload) throw new Error('旧版本本地数据编码无效');
  // Electron opens the existing profile's OS key after app.whenReady(). This is
  // needed only to read old files; do not add an encryption/write counterpart.
  const decrypt = decryptPayload || ((buffer) => require('electron').safeStorage.decryptString(buffer));
  return { value: JSON.parse(decrypt(bytes)), legacy: true };
}

function containsLegacyJson(contents) {
  try { return isLegacyJsonEnvelope(JSON.parse(contents)); } catch { return false; }
}

function preserveLegacyJson(filePath, contents, options = {}) {
  if (!containsLegacyJson(contents)) return;
  const io = options.fs || fs;
  const fingerprint = crypto.createHash('sha256').update(contents).digest('hex');
  const archivePath = path.join(path.dirname(filePath), '.legacy-json', `${path.basename(filePath)}.${fingerprint}.original`);
  io.mkdirSync(path.dirname(archivePath), { recursive: true });
  if (io.existsSync(archivePath)) {
    if (io.readFileSync(archivePath, 'utf8') !== contents) throw new Error('旧数据原件备份不一致，已停止转换');
    return;
  }
  const handle = io.openSync(archivePath, 'wx');
  try {
    io.writeFileSync(handle, contents);
    io.fsyncSync(handle);
  } finally {
    io.closeSync(handle);
  }
}

function listLegacyJsonFiles(userDataDir) {
  const candidates = new Set();
  for (const name of ['settings.json', 'window-bounds.json']) candidates.add(path.join(userDataDir, name));
  for (const directory of [path.join(userDataDir, 'data'), path.join(userDataDir, 'data', '.trash')]) {
    if (!fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isFile() && /^[a-zA-Z0-9_.-]+\.json(\.bak)?$/.test(entry.name)) {
        candidates.add(path.join(directory, entry.name.replace(/\.bak$/, '')));
      }
    }
  }
  return [...candidates].filter((filePath) => [filePath, `${filePath}.bak`].some((candidate) => {
    try { return containsLegacyJson(fs.readFileSync(candidate, 'utf8')); } catch { return false; }
  }));
}

module.exports = { containsLegacyJson, decodeLegacyJson, listLegacyJsonFiles, preserveLegacyJson };
