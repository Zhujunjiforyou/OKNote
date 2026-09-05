const fs = require('fs');
const path = require('path');

const { isPlainRecord } = require('./data-rules.cjs');
const { containsLegacyJson, decodeLegacyJson, preserveLegacyJson } = require('./legacy-json.cjs');
const pendingLegacyMigrations = new Set();

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
  const pathApi = options.path || path;
  const backupPath = `${filePath}.bak`;
  const serialized = `${JSON.stringify(value, null, 2)}\n`;

  if (preserveBackup && io.existsSync(filePath)) {
    io.mkdirSync(pathApi.dirname(backupPath), { recursive: true });
    io.copyFileSync(filePath, backupPath);
  }
  writeFileAtomic(filePath, serialized, options);
  return true;
}

function parseValidatedJson(contents, sourceLabel, options) {
  const { value, legacy } = decodeLegacyJson(JSON.parse(contents), options.decryptLegacyPayload);
  if (typeof options.validate !== 'function') return { value, validation: true, legacy, contents };

  let validation;
  try {
    validation = options.validate(value);
  } catch (error) {
    throw new Error(`${sourceLabel}结构校验失败：${error && error.message ? error.message : String(error)}`);
  }
  const accepted = validation === true
    || (isPlainRecord(validation) && validation.valid === true);
  if (!accepted) throw new Error(`${sourceLabel}结构无效`);
  return { value, validation, legacy, contents };
}

function isDegradedValidation(validation) {
  return isPlainRecord(validation)
    && validation.valid === true
    && validation.degraded === true;
}

function notifyObserver(observer, details, warningLabel) {
  if (typeof observer !== 'function') return;
  try {
    observer(details);
  } catch (callbackError) {
    console.warn(`${warningLabel} observer failed:`, callbackError);
  }
}

function migrateLegacyCopies(filePath, label, primary, options) {
  const io = options.fs || fs;
  const backupPath = `${filePath}.bak`;
  const copies = primary.legacy ? [{ filePath, ...primary }] : [];
  let writeError;
  try {
    if (io.existsSync(backupPath)) {
      const contents = io.readFileSync(backupPath, 'utf8');
      if (containsLegacyJson(contents)) {
        // Archive even an unreadable old backup before any ordinary save can
        // rotate it. Never select it over a valid, more recent primary.
        preserveLegacyJson(backupPath, contents, options);
        const backup = parseValidatedJson(contents, `${label} 备份`, options);
        if (isDegradedValidation(backup.validation)) throw new Error('旧版本备份包含损坏记录，转换暂缓');
        copies.push({ filePath: backupPath, ...backup });
      }
    }
    for (const copy of copies) preserveLegacyJson(copy.filePath, copy.contents, options);
    for (const copy of copies) writeJsonAtomic(copy.filePath, copy.value, false, options);
    pendingLegacyMigrations.delete(filePath);
  } catch (error) {
    writeError = error;
    pendingLegacyMigrations.add(filePath);
  }
  if (copies.length || writeError) notifyObserver(options.onRecovery, {
    filePath, backupPath, label, reason: 'legacy-format', ...(writeError ? { writeError } : {}),
  }, label);
}

function readJsonWithRecovery(filePath, label = path.basename(filePath), options = {}) {
  const io = options.fs || fs;
  const backupPath = `${filePath}.bak`;
  const primaryExists = io.existsSync(filePath);
  const backupExists = io.existsSync(backupPath);
  if (!primaryExists && !backupExists) return null;

  let primaryError;
  let primaryContents;
  if (primaryExists) {
    try {
      primaryContents = io.readFileSync(filePath, 'utf8');
      const primary = parseValidatedJson(primaryContents, `${label} 主文件`, options);
      if (!isDegradedValidation(primary.validation)) {
        if (primary.legacy || options.migrateLegacyBackup || pendingLegacyMigrations.has(filePath)) {
          migrateLegacyCopies(filePath, label, primary, options);
        }
        return primary.value;
      }

      let backupStatus = backupExists ? 'invalid' : 'missing';
      let backupError;
      if (backupExists) {
        try {
          const backup = parseValidatedJson(io.readFileSync(backupPath, 'utf8'), `${label} 备份`, options);
          backupStatus = isDegradedValidation(backup.validation) ? 'degraded' : 'valid';
        } catch (error) {
          backupError = error;
        }
      }
      notifyObserver(options.onDegraded, {
        filePath,
        backupPath,
        label,
        reason: 'degraded-primary',
        validation: primary.validation,
        backupStatus,
        ...(backupError ? { backupError } : {}),
      }, label);
      return primary.value;
    } catch (error) {
      primaryError = error;
    }
  } else {
    primaryError = new Error(`${label} 主文件不存在`);
  }

  if (!backupExists) throw new Error(`${label} 无法读取：${primaryError.message}`);

  let recovered;
  try {
    recovered = parseValidatedJson(io.readFileSync(backupPath, 'utf8'), `${label} 备份`, options);
  } catch (backupError) {
    throw new Error(`${label} 及其备份均无法读取：${backupError.message}`);
  }

  if (isDegradedValidation(recovered.validation)) {
    notifyObserver(options.onDegraded, {
      filePath,
      backupPath,
      label,
      primaryError,
      reason: 'degraded-backup',
      validation: recovered.validation,
      backupStatus: 'degraded',
    }, label);
    return recovered.value;
  }

  // A valid backup is still useful when the main file cannot currently be
  // replaced (read-only disk, no space, file lock). Keep parsing and repair as
  // separate failure domains so callers can display the recovered data while
  // retaining write protection until the repair succeeds.
  let writeError;
  try {
    if (primaryContents) preserveLegacyJson(filePath, primaryContents, options);
    if (recovered.legacy) preserveLegacyJson(backupPath, recovered.contents, options);
    writeJsonAtomic(filePath, recovered.value, false, options);
    if (recovered.legacy) writeJsonAtomic(backupPath, recovered.value, false, options);
    pendingLegacyMigrations.delete(filePath);
  } catch (error) {
    writeError = error;
    if (recovered.legacy) pendingLegacyMigrations.add(filePath);
  }
  notifyObserver(options.onRecovery, {
    filePath,
    backupPath,
    label,
    primaryError,
    reason: primaryExists ? 'invalid-primary' : 'missing-primary',
    ...(writeError ? { writeError } : {}),
  }, label);
  return recovered.value;
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
