const fs = require('fs');
const path = require('path');

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function writeFileAtomic(filePath, contents, options = {}) {
  const io = options.fs || fs;
  const pathApi = options.path || path;
  const processId = options.processId || process.pid;
  const targetDir = pathApi.dirname(filePath);
  const tempPath = pathApi.join(
    targetDir,
    `.${pathApi.basename(filePath)}.${processId}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );

  io.mkdirSync(targetDir, { recursive: true });
  try {
    const handle = io.openSync(tempPath, 'w');
    try {
      io.writeFileSync(handle, contents);
      io.fsyncSync(handle);
    } finally {
      io.closeSync(handle);
    }
    io.renameSync(tempPath, filePath);
  } finally {
    try { if (io.existsSync(tempPath)) io.unlinkSync(tempPath); } catch {}
  }
}

function writeJsonAtomic(filePath, value, preserveBackup = true, options = {}) {
  const io = options.fs || fs;
  const backupPath = `${filePath}.bak`;
  const serialized = `${JSON.stringify(value, null, 2)}\n`;

  if (preserveBackup && io.existsSync(filePath)) {
    io.mkdirSync(path.dirname(backupPath), { recursive: true });
    io.copyFileSync(filePath, backupPath);
  }
  writeFileAtomic(filePath, serialized, options);
  return true;
}

function readJsonWithRecovery(filePath, label = path.basename(filePath), options = {}) {
  const io = options.fs || fs;
  if (!io.existsSync(filePath)) return null;

  try {
    return JSON.parse(io.readFileSync(filePath, 'utf8'));
  } catch (primaryError) {
    const backupPath = `${filePath}.bak`;
    if (!io.existsSync(backupPath)) {
      throw new Error(`${label} 无法读取：${primaryError.message}`);
    }
    try {
      const recovered = JSON.parse(io.readFileSync(backupPath, 'utf8'));
      writeJsonAtomic(filePath, recovered, false, options);
      return recovered;
    } catch (backupError) {
      throw new Error(`${label} 及其备份均无法读取：${backupError.message}`);
    }
  }
}

function removeJsonArtifacts(filePath, options = {}) {
  const io = options.fs || fs;
  for (const target of [filePath, `${filePath}.bak`]) {
    if (io.existsSync(target)) io.unlinkSync(target);
  }
  return true;
}

module.exports = {
  isPlainRecord,
  readJsonWithRecovery,
  removeJsonArtifacts,
  writeFileAtomic,
  writeJsonAtomic,
};
