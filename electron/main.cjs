const { app, BrowserWindow, Tray, Menu, Notification, dialog, nativeImage, ipcMain, screen, session } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { exec } = require('child_process');
const { pathToFileURL } = require('url');
const { createFullTidyRegion, createPreferredTidyRegions, packTidyItemsResponsive } = require('./tidy-layout.cjs');
const {
  isPlainRecord,
  readJsonWithRecovery,
  removeJsonArtifacts,
  writeFileAtomic,
  writeJsonAtomic,
} = require('./json-store.cjs');
const { collectDueReminders, eventStartMillis } = require('./reminder-reliability.cjs');
const {
  expandReminderEventsForDueWindow,
  normalizeReminderEvents,
  normalizeReminderHistory,
} = require('./reminder-data.cjs');
const { hasRevisionConflict } = require('./event-concurrency.cjs');
const { eventsByTag } = require('./event-query.cjs');
const { sanitizeTagPayload, sanitizeEventPayload } = require('./event-payload.cjs');
const { isDateKey, isSafeIdentifier, safeHexColor } = require('./data-rules.cjs');
const { clampFontSetting, safeFontFamily, normalizeWindowSettings, sanitizeSettingChange } = require('./settings-rules.cjs');
const { listLegacyJsonFiles } = require('./legacy-json.cjs');
const { migrateUserData: copyLegacyUserData } = require('./user-data-migration.cjs');
const { commitNoteSnapshot, getNoteRevision } = require('./note-persistence.cjs');
const { calendarMinimumForWorkArea, noteMinimumForWorkArea } = require('./window-constraints.cjs');
const {
  canonicalNoteFileNames,
  canonicalTrashRecordNames,
  dataDocumentValidator,
  getReadOnlyDataTargets,
  isValidTagsDocument,
  isValidTrashRecord,
} = require('./data-validation.cjs');

const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
const DEV_PORT = parseInt(process.env.VITE_PORT || '5173', 10);
const isIsolatedTestInstance = process.env.OKNOTE_SMOKE_TEST === '1' || process.env.OKNOTE_E2E_TEST === '1';
// Acquire the lock before inspecting or migrating user data. A second instance
// must never participate in migration, even briefly, before it exits.
const hasSingleInstanceLock = isIsolatedTestInstance || app.requestSingleInstanceLock();
const DEFAULT_USER_DATA_DIR = app.getPath('userData');
const INSTALL_USER_DATA_DIR = app.isPackaged ? path.join(path.dirname(process.execPath), 'user-data') : null;
const startupReliabilityIssues = [];

function queueStartupReliabilityIssue(title, message) {
  if (!startupReliabilityIssues.some((issue) => issue.title === title && issue.message === message)) {
    startupReliabilityIssues.push({ title, message });
  }
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

function migrateUserData(fromDir, toDir) {
  copyLegacyUserData(fromDir, toDir, (name, error) => {
    console.error('migrateUserData failed:', name, error.message);
    queueStartupReliabilityIssue('旧数据未完全复制', `“${name}”未能复制到当前数据目录；源数据仍保留在原位置。`);
  }, fromDir === INSTALL_USER_DATA_DIR ? 'installation' : 'default-profile');
}

function resolveUserDataDir() {
  const envDir = process.env.OKNOTE_DATA_DIR ? path.resolve(process.env.OKNOTE_DATA_DIR) : null;

  if (envDir && ensureWritableDir(envDir)) {
    if(!isIsolatedTestInstance){
      migrateUserData(DEFAULT_USER_DATA_DIR, envDir);
      migrateUserData(INSTALL_USER_DATA_DIR, envDir);
    }
    app.setPath('userData', envDir);
    return envDir;
  }

  ensureWritableDir(DEFAULT_USER_DATA_DIR);
  // v2.1 briefly stored data beside the executable. Copy only missing files
  // back to the stable user directory; existing user data always wins.
  migrateUserData(INSTALL_USER_DATA_DIR, DEFAULT_USER_DATA_DIR);
  return DEFAULT_USER_DATA_DIR;
}

const USER_DATA_DIR = hasSingleInstanceLock ? resolveUserDataDir() : DEFAULT_USER_DATA_DIR;
const BOUNDS_FILE = path.join(USER_DATA_DIR, 'window-bounds.json');

// ── Window registry ──
const winRegistry = { calendar: null, notes: {}, settings: null };
const windowDraftStates = new Map();
const windowUnsavedNoteIds = new Map();
const forceCloseWindows = new WeakSet();
const closePromptWindows = new WeakSet();
const ALLOWED_DRAFT_KINDS = new Set(['event-form', 'quick-event', 'note-title', 'new-todo', 'todo-edit', 'date-edit', 'tag-form']);
let forceAppQuit = false;
let appQuitPromptOpen = false;

function sanitizeDraftEntries(value) {
  if (!Array.isArray(value)) return [];
  const entries = [];
  const seen = new Set();
  for (const raw of value) {
    const kind = typeof raw === 'string' ? raw : (isPlainRecord(raw) ? raw.kind : null);
    if (!ALLOWED_DRAFT_KINDS.has(kind)) continue;
    const suppliedNoteId = isPlainRecord(raw) && typeof raw.noteId === 'string' ? raw.noteId : null;
    if (suppliedNoteId && !isSafeIdentifier(suppliedNoteId)) continue;
    const entry = suppliedNoteId ? { kind, noteId: suppliedNoteId } : { kind };
    const key = `${kind}:${suppliedNoteId || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
    if (entries.length >= 64) break;
  }
  return entries;
}

function getWindowDraftEntries(win) {
  if (!win || win.isDestroyed()) return [];
  return [...(windowDraftStates.get(win.webContents.id) || [])];
}

function getWindowDraftKinds(win) {
  if (!win || win.isDestroyed()) return [];
  const webContentsId = win.webContents.id;
  const kinds = getWindowDraftEntries(win).map((entry) => entry.kind);
  if ((windowUnsavedNoteIds.get(webContentsId)?.size || 0) > 0) kinds.push('unsaved-note');
  return [...new Set(kinds)];
}

function getDirtyWindows() {
  return [winRegistry.calendar, winRegistry.settings, ...Object.values(winRegistry.notes)]
    .filter((win) => win && !win.isDestroyed() && getWindowDraftKinds(win).length > 0);
}

function recordNotePersistenceResult(webContentsId, noteId, saved) {
  if (!Number.isInteger(webContentsId) || !isSafeIdentifier(noteId)) return;
  const pending = new Set(windowUnsavedNoteIds.get(webContentsId) || []);
  if (saved) pending.delete(noteId);
  else pending.add(noteId);
  if (pending.size > 0) windowUnsavedNoteIds.set(webContentsId, pending);
  else windowUnsavedNoteIds.delete(webContentsId);
}

function draftDescription(kinds) {
  const labels = {
    'event-form': '事件表单',
    'quick-event': '快速事件',
    'note-title': '便签标题',
    'new-todo': '新待办',
    'todo-edit': '待办编辑',
    'date-edit': '日期编辑',
    'tag-form': '标签表单',
    'unsaved-note': '写盘失败的便签内容',
  };
  return kinds.map((kind) => labels[kind]).filter(Boolean).join('、') || '当前窗口';
}

function confirmDiscardKinds(win, kinds, actionLabel) {
  if (kinds.length === 0) return true;
  const choice = dialog.showMessageBoxSync(win, {
    type: 'warning',
    title: '存在未保存的草稿',
    message: `${draftDescription(kinds)}尚未保存`,
    detail: `继续${actionLabel}会放弃这些输入。`,
    buttons: ['取消', `放弃并${actionLabel}`],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return choice === 1;
}

function confirmDiscardWindowDrafts(win, actionLabel) {
  return confirmDiscardKinds(win, getWindowDraftKinds(win), actionLabel);
}

function confirmDiscardNoteDrafts(noteIds, actionLabel, preferredParent = null) {
  const wanted = new Set((Array.isArray(noteIds) ? noteIds : [noteIds]).filter(isSafeIdentifier));
  if (wanted.size === 0) return true;
  const candidates = [preferredParent, winRegistry.calendar, ...Object.values(winRegistry.notes)]
    .filter((win, index, all) => win && !win.isDestroyed() && all.indexOf(win) === index);
  for (const win of candidates) {
    const kinds = getWindowDraftEntries(win)
      .filter((entry) => entry.noteId && wanted.has(entry.noteId))
      .map((entry) => entry.kind);
    const unsaved = windowUnsavedNoteIds.get(win.webContents.id);
    if (unsaved && [...wanted].some((noteId) => unsaved.has(noteId))) kinds.push('unsaved-note');
    const uniqueKinds = [...new Set(kinds)];
    const promptParent = preferredParent && !preferredParent.isDestroyed() ? preferredParent : win;
    if (uniqueKinds.length > 0 && !confirmDiscardKinds(promptParent, uniqueKinds, actionLabel)) return false;
  }
  return true;
}

function closeWindowWithoutDraftPrompt(win) {
  if (!win || win.isDestroyed()) return;
  forceCloseWindows.add(win);
  win.close();
}

function attachDraftCloseGuard(win) {
  if (!win || win.isDestroyed()) return;
  const webContentsId = win.webContents.id;
  win.on('close', (event) => {
    if (forceAppQuit || forceCloseWindows.has(win) || getWindowDraftKinds(win).length === 0) return;
    event.preventDefault();
    if (closePromptWindows.has(win)) return;
    closePromptWindows.add(win);
    try {
      if (confirmDiscardWindowDrafts(win, '关闭')) closeWindowWithoutDraftPrompt(win);
    } finally {
      closePromptWindows.delete(win);
    }
  });
  win.on('closed', () => {
    windowDraftStates.delete(webContentsId);
    windowUnsavedNoteIds.delete(webContentsId);
  });
}

function requestAppQuit() {
  if (forceAppQuit || appQuitPromptOpen) return;
  const dirtyWindows = getDirtyWindows();
  if (dirtyWindows.length > 0) {
    appQuitPromptOpen = true;
    const parent = dirtyWindows.find((win) => win.isVisible()) || winRegistry.settings || winRegistry.calendar;
    const summary = dirtyWindows.map((win) => draftDescription(getWindowDraftKinds(win))).join('；');
    const promptOptions = {
      type: 'warning',
      title: '退出前确认草稿',
      message: `有 ${dirtyWindows.length} 个窗口含未保存内容`,
      detail: `${summary}。退出后这些输入无法恢复。`,
      buttons: ['取消退出', '放弃草稿并退出'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    const choice = parent && !parent.isDestroyed()
      ? dialog.showMessageBoxSync(parent, promptOptions)
      : dialog.showMessageBoxSync(promptOptions);
    appQuitPromptOpen = false;
    if (choice !== 1) return;
  }
  forceAppQuit = true;
  app.isQuitting = true;
  setImmediate(() => app.quit());
}

// ── Settings ──
const DATA_DIR = path.join(USER_DATA_DIR, 'data');
const NOTE_TRASH_DIR = path.join(DATA_DIR, '.trash');
const settingsPath = path.join(USER_DATA_DIR, 'settings.json');
let windowBounds = {};
let windowBoundsReadOnly = false;

function loadWindowBounds() {
  try {
    const hadStoredBounds = [BOUNDS_FILE, `${BOUNDS_FILE}.bak`].some((candidate) => fs.existsSync(candidate));
    let recoveryWriteError = null;
    const raw = readJsonWithRecovery(BOUNDS_FILE, 'window bounds', {
      validate: dataDocumentValidator('window-bounds.json'),
      onRecovery: (details) => {
        recoveryWriteError = details.writeError || null;
        if (reportLegacyJsonConversion('window-bounds.json', details)) return;
        queueStartupReliabilityIssue(
          recoveryWriteError ? '窗口布局已从备份载入（只读）' : '窗口布局已从备份恢复',
          recoveryWriteError
            ? '布局备份有效且已载入，但主布局文件写回失败；本次会话已暂停布局写入，备份原件仍保留。请检查磁盘空间、目录权限或文件占用。'
            : details.reason === 'missing-primary'
              ? '主布局文件缺失，应用已验证并恢复上一版本备份；请确认窗口位置与大小。'
              : '主布局文件内容无效，应用已验证并恢复上一版本备份；请确认窗口位置与大小。',
        );
      },
    });
    windowBoundsReadOnly = Boolean(recoveryWriteError);
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) windowBounds = raw;
    else {
      windowBounds = {};
      if (hadStoredBounds) queueStartupReliabilityIssue('窗口布局已恢复默认', '布局文件内容无效，应用已使用安全默认位置；原文件仍保留在用户数据目录。');
    }
  } catch(e) {
    console.error('loadWindowBounds failed:', e.message);
    windowBounds = {};
    windowBoundsReadOnly = true;
    queueStartupReliabilityIssue('窗口布局已恢复默认', '布局主文件与备份均无法安全读取，应用已使用安全默认位置并暂停布局写入；原文件仍保留在用户数据目录。');
  }
}
function saveWindowBounds() {
  if (windowBoundsReadOnly) return false;
  // Merge live bounds into the last persisted snapshot. Closed, hidden and
  // docked windows keep their records until the note itself is deleted.
  const b = { ...windowBounds };
  try {
    if (winRegistry.calendar && !winRegistry.calendar.isDestroyed()) {
      if (isCalendarCollapsed && calendarOriginalBounds) {
        b.calendar = { x: calendarOriginalBounds.x, y: calendarOriginalBounds.y, width: calendarOriginalBounds.width, height: calendarOriginalBounds.height };
      } else {
        b.calendar = winRegistry.calendar.getBounds();
      }
    }
  } catch(e) { console.error('saveWindowBounds calendar getBounds failed:', e.message); }
  for (const [id, w] of Object.entries(winRegistry.notes)) {
    try {
      if (!w.isDestroyed()) {
        b[id] = w.getBounds();
      }
    } catch(e) { console.error('saveWindowBounds note getBounds failed:', id, e.message); }
  }
  try {
    writeJsonAtomic(BOUNDS_FILE, b);
    windowBounds = b;
    return true;
  } catch(e) {
    console.error('saveWindowBounds failed:', e.message);
    return false;
  }
}

// ── Debounced bounds save ──
let boundsSaveTimer = null;
function debouncedSaveWindowBounds() {
  if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
  boundsSaveTimer = setTimeout(() => {
    saveWindowBounds();
    boundsSaveTimer = null;
  }, 300);
}

const perWindowDefaults = {
  fontFamily: 'Inter',
  fontSize: 14,
  backgroundColor: '#1C1C1E',
  backgroundOpacity: 0.88,
  textColor: '#F5F5F7',
};
const appearancePresets = {
  dark: { backgroundColor: '#1C1C1E', textColor: '#F5F5F7' },
  light: { backgroundColor: '#F2F2F7', textColor: '#1D1D1F' },
};
let appSettings = {
  themeMode: 'dark',
  autoLaunch: false,
  startMinimized: false,
  hideNotificationContent: false,
  globalFontFamily: 'Microsoft YaHei',
  globalFontSize: 14,
  calendar: { ...perWindowDefaults, edgeAutoHide: true, showDockArea: true },
  notes: { ...perWindowDefaults },
};
let settingsReadOnly = false;

function applyThemePreset(mode) {
  const preset = appearancePresets[mode] || appearancePresets.dark;
  appSettings.themeMode = mode === 'light' ? 'light' : 'dark';
  appSettings.calendar = { ...appSettings.calendar, ...preset };
}

function loadSettings() {
  try {
    const hadStoredSettings = [settingsPath, `${settingsPath}.bak`].some((candidate) => fs.existsSync(candidate));
    let recoveryWriteError = null;
    const raw = readJsonWithRecovery(settingsPath, 'settings', {
      validate: dataDocumentValidator('settings.json'),
      onRecovery: (details) => {
        recoveryWriteError = details.writeError || null;
        if (reportLegacyJsonConversion('settings.json', details)) return;
        queueStartupReliabilityIssue(
          recoveryWriteError ? '设置已从备份载入（只读）' : '设置已从备份恢复',
          recoveryWriteError
            ? '设置备份有效且已载入，但主设置文件写回失败；本次会话已暂停设置写入，备份原件仍保留。请检查磁盘空间、目录权限或文件占用。'
            : details.reason === 'missing-primary'
              ? '主设置文件缺失，应用已验证并恢复上一版本备份；请检查外观与启动选项。'
              : '主设置文件内容无效，应用已验证并恢复上一版本备份；请检查外观与启动选项。',
        );
      },
    });
    settingsReadOnly = Boolean(recoveryWriteError);
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      appSettings.themeMode = raw.themeMode === 'light' ? 'light' : 'dark';
      appSettings.autoLaunch = typeof raw.autoLaunch === 'boolean' ? raw.autoLaunch : false;
      appSettings.startMinimized = typeof raw.startMinimized === 'boolean' ? raw.startMinimized : false;
      appSettings.hideNotificationContent = raw.hideNotificationContent === true;
      appSettings.globalFontFamily = safeFontFamily(raw.globalFontFamily, 'Microsoft YaHei');
      appSettings.globalFontSize = clampFontSetting(raw.globalFontSize);
      appSettings.calendar = normalizeWindowSettings(raw.calendar, perWindowDefaults, true);
      appSettings.notes = normalizeWindowSettings(raw.notes, perWindowDefaults);
    } else if (hadStoredSettings) {
      queueStartupReliabilityIssue('设置已恢复默认', '设置文件内容无效，应用已使用安全默认值；原文件仍保留在用户数据目录。');
    }
  } catch (e) {
    console.error('loadSettings failed:', e.message);
    settingsReadOnly = true;
    queueStartupReliabilityIssue('设置已恢复默认', '设置主文件与备份均无法安全读取，应用已使用安全默认值并暂停设置写入；原文件仍保留在用户数据目录。');
  }
}
function saveSettings() {
  if (settingsReadOnly) return false;
  try {
    writeJsonAtomic(settingsPath, appSettings);
    return true;
  } catch (e) {
    console.error('saveSettings failed:', e.message);
    return false;
  }
}
function applyLoginItemSettings() {
  try {
    const desiredArgs = appSettings.autoLaunch && appSettings.startMinimized ? ['--hidden'] : [];
    app.setLoginItemSettings({
      openAtLogin: appSettings.autoLaunch,
      path: process.execPath,
      args: desiredArgs,
    });
    // Query the exact executable + argument registration. A generic query can
    // report openAtLogin=true even when Windows dropped the --hidden argument.
    const actual = app.getLoginItemSettings({ path: process.execPath, args: desiredArgs });
    return {
      ok: actual.openAtLogin === appSettings.autoLaunch,
      enabled: actual.openAtLogin,
      startMinimized: appSettings.startMinimized,
    };
  } catch (error) {
    console.error('applyLoginItemSettings failed:', error.message);
    return { ok: false, enabled: false, message: error.message };
  }
}
let settingsSaveTimer=null;
let settingsBroadcastTimer=null;
function scheduleSettingsCommit(){
  if(!settingsBroadcastTimer){
    settingsBroadcastTimer=setTimeout(()=>{
      settingsBroadcastTimer=null;
      broadcastSettings();
    },40);
  }
  if(settingsSaveTimer) clearTimeout(settingsSaveTimer);
  settingsSaveTimer=setTimeout(()=>{
    settingsSaveTimer=null;
    if(!saveSettings()) broadcastPersistenceFailure('设置尚未保存','磁盘写入失败，当前会话中的设置可能在重启后恢复。');
  },180);
}

// ── Data persistence (events and notes) ──
function ensureDataDir() {
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { console.error('ensureDataDir failed:', e.message); }
}
function isSafeDataFileName(fileName) {
  return typeof fileName === 'string' && fileName.length <= 220 && /^[a-zA-Z0-9_.-]+\.json$/.test(fileName);
}
function isSafeTransactionFileName(fileName) {
  return isSafeDataFileName(fileName)
    || (typeof fileName === 'string' && /^\.trash\/trash_[a-zA-Z0-9_-]{1,180}\.json$/.test(fileName));
}


function readBusinessJsonFile(filePath, label = path.basename(filePath), options = {}) {
  return readJsonWithRecovery(filePath, label, {
    ...options,
    onRecovery: (details) => {
      if (reportLegacyJsonConversion(path.basename(filePath), details)) return;
      if (typeof options.onRecovery === 'function') options.onRecovery(details);
    },
  });
}

const appDataLoadErrors = new Map();
function saveAppData(fileName, data) {
  if (!isSafeDataFileName(fileName)) return false;
  if (appDataLoadErrors.has(fileName)) {
    broadcastPersistenceFailure(
      '数据处于只读保护状态',
      `“${fileName}”尚未安全完成读取或备份恢复；已阻止写入，以保留主文件与可人工恢复的备份。`,
    );
    return false;
  }
  ensureDataDir();
  const filePath = path.join(DATA_DIR, fileName);
  try {
    return writeJsonAtomic(filePath, data, true);
  } catch (e) {
    console.error('saveAppData failed:', fileName, e.message);
    broadcastPersistenceFailure('数据未能写入磁盘',`${fileName} 保存失败。当前界面状态可能尚未持久化，请检查磁盘空间与目录权限后重试。`);
    return false;
  }
}
const reportedDataReadFailures = new Set();
const reportedDataRecoveries = new Set();
const reportedDataDegradations = new Set();
function reportLegacyJsonConversion(fileName, details) {
  if (details.reason !== 'legacy-format') return false;
  const dataKey = path.relative(DATA_DIR, details.filePath).replace(/\\/g, '/');
  if (isSafeTransactionFileName(dataKey)) {
    if (details.writeError) appDataLoadErrors.set(dataKey, details.writeError.message);
    else appDataLoadErrors.delete(dataKey);
  }
  queueStartupReliabilityIssue(
    details.writeError ? '旧版本数据已载入（只读）' : '旧版本本地数据已兼容',
    details.writeError
      ? `“${fileName}”内容已读取，但转换为普通 JSON 失败；原件仍保留，暂不允许覆盖。请检查磁盘空间、权限或文件占用。`
      : '旧格式数据已自动转换为普通本地 JSON，今后保存不使用加密；转换前原件保留在对应目录的 .legacy-json 文件夹中。',
  );
  const target = [winRegistry.calendar, winRegistry.settings, ...Object.values(winRegistry.notes)]
    .find((win) => win && !win.isDestroyed());
  if (target) deliverStartupReliabilityIssues(target);
  return true;
}

function prepareLegacyLocalData() {
  // Include unused notes and .bak files, not just records opened by a window.
  for (const filePath of listLegacyJsonFiles(USER_DATA_DIR)) {
    const fileName = path.basename(filePath);
    const dataKey = path.relative(DATA_DIR, filePath).replace(/\\/g, '/');
    try {
      readJsonWithRecovery(filePath, fileName, {
        validate: dataDocumentValidator(fileName),
        migrateLegacyBackup: true,
        onRecovery: (details) => {
          if (details.writeError && isSafeTransactionFileName(dataKey)) appDataLoadErrors.set(dataKey, details.writeError.message);
          reportDataRecovery(fileName, details);
        },
        onDegraded: (details) => {
          if (isSafeTransactionFileName(dataKey)) appDataLoadErrors.set(dataKey, '旧版本数据包含损坏记录，当前只读');
          reportDataDegradation(fileName, details);
        },
      });
    } catch (error) {
      if (isSafeTransactionFileName(dataKey)) appDataLoadErrors.set(dataKey, error.message);
      reportDataReadFailure(fileName, error);
    }
  }
}

function dataKindForFile(fileName) {
  if (fileName.startsWith('note_') || fileName === 'notes.json') return '便签';
  if (fileName === 'tags.json') return '标签';
  if (fileName === 'events.json') return '事件';
  if (fileName.startsWith('reminder-')) return '提醒数据';
  if (fileName === '__crash_log.json') return '故障记录';
  return '本地数据';
}
function reportDataRecovery(fileName, details) {
  if (reportLegacyJsonConversion(fileName, details)) return;
  const signature = `${fileName}:${details.reason}:${details.writeError ? 'write-failed' : 'restored'}`;
  if (reportedDataRecoveries.has(signature)) return;
  reportedDataRecoveries.add(signature);
  const dataKind = dataKindForFile(fileName);
  const reason = details.reason === 'missing-primary' ? '主文件缺失' : '主文件内容无效';
  queueStartupReliabilityIssue(
    details.writeError ? `${dataKind}已从备份载入（只读）` : `${dataKind}已从备份恢复`,
    details.writeError
      ? `“${fileName}”${reason}。上一版本备份有效且已载入，但主文件写回失败；备份原件仍保留，应用已暂停该文件写入。请检查磁盘空间、目录权限或文件占用。`
      : `“${fileName}”${reason}，应用已验证并恢复上一版本备份；请确认相关内容。`,
  );
  const target = [winRegistry.calendar, winRegistry.settings, ...Object.values(winRegistry.notes)]
    .find((win) => win && !win.isDestroyed());
  if (target) deliverStartupReliabilityIssues(target);
}
function reportDataDegradation(fileName, details) {
  const signature = `${fileName}:${details.reason}:${details.backupStatus || 'unknown'}`;
  if (reportedDataDegradations.has(signature)) return;
  reportedDataDegradations.add(signature);
  const dataKind = dataKindForFile(fileName);
  const source = details.reason === 'degraded-backup' ? '备份文件' : '主文件';
  const backupSummary = details.backupStatus === 'valid'
    ? '已检测到结构完整的上一版本备份'
    : details.backupStatus === 'degraded'
      ? '上一版本备份也包含需隔离的记录'
      : details.backupStatus === 'invalid'
        ? '上一版本备份无法通过结构校验'
        : '未检测到上一版本备份';
  queueStartupReliabilityIssue(
    `${dataKind}已降级为只读`,
    `“${fileName}”${source}同时包含可恢复与损坏记录；应用已隔离坏条目并显示可恢复内容。${backupSummary}。为避免覆盖较完整或可人工恢复的数据，主文件与备份均保持原样，完成修复或合并前不会写入该文件。`,
  );
  const target = [winRegistry.calendar, winRegistry.settings, ...Object.values(winRegistry.notes)]
    .find((win) => win && !win.isDestroyed());
  if (target) deliverStartupReliabilityIssues(target);
}
function reportDataReadFailure(fileName, error) {
  const signature = `${fileName}:${error && error.message ? error.message : String(error)}`;
  if (reportedDataReadFailures.has(signature)) return;
  reportedDataReadFailures.add(signature);
  const dataKind = dataKindForFile(fileName);
  const title = `${dataKind}文件无法读取`;
  const message = `“${fileName}”及其上一版本备份均无法读取。原文件已保留，应用没有用空数据覆盖；请保留数据目录并从可用备份恢复。`;
  queueStartupReliabilityIssue(title, message);
  const target = [winRegistry.calendar, winRegistry.settings, ...Object.values(winRegistry.notes)]
    .find((win) => win && !win.isDestroyed());
  if (target) deliverStartupReliabilityIssues(target);
}
function loadAppData(fileName, reportFailure = true) {
  if (!isSafeDataFileName(fileName)) return null;
  const filePath = path.join(DATA_DIR, fileName);
  try {
    let recoveryWriteError = null;
    let degradation = null;
    const value = readJsonWithRecovery(filePath, fileName, {
      validate: dataDocumentValidator(fileName),
      onRecovery: (details) => {
        recoveryWriteError = details.writeError || null;
        reportDataRecovery(fileName, details);
      },
      onDegraded: (details) => {
        degradation = details;
        reportDataDegradation(fileName, details);
      },
    });
    if (degradation) {
      const source = degradation.reason === 'degraded-backup' ? '备份' : '主文件';
      appDataLoadErrors.set(fileName, `${source}同时包含可恢复与损坏记录，当前数据只读`);
    } else if (recoveryWriteError) {
      appDataLoadErrors.set(fileName, `数据已载入，但格式转换或主文件写回失败：${recoveryWriteError.message || String(recoveryWriteError)}`);
    } else {
      appDataLoadErrors.delete(fileName);
    }
    for (const signature of reportedDataReadFailures) {
      if (signature.startsWith(`${fileName}:`)) reportedDataReadFailures.delete(signature);
    }
    return value;
  } catch (e) {
    console.error('loadAppData failed:', fileName, e.message);
    appDataLoadErrors.set(fileName, e.message);
    if (reportFailure) reportDataReadFailure(fileName, e);
  }
  return null;
}

function applyDataChanges(changes, label = 'data update') {
  if (!Array.isArray(changes) || changes.length === 0) return true;
  const seen = new Set();
  for (const change of changes) {
    if (!change || !isSafeTransactionFileName(change.fileName) || seen.has(change.fileName)) {
      throw new Error(`Invalid or duplicate data target: ${change && change.fileName}`);
    }
    seen.add(change.fileName);
  }
  const readOnlyTargets = getReadOnlyDataTargets(changes, appDataLoadErrors);
  if (readOnlyTargets.length > 0) {
    broadcastPersistenceFailure(
      '事务写入已被只读保护拦截',
      `以下数据尚未安全恢复：${readOnlyTargets.join('、')}。本次更新未写入任何目标文件，主文件与备份均已保留。`,
    );
    throw new Error(`Read-only data target(s): ${readOnlyTargets.join(', ')}`);
  }
  const snapshots = changes.map((change) => {
    const target = path.join(DATA_DIR, change.fileName);
    return {
      target,
      current: fs.existsSync(target) ? fs.readFileSync(target) : null,
      backup: fs.existsSync(`${target}.bak`) ? fs.readFileSync(`${target}.bak`) : null,
    };
  });

  const restoreSnapshot = (target, contents) => {
    if (contents === null) {
      if (fs.existsSync(target)) fs.unlinkSync(target);
    } else {
      writeFileAtomic(target, contents);
    }
  };

  try {
    ensureDataDir();
    for (const change of changes) {
      const target = path.join(DATA_DIR, change.fileName);
      if (change.delete === true) removeJsonArtifacts(target);
      else writeJsonAtomic(target, change.data, true);
    }
    return true;
  } catch (error) {
    const rollbackErrors = [];
    for (const snapshot of [...snapshots].reverse()) {
      try {
        restoreSnapshot(snapshot.target, snapshot.current);
        restoreSnapshot(`${snapshot.target}.bak`, snapshot.backup);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      console.error(`${label} rollback failed:`, rollbackErrors.map((item) => item.message).join('; '));
    }
    throw error;
  }
}

let tagsLoadError = null;
function loadTagsState() {
  const fileName = 'tags.json';
  const filePath = path.join(DATA_DIR, fileName);
  const hadStoredTags = [filePath, `${filePath}.bak`].some((candidate) => fs.existsSync(candidate));
  const raw = loadAppData(fileName, false);
  if (!hadStoredTags && raw === null) {
    tagsLoadError = null;
    return { tags: [] };
  }
  if (isValidTagsDocument(raw)) {
    const protectedReason = appDataLoadErrors.get(fileName);
    tagsLoadError = protectedReason
      ? '标签已从有效备份载入，但主文件尚未恢复写入；标签暂时只读，主文件和备份均已保留。'
      : null;
    return {
      tags: raw,
      ...(tagsLoadError ? { loadError: tagsLoadError, readOnlyDataAvailable: true } : {}),
    };
  }
  tagsLoadError = '标签主文件与可用备份均无法安全读取；标签已切换为只读，原文件不会被空数组覆盖。';
  reportDataReadFailure(fileName, new Error(tagsLoadError));
  return { tags: [], loadError: tagsLoadError };
}

const noteCache = new Map();
let noteCacheReady = false;
let noteCacheHydrationPromise = null;

function hydrateNoteCacheSync() {
  ensureDataDir();
  noteCache.clear();
  const files = canonicalNoteFileNames(fs.readdirSync(DATA_DIR));
  for (const file of files) {
    const noteId = file.slice('note_'.length, -'.json'.length);
    const note = loadAppData(file);
    if (isPlainRecord(note)) noteCache.set(noteId, note);
  }
  noteCacheReady = true;
}

async function hydrateNoteCacheAsync() {
  ensureDataDir();
  noteCache.clear();
  const files = canonicalNoteFileNames(await fs.promises.readdir(DATA_DIR));
  for(let index=0;index<files.length;index+=1){
    const file=files[index];
    const noteId=file.slice('note_'.length,-'.json'.length);
    const note=loadAppData(file);
    if(isPlainRecord(note)) noteCache.set(noteId,note);
    if(index%8===7) await new Promise((resolve)=>setImmediate(resolve));
  }
  noteCacheReady=true;
}

function migrateLegacyNotesFile() {
  const legacy = loadAppData('notes.json');
  if (!Array.isArray(legacy) || legacy.length === 0) return;
  let complete = true;
  for (const raw of legacy) {
    if (!isPlainRecord(raw) || !isSafeIdentifier(raw.id)) {
      complete = false;
      continue;
    }
    if (loadNoteData(raw.id)) continue;
    if (!saveNoteData(raw.id, raw)) complete = false;
  }
  if (complete) removeJsonArtifacts(path.join(DATA_DIR, 'notes.json'));
}

function getAllNotesState() {
  if (!noteCacheReady) hydrateNoteCacheSync();
  return [...noteCache.entries()].map(([id, note]) => ({ ...note, id }));
}

function getNoteSummaries() {
  const visibleIds = new Set(Object.entries(winRegistry.notes)
    .filter(([, win]) => win && !win.isDestroyed() && win.isVisible())
    .map(([id]) => id));
  return getAllNotesState().map((note) => ({
    id: note.id,
    title: typeof note.title === 'string' && note.title.trim() ? note.title : '未命名',
    color: safeHexColor(note.color, '#64748B'),
    createdAt: typeof note.createdAt === 'string' ? note.createdAt : '',
    isDocked: note.isDocked === true,
    isHidden: note.isHidden === true,
    isVisible: note.noteType !== 'view' && note.isHidden !== true && (note.isDocked === true || visibleIds.has(note.id)),
    noteType: ['echo', 'view', 'daily'].includes(note.noteType) ? note.noteType : 'independent',
  }));
}

function loadNoteData(noteId) {
  if (!isSafeIdentifier(noteId)) return null;
  if (noteCacheReady) return noteCache.get(noteId) || null;
  const note = loadAppData(`note_${noteId}.json`);
  return isPlainRecord(note) ? note : null;
}

function saveNoteDataResult(noteId, patchOrNote, options = {}) {
  if (!isSafeIdentifier(noteId)) return { ok: false, code: 'invalid', message: '便签 ID 无效' };
  const existing = loadNoteData(noteId) || { id: noteId, items: [] };
  const snapshot = isPlainRecord(patchOrNote) ? patchOrNote : {};
  return commitNoteSnapshot({
    noteId,
    existing,
    snapshot,
    expectedRevision: options.expectedRevision,
    write: (next) => saveAppData(`note_${noteId}.json`, next),
    cache: noteCache,
  });
}
function saveNoteData(noteId, patchOrNote) {
  return saveNoteDataResult(noteId, patchOrNote).ok;
}

function moveNoteToTrash(noteId) {
  if (!isSafeIdentifier(noteId)) return { ok: false, message: '便签 ID 无效' };
  const note = loadNoteData(noteId);
  if (!note) return { ok: false, message: '便签文件不存在或无法恢复' };
  fs.mkdirSync(NOTE_TRASH_DIR, { recursive: true });
  const trashId = `trash_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
  const record = {
    trashId,
    noteId,
    deletedAt: new Date().toISOString(),
    note,
    bounds: windowBounds[noteId] || null,
  };
  try {
    applyDataChanges([
      { fileName: `.trash/${trashId}.json`, data: record },
      { fileName: `note_${noteId}.json`, delete: true },
    ], 'move note to trash');
  } catch (error) {
    console.error('moveNoteToTrash failed:', error.message);
    return { ok: false, message: '便签文件正在被占用，未移入回收站' };
  }
  noteCache.delete(noteId);
  delete windowBounds[noteId];
  return { ok: true, trashId };
}

const reportedTrashReadFailures = new Set();
function reportTrashReadFailure(fileName, detail) {
  const signature = `${fileName}:${detail}`;
  if (reportedTrashReadFailures.has(signature)) return;
  reportedTrashReadFailures.add(signature);
  queueStartupReliabilityIssue('部分回收站记录无法显示', `“${fileName}”${detail}；该条目已隔离，原文件与备份均未删除。`);
  const target = [winRegistry.settings, winRegistry.calendar, ...Object.values(winRegistry.notes)]
    .find((win) => win && !win.isDestroyed());
  if (target) deliverStartupReliabilityIssues(target);
}

function listDeletedNotes() {
  if (!fs.existsSync(NOTE_TRASH_DIR)) return [];
  return canonicalTrashRecordNames(fs.readdirSync(NOTE_TRASH_DIR))
    .flatMap((name) => {
      try {
        const record = readBusinessJsonFile(path.join(NOTE_TRASH_DIR, name), name, {
          validate: isValidTrashRecord,
          onRecovery: ({ reason, writeError }) => reportTrashReadFailure(
            name,
            writeError
              ? '的有效备份已载入，但主文件写回失败；当前仍显示备份内容，备份原件已保留'
              : reason === 'missing-primary'
                ? '的主文件缺失，当前显示内容已从有效备份恢复'
                : '的主文件内容无效，当前显示内容已从有效备份恢复',
          ),
        });
        return [{
          trashId: record.trashId,
          noteId: record.noteId,
          title: typeof record.note.title === 'string' ? record.note.title : '未命名便签',
          color: safeHexColor(record.note.color, '#64748B'),
          deletedAt: record.deletedAt,
        }];
      } catch (error) {
        console.error('listDeletedNotes failed:', name, error.message);
        reportTrashReadFailure(name, '及其备份均无法读取');
        return [];
      }
    })
    .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
}

function restoreDeletedNote(trashId) {
  if (!isSafeIdentifier(trashId)) return { ok: false, message: '回收站记录无效' };
  const trashPath = path.join(NOTE_TRASH_DIR, `${trashId}.json`);
  if (![trashPath, `${trashPath}.bak`].some((target) => fs.existsSync(target))) {
    const restored = [...noteCache.values()].find((note) => note && note.restoredFromTrashId === trashId);
    return restored
      ? { ok: true, noteId: restored.id }
      : { ok: false, message: '回收站中已找不到该便签' };
  }
  try {
    const record = readBusinessJsonFile(trashPath, `trash ${trashId}`, {
      validate: isValidTrashRecord,
      onRecovery: ({ reason, writeError }) => reportTrashReadFailure(
        `${trashId}.json`,
        writeError
          ? '的有效备份已载入，但主文件写回失败；恢复操作将直接使用备份，备份原件会保留到事务成功'
          : reason === 'missing-primary'
            ? '的主文件缺失，恢复操作已使用有效备份'
            : '的主文件内容无效，恢复操作已使用有效备份',
      ),
    });
    const existing = loadNoteData(record.noteId);
    if (existing && existing.restoredFromTrashId !== trashId) {
      return { ok: false, message: '同名便签已存在，未覆盖现有内容' };
    }
    const restoredNote = {
      ...record.note,
      id: record.noteId,
      isHidden: true,
      restoredFromTrashId: trashId,
      revision: getNoteRevision(record.note) + 1,
      updatedAt: new Date().toISOString(),
    };
    applyDataChanges([
      { fileName: `note_${record.noteId}.json`, data: restoredNote },
      { fileName: `.trash/${trashId}.json`, delete: true },
    ], 'restore note from trash');
    noteCache.set(record.noteId, restoredNote);
    if (record.bounds && typeof record.bounds === 'object') windowBounds[record.noteId] = record.bounds;
    saveWindowBounds();
    let restoredId = record.noteId;
    if (restoredNote.noteType === 'daily') restoredId = ensureSingleDailyNote() || restoredId;
    if (restoredNote.noteType === 'echo') {
      const firstTagId = getViewNoteBoundTagIds(restoredNote)[0];
      ensureUniqueViewNotes();
      if (firstTagId) restoredId = listViewNoteRecordsForTag(firstTagId)[0]?.id || restoredId;
    }
    const normalizedRestored = loadNoteData(restoredId);
    if (normalizedRestored) notifyNotesChanged({ note: normalizedRestored });
    return { ok: true, noteId: restoredId };
  } catch (error) {
    console.error('restoreDeletedNote failed:', error.message);
    return { ok: false, message: '便签恢复失败，请保留回收站文件并重试' };
  }
}

function permanentlyDeleteNote(trashId) {
  if (!isSafeIdentifier(trashId)) return { ok: false, message: '回收站记录无效' };
  const trashPath = path.join(NOTE_TRASH_DIR, `${trashId}.json`);
  const artifacts = [trashPath, `${trashPath}.bak`];
  if (!artifacts.some((target) => fs.existsSync(target))) {
    return { ok: false, message: '回收站中已找不到该便签' };
  }
  try {
    if (!removeJsonArtifacts(trashPath)) {
      return { ok: false, message: '部分回收站文件未能删除，请检查文件占用或目录权限后重试' };
    }
    return { ok: true, trashId };
  } catch (error) {
    console.error('permanentlyDeleteNote failed:', error.message);
    return { ok: false, message: '便签未能永久删除，请关闭占用该文件的程序后重试' };
  }
}

function notifyNotesChanged(payload = {}, excludeWebContentsId = null) {
  const targets=new Set([winRegistry.calendar,winRegistry.settings,...Object.values(winRegistry.notes)]);
  targets.forEach((win)=>{
    if(win&&!win.isDestroyed()&&win.webContents.id!==excludeWebContentsId) win.webContents.send('notes-changed',payload);
  });
}

const NOTE_COLORS = ['#047857', '#0D9488', '#5EEAD4', '#06B6D4', '#38BDF8', '#2563EB', '#4F46E5', '#8B5CF6', '#C4B5FD', '#D946EF', '#BE185D', '#F9A8D4', '#F43F5E', '#DC2626', '#F97316', '#FDBA74', '#F59E0B', '#FDE047', '#A3E635', '#22C55E', '#84CC16', '#64748B', '#334155', '#92400E'];
function todayDateKey() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function listDailyNoteRecords() {
  ensureDataDir();
  try {
    const records=[];
    const entries = noteCacheReady
      ? [...noteCache.entries()]
      : canonicalNoteFileNames(fs.readdirSync(DATA_DIR))
          .map((file) => [file.slice('note_'.length, -'.json'.length), loadAppData(file)]);
    for (const [fileNoteId, raw] of entries) {
      if (raw && typeof raw === 'object' && raw.noteType === 'daily') {
        records.push({id:fileNoteId,note:{...raw,id:fileNoteId}});
      }
    }
    return records;
  } catch (e) {
    console.error('listDailyNoteRecords failed:', e.message);
    return [];
  }
}
function mergeDailyNoteRecords(records, canonicalId) {
  const usableRecords = records.filter((record) => record && record.note && typeof record.note === 'object');
  const canonical = usableRecords.find((record) => record.id === canonicalId) || usableRecords[0];
  if (!canonical) return null;
  const presentation = [...usableRecords]
    .sort((a, b) => String(b.note.updatedAt || '').localeCompare(String(a.note.updatedAt || '')) || a.id.localeCompare(b.id))[0];
  const itemMap = new Map();
  const completedOccurrences = new Set();
  for (const record of usableRecords) {
    for (const item of Array.isArray(record.note.items) ? record.note.items : []) {
      if (!item || typeof item !== 'object' || !isSafeIdentifier(item.id)) continue;
      const previous = itemMap.get(item.id);
      const sourceUpdatedAt = String(item.completedAt || record.note.updatedAt || '');
      if (!previous || sourceUpdatedAt >= previous.sourceUpdatedAt) {
        itemMap.set(item.id, { item: { ...item, noteId: canonical.id }, sourceUpdatedAt });
      }
    }
    const occurrences = record.note.dailyTodo && Array.isArray(record.note.dailyTodo.completedEventOccurrences)
      ? record.note.dailyTodo.completedEventOccurrences
      : [];
    occurrences.filter(isSafeIdentifier).forEach((key) => completedOccurrences.add(key));
  }
  const items = [...itemMap.values()].map((entry) => entry.item)
    .sort((a, b) => String(a.todoDate || '').localeCompare(String(b.todoDate || '')) || (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) || String(a.id).localeCompare(String(b.id)))
    .map((item, index) => ({ ...item, noteId: canonical.id, sortOrder: index }));
  const latestReset = usableRecords
    .map((record) => record.note.dailyTodo && record.note.dailyTodo.lastResetDate)
    .filter(isDateKey)
    .sort()
    .at(-1);
  return {
    ...canonical.note,
    ...presentation.note,
    id: canonical.id,
    noteType: 'daily',
    title: '每日待办',
    items,
    createdAt: canonical.note.createdAt || presentation.note.createdAt || new Date().toISOString(),
    dailyTodo: {
      ...((canonical.note && canonical.note.dailyTodo) || {}),
      ...((presentation.note && presentation.note.dailyTodo) || {}),
      ...(latestReset ? { lastResetDate: latestReset } : {}),
      completedEventOccurrences: [...completedOccurrences].slice(-20000),
    },
  };
}
function ensureSingleDailyNote() {
  const records=listDailyNoteRecords();
  if(records.length===0) return null;
  if(records.length===1) return records[0].id;
  const byCreated=[...records].sort((a,b)=>String(a.note.createdAt||'').localeCompare(String(b.note.createdAt||''))||a.id.localeCompare(b.id));
  const canonical=byCreated[0];
  const merged=mergeDailyNoteRecords(records,canonical.id);
  if(!merged) return canonical.id;
  if(!saveNoteData(canonical.id,merged)){
    console.error('ensureSingleDailyNote failed: canonical note could not be saved');
    return canonical.id;
  }
  for(const record of records){
    if(record.id===canonical.id) continue;
    const result=moveNoteToTrash(record.id);
    if(!result.ok) continue;
    const w=winRegistry.notes[record.id];
    if(w&&!w.isDestroyed()) w.close();
    delete winRegistry.notes[record.id];
    notifyNotesChanged({deletedId:record.id});
  }
  saveWindowBounds();
  const saved=loadNoteData(canonical.id)||merged;
  notifyNotesChanged({note:saved});
  return canonical.id;
}
function findDailyNoteId() {
  return ensureSingleDailyNote();
}
function openDailyNoteWindow(activeDate) {
  const targetDate = isDateKey(activeDate) ? activeDate : null;
  const existingId = findDailyNoteId();
  if (existingId) {
    const note = loadNoteData(existingId);
    const liveWindow = winRegistry.notes[existingId];
    if (note && note.isDocked !== true && liveWindow && !liveWindow.isDestroyed()) {
      ensureWindowVisible(liveWindow);
      liveWindow.show();
      liveWindow.focus();
      if (targetDate) {
        const sendFocus = () => {
          if (!liveWindow.isDestroyed()) liveWindow.webContents.send('focus-note', { noteId: existingId, noteType: 'daily', dateStr: targetDate });
        };
        if (liveWindow.webContents.isLoading()) liveWindow.webContents.once('did-finish-load', () => setTimeout(sendFocus, 80));
        else sendFocus();
      }
      return;
    }
    const nextNote = {
      ...(note || {}),
      isHidden: false,
      ...(targetDate ? {
        dailyTodo: {
          ...((note && note.dailyTodo) || {}),
          activeDate: targetDate,
          lastResetDate: todayDateKey(),
        },
      } : {}),
    };
    const saveResult=saveNoteDataResult(existingId,nextNote);
    if(!saveResult.ok||!saveResult.note) return;
    const persistedNote=saveResult.note;
    if (note && note.isDocked === true) {
      showCalendar();
      notifyNotesChanged({note:persistedNote});
      const sendFocus = () => {
        const cal = winRegistry.calendar;
        if (cal && !cal.isDestroyed()) cal.webContents.send('focus-note', { noteId: existingId, noteType: 'daily', ...(targetDate ? { dateStr: targetDate } : {}) });
      };
      setTimeout(sendFocus, 80);
      setTimeout(sendFocus, 260);
      return;
    }
    const noteWindow = createNoteWindow(existingId, false);
    if (targetDate && noteWindow && !noteWindow.isDestroyed()) {
      const sendFocus = () => {
        if (!noteWindow.isDestroyed()) noteWindow.webContents.send('focus-note', { noteId: existingId, noteType: 'daily', dateStr: targetDate });
      };
      if (noteWindow.webContents.isLoading()) noteWindow.webContents.once('did-finish-load', () => setTimeout(sendFocus, 80));
      else setTimeout(sendFocus, 40);
    }
    return;
  }
  createNoteWindow(null, true, undefined, { noteType: 'daily', title: '每日待办', ...(targetDate ? { activeDate: targetDate } : {}) });
}
function getViewNoteBoundTagIds(note) {
  if (!note || typeof note !== 'object') return [];
  return [...new Set([
    ...(Array.isArray(note.viewTagIds) ? note.viewTagIds : []),
    note.echoTagId,
  ].filter(isSafeIdentifier))];
}

function listViewNoteRecords() {
  ensureDataDir();
  try {
    const records = [];
    const entries = noteCacheReady
      ? [...noteCache.entries()]
      : canonicalNoteFileNames(fs.readdirSync(DATA_DIR))
          .map((file) => [file.slice('note_'.length, -'.json'.length), loadAppData(file)]);
    for (const [noteId, note] of entries) {
      if (!note || typeof note !== 'object' || note.noteType !== 'echo') continue;
      records.push({ id: noteId, note: { ...note, id: noteId } });
    }
    return records.sort((a, b) => {
      const hiddenCompare = Number(a.note.isHidden === true) - Number(b.note.isHidden === true);
      if (hiddenCompare !== 0) return hiddenCompare;
      const dockedCompare = Number(a.note.isDocked === true) - Number(b.note.isDocked === true);
      if (dockedCompare !== 0) return dockedCompare;
      return String(b.note.updatedAt || '').localeCompare(String(a.note.updatedAt || '')) || a.id.localeCompare(b.id);
    });
  } catch (error) {
    console.error('listViewNoteRecords failed:', error.message);
    return [];
  }
}

function listViewNoteRecordsForTag(tagId) {
  if (!isSafeIdentifier(tagId)) return [];
  return listViewNoteRecords().filter((record) => getViewNoteBoundTagIds(record.note).includes(tagId));
}

function ensureUniqueViewNotes() {
  const tags = loadAppData('tags.json');
  if (!Array.isArray(tags)) return;
  const validTagIds = new Set(tags.filter((tag) => tag && isSafeIdentifier(tag.id)).map((tag) => tag.id));
  const claimedTagIds = new Set();
  let boundsChanged = false;

  for (const record of listViewNoteRecords()) {
    const currentTagIds = getViewNoteBoundTagIds(record.note).filter((tagId) => validTagIds.has(tagId));
    const uniqueTagIds = currentTagIds.filter((tagId) => !claimedTagIds.has(tagId));
    uniqueTagIds.forEach((tagId) => claimedTagIds.add(tagId));

    if (uniqueTagIds.length === 0) {
      const win = winRegistry.notes[record.id];
      if (win && !win.isDestroyed() && getWindowDraftKinds(win).length > 0) {
        broadcastPersistenceFailure('视图便签暂未合并', '该窗口含未保存草稿；请先保存或放弃草稿，再整理重复的视图便签。');
        continue;
      }
      const result = moveNoteToTrash(record.id);
      if (!result.ok) continue;
      if (win && !win.isDestroyed()) closeWindowWithoutDraftPrompt(win);
      delete winRegistry.notes[record.id];
      boundsChanged = true;
      notifyNotesChanged({ deletedId: record.id });
      continue;
    }

    const bindingsChanged = uniqueTagIds.length !== getViewNoteBoundTagIds(record.note).length
      || record.note.echoTagId !== uniqueTagIds[0]
      || !Array.isArray(record.note.viewTagIds)
      || record.note.viewTagIds.some((tagId, index) => tagId !== uniqueTagIds[index]);
    if (!bindingsChanged) continue;
    const nextNote = { ...record.note, echoTagId: uniqueTagIds[0], viewTagIds: uniqueTagIds };
    if (saveNoteData(record.id, nextNote)) notifyNotesChanged({ note: loadNoteData(record.id) || nextNote });
  }

  if (boundsChanged) saveWindowBounds();
}

function openViewNoteWindow(options = {}) {
  const tagId = isSafeIdentifier(options.echoTagId) ? options.echoTagId : null;
  if (!tagId) return null;
  const tags = loadAppData('tags.json');
  const tag = Array.isArray(tags) ? tags.find(item => item && item.id === tagId) : null;
  if (!tag) return null;

  ensureUniqueViewNotes();
  const existing = listViewNoteRecordsForTag(tagId)[0];
  if (existing) {
    const liveWindow = winRegistry.notes[existing.id];
    if (existing.note.isDocked !== true && liveWindow && !liveWindow.isDestroyed()) {
      if (liveWindow.isMinimized()) liveWindow.restore();
      liveWindow.show();
      liveWindow.focus();
      return existing.id;
    }
    const nextNote = { ...existing.note, id: existing.id, isHidden: false, updatedAt: new Date().toISOString() };
    const saveResult = saveNoteDataResult(existing.id, nextNote);
    if (!saveResult.ok || !saveResult.note) return null;
    const persistedNote = saveResult.note;
    notifyNotesChanged({ note: persistedNote });
    if (persistedNote.isDocked === true) {
      showCalendar();
      const sendFocus = () => {
        const calendar = winRegistry.calendar;
        if (calendar && !calendar.isDestroyed()) {
          calendar.webContents.send('focus-note', { noteId: existing.id, noteType: 'echo', tagId });
        }
      };
      setTimeout(sendFocus, 80);
      setTimeout(sendFocus, 260);
      return existing.id;
    }
    createNoteWindow(existing.id, false);
    return existing.id;
  }

  const title = typeof tag.name === 'string' && tag.name.trim() ? tag.name.trim().slice(0, 200) : '视图便签';
  const color = safeHexColor(tag.color, '#2563EB');
  const noteWindow = createNoteWindow(null, true, undefined, { noteType: 'echo', echoTagId: tagId, title, color });
  return noteWindow ? Object.entries(winRegistry.notes).find(([, win]) => win === noteWindow)?.[0] || null : null;
}
function createInitialNote(noteId, options = {}) {
  const ts = new Date().toISOString();
  const noteType = options && options.noteType === 'echo'
    ? 'echo'
    : options && options.noteType === 'daily'
      ? 'daily'
      : 'independent';
  const color = safeHexColor(options && options.color, NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)]);
  const title = typeof options.title === 'string' && options.title.trim()
    ? options.title.trim().slice(0, 200)
    : noteType === 'echo'
      ? '视图便签'
      : noteType === 'daily'
        ? '每日待办'
        : '新便签';
  const today = todayDateKey();
  return {
    id: noteId,
    title,
    color,
    items: [],
    noteType,
    ...(noteType === 'echo' && isSafeIdentifier(options.echoTagId) ? { echoTagId: options.echoTagId } : {}),
    ...(noteType === 'echo' && isSafeIdentifier(options.echoTagId) ? { viewTagIds: [options.echoTagId] } : {}),
    ...(noteType === 'daily' ? { dailyTodo: { activeDate: isDateKey(options && options.activeDate) ? options.activeDate : today, lastResetDate: today } } : {}),
    isDocked: false,
    createdAt: ts,
    updatedAt: ts,
  };
}

// Validation helper: only allow safe alphanumeric/underscore/hyphen keys
function isValidDataKey(key) {
  return isSafeIdentifier(key);
}

// ── System fonts (async, non-blocking) ──
let cachedFonts = null;
const builtinFonts = [
  'Inter',
  'Microsoft YaHei', 'SimSun', 'SimHei', 'KaiTi', 'FangSong',
  'DengXian', 'YouYuan', 'NSimSun', 'Microsoft JhengHei',
  'Arial', 'Times New Roman', 'Courier New', 'Consolas', 'Segoe UI',
  'Verdana', 'Georgia', 'Tahoma', 'Trebuchet MS', 'Impact', 'Comic Sans MS',
  'Palatino Linotype', 'Lucida Console', 'Cambria', 'Calibri',
];

function normalizeSystemFontName(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\s*\((TrueType|OpenType|All res)\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function addSystemFont(names, value) {
  const name = normalizeSystemFontName(value);
  if (!name) return;
  const key = name.toLocaleLowerCase('en-US');
  if (!names.has(key)) names.set(key, name);
}

function loadSystemFontsAsync() {
  const names = new Map();
  builtinFonts.forEach((name) => addSystemFont(names, name));

  // Windows keeps the user-facing font names in the registry. File names such
  // as arialbd.ttf are intentionally not mixed in because they create hundreds
  // of duplicate or unusable choices in the settings list.
  const psScript = `[Console]::OutputEncoding = [Text.Encoding]::UTF8; @('HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts','HKCU:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts') | ForEach-Object { $key = Get-ItemProperty -Path $_ -ErrorAction SilentlyContinue; if ($key) { $key.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' -and $_.Name.Length -gt 1 -and $_.Name.Length -lt 80 } | ForEach-Object { (($_.Name -replace '\\s*\\((TrueType|OpenType)\\)', '') -replace '\\s+$', '').Trim() } } }`;
  exec(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ').trim()}"`,
    { encoding: 'utf-8', timeout: 15000 },
    (err, stdout) => {
      if (!err && stdout) {
        stdout.split(/[\r\n]+/).forEach((line) => {
          addSystemFont(names, line);
        });
      }
      cachedFonts = [...names.values()].sort((a,b)=>a.localeCompare(b,'zh-CN',{sensitivity:'base'}));
      const all=[winRegistry.settings,winRegistry.calendar,...Object.values(winRegistry.notes)].filter(Boolean);
      all.forEach((win)=>{if(win&&!win.isDestroyed()) win.webContents.send('system-fonts-changed',cachedFonts)});
    }
  );
}

function getSystemFonts() {
  return cachedFonts || [...builtinFonts].sort();
}

// ── Tray icon (16×16 pixel-art memo icon) ──
// Draws a rounded rectangle with three horizontal lines representing a sticky note
function createTrayIcon() {
  const s = 16; const buf = Buffer.alloc(s*s*4);
  for (let y=0; y<s; y++) for (let x=0; x<s; x++) {
    const i = (y*s+x)*4;
    const inR = x>=2 && x<s-2 && y>=1 && y<s-1;
    const onB = (x===2||x===s-3)&&y>=1&&y<s-1 || (y===1||y===s-2)&&x>=2&&x<s-3;
    const l1=y===5&&x>=5&&x<12, l2=y===8&&x>=5&&x<11, l3=y===11&&x>=5&&x<9;
    if(l1||l2||l3){buf[i]=0xfb;buf[i+1]=0xbf;buf[i+2]=0x24;buf[i+3]=255}
    else if(onB){buf[i]=0x3b;buf[i+1]=0x82;buf[i+2]=0xf6;buf[i+3]=255}
    else if(inR){buf[i]=0x1e;buf[i+1]=0x29;buf[i+2]=0x3e;buf[i+3]=200}
  }
  return nativeImage.createFromBuffer(buf,{width:s,height:s});
}
let tray=null;
function createTray(){
  tray=new Tray(createTrayIcon());
  tray.setToolTip('OKNote');
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'新建便签',click:()=>createNoteWindow(null,true)},
    {label:'每日待办',click:()=>openDailyNoteWindow()},
    {label:'新建事件',click:()=>dispatchCalendarAction('new-event')},
    {type:'separator'},
    {label:'提醒记录',click:()=>dispatchCalendarAction('show-reminders')},
    {label:'显示/隐藏日历',click:()=>toggleCalendar()},
    {label:'整理全部便签',click:()=>tidyAllNotes()},
    {type:'separator'},
    {label:'偏好设置',click:()=>createSettingsWindow()},
    {type:'separator'},
    {label:'退出',click:()=>requestAppQuit()},
  ]));
  tray.on('double-click',()=>toggleCalendar());
}

// ── Widget factory ──
const APP_INDEX_URL = pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).toString();
function makeWidgetURL(hash){return isDev?`http://localhost:${DEV_PORT}/#${hash}`:`${APP_INDEX_URL}#${hash}`}
function isAllowedWidgetURL(targetURL) {
  if (typeof targetURL !== 'string') return false;
  if (isDev) return targetURL.startsWith(`http://localhost:${DEV_PORT}/`);
  return targetURL.split('#')[0] === APP_INDEX_URL;
}
function hardenWebContents(win, allowWidgetNavigation = true) {
  if (!win || win.isDestroyed()) return;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.on('will-navigate', (event, targetURL) => {
    if (!allowWidgetNavigation || !isAllowedWidgetURL(targetURL)) event.preventDefault();
  });
}
function createWidget(opts={}){
  const win = new BrowserWindow({
    width:opts.width||400,height:opts.height||680,x:opts.x,y:opts.y,
    minWidth:opts.minWidth||180,minHeight:opts.minHeight||180,
    frame:false,transparent:true,skipTaskbar:true,
    resizable:true,hasShadow:false,backgroundColor:'#00000000',
    webPreferences:{
      preload:path.join(__dirname,'preload.cjs'),
      contextIsolation:true,
      nodeIntegration:false,
      sandbox:true,
      webviewTag:false,
      spellcheck:false,
      safeDialogs:true,
    },
  });
  hardenWebContents(win, true);
  attachDraftCloseGuard(win);
  return win;
}

function intersectionArea(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function workAreaForBounds(bounds) {
  const displays = screen.getAllDisplays();
  let best = screen.getPrimaryDisplay();
  let bestArea = -1;
  for (const display of displays) {
    const area = intersectionArea(bounds, display.workArea);
    if (area > bestArea) {
      bestArea = area;
      best = display;
    }
  }
  if (bestArea > 0) return best.workArea;
  return screen.getDisplayNearestPoint({
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  }).workArea;
}

function clampToRange(value, min, max) {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

function sanitizeWindowBounds(rawBounds = {}, fallback = {}, constraints = {}) {
  const fallbackWidth = Number.isFinite(fallback.width) ? fallback.width : 270;
  const fallbackHeight = Number.isFinite(fallback.height) ? fallback.height : 340;
  const minWidth = Number.isFinite(constraints.minWidth) ? Math.max(120, Math.round(constraints.minWidth)) : 180;
  const minHeight = Number.isFinite(constraints.minHeight) ? Math.max(120, Math.round(constraints.minHeight)) : 180;
  const rough = {
    x: Number.isFinite(rawBounds.x) ? rawBounds.x : (Number.isFinite(fallback.x) ? fallback.x : 40),
    y: Number.isFinite(rawBounds.y) ? rawBounds.y : (Number.isFinite(fallback.y) ? fallback.y : 40),
    width: Number.isFinite(rawBounds.width) ? rawBounds.width : fallbackWidth,
    height: Number.isFinite(rawBounds.height) ? rawBounds.height : fallbackHeight,
  };
  const workArea = workAreaForBounds(rough);
  const margin = 8;
  const maxWidth = Math.max(minWidth, workArea.width - margin * 2);
  const maxHeight = Math.max(minHeight, workArea.height - margin * 2);
  const width = clampToRange(Math.round(rough.width), minWidth, maxWidth);
  const height = clampToRange(Math.round(rough.height), minHeight, maxHeight);
  const fallbackX = Number.isFinite(fallback.x) ? Math.round(fallback.x) : workArea.x + margin;
  const fallbackY = Number.isFinite(fallback.y) ? Math.round(fallback.y) : workArea.y + margin;
  const rawX = Number.isFinite(rawBounds.x) ? Math.round(rawBounds.x) : fallbackX;
  const rawY = Number.isFinite(rawBounds.y) ? Math.round(rawBounds.y) : fallbackY;
  return {
    x: clampToRange(rawX, workArea.x + margin, workArea.x + workArea.width - width - margin),
    y: clampToRange(rawY, workArea.y + margin, workArea.y + workArea.height - height - margin),
    width,
    height,
  };
}

function boundsEqual(a, b) {
  return a
    && b
    && Math.round(a.x) === Math.round(b.x)
    && Math.round(a.y) === Math.round(b.y)
    && Math.round(a.width) === Math.round(b.width)
    && Math.round(a.height) === Math.round(b.height);
}

function ensureWindowVisible(win) {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  const workArea = workAreaForBounds(bounds);
  const visibleLeft = Math.max(bounds.x, workArea.x);
  const visibleTop = Math.max(bounds.y, workArea.y);
  const visibleRight = Math.min(bounds.x + bounds.width, workArea.x + workArea.width);
  const visibleBottom = Math.min(bounds.y + bounds.height, workArea.y + workArea.height);
  const visibleWidth = Math.max(0, visibleRight - visibleLeft);
  const visibleHeight = Math.max(0, visibleBottom - visibleTop);
  const minVisibleWidth = Math.min(bounds.width, 80);
  const minVisibleHeight = Math.min(bounds.height, 80);

  if (visibleWidth >= minVisibleWidth && visibleHeight >= minVisibleHeight) return;

  const [minWidth, minHeight] = typeof win.getMinimumSize === 'function' ? win.getMinimumSize() : [180, 180];
  const nextBounds = sanitizeWindowBounds(bounds, bounds, { minWidth, minHeight });
  if (!boundsEqual(bounds, nextBounds)) win.setBounds(nextBounds);
}

// ── Calendar ──
function showCalendar(){const w=winRegistry.calendar;if(w&&!w.isDestroyed()){ensureWindowVisible(w);w.show();w.focus();setTimeout(()=>checkEdgeAutoHide(),40)}else{createCalendarWindow()}}
function toggleCalendar(){const w=winRegistry.calendar;if(w&&!w.isDestroyed()){if(w.isVisible()){w.hide();stopEdgePolling()}else{w.show();w.focus();setTimeout(()=>checkEdgeAutoHide(),40)}}else{createCalendarWindow()}}
function dispatchCalendarAction(action){
  showCalendar();
  const cal=winRegistry.calendar;
  if(!cal||cal.isDestroyed()) return;
  if(isCalendarCollapsed) expandCalendar(cal,false);
  const send=()=>setTimeout(()=>{
    if(cal&&!cal.isDestroyed()) cal.webContents.send('action',action);
  },80);
  if(cal.webContents.isLoading()) cal.webContents.once('did-finish-load',send);
  else send();
}
function openEventEditorInCalendar(eventData){
  if(!eventData||typeof eventData!=='object'||typeof eventData.id!=='string') return;
  showCalendar();
  const cal=winRegistry.calendar;
  if(!cal||cal.isDestroyed()) return;
  const send=()=>{if(!cal.isDestroyed()) cal.webContents.send('open-event-editor',eventData)};
  if(isCalendarCollapsed){
    expandCalendar(cal,false);
    setTimeout(send,190);
    return;
  }
  if(cal.webContents.isLoading()){
    cal.webContents.once('did-finish-load',()=>setTimeout(send,120));
  }else{
    setTimeout(send,40);
  }
}
function getDefaultCalendarBounds(){
  const { workArea } = screen.getPrimaryDisplay();
  const margin = 40;
  const maxWidth = Math.max(360, workArea.width - margin * 2);
  const maxHeight = Math.max(420, workArea.height - margin * 2);
  const minWidth = Math.min(760, maxWidth);
  const minHeight = Math.min(620, maxHeight);
  const width = clampToRange(Math.round(workArea.width * 0.56), minWidth, Math.max(minWidth, Math.min(980, maxWidth)));
  const height = clampToRange(Math.round(workArea.height * 0.72), minHeight, Math.max(minHeight, Math.min(760, maxHeight)));
  return {
    x: workArea.x + margin,
    y: workArea.y + margin,
    width,
    height,
  };
}
function getResponsiveWorkArea(target){
  try{
    const bounds=target&&typeof target.getBounds==='function'?target.getBounds():target;
    if(bounds&&Number.isFinite(bounds.x)&&Number.isFinite(bounds.y)&&Number.isFinite(bounds.width)&&Number.isFinite(bounds.height)){
      return screen.getDisplayMatching(bounds).workArea;
    }
  }catch{}
  return screen.getPrimaryDisplay().workArea;
}
function getCalendarMinimumSize(target=winRegistry.calendar){
  const workArea=getResponsiveWorkArea(target);
  // Font size changes typography only. Window chrome and empty space must not
  // grow with it; overflow is handled inside the renderer.
  // Below this point the seven calendar columns and title actions cease to be
  // operable even with the compact renderer layout.
  return calendarMinimumForWorkArea(workArea);
}
function getNoteMinimumSize(target){
  const workArea=getResponsiveWorkArea(target);
  return noteMinimumForWorkArea(workArea);
}
function applyResponsiveWindowMinimums(scope){
  const apply=(win,minimum)=>{
    if(!win||win.isDestroyed()) return;
    win.setMinimumSize(minimum.width,minimum.height);
    const bounds=win.getBounds();
    if(bounds.width>=minimum.width&&bounds.height>=minimum.height) return;
    const next=sanitizeWindowBounds(
      {...bounds,width:Math.max(bounds.width,minimum.width),height:Math.max(bounds.height,minimum.height)},
      bounds,
      {minWidth:minimum.width,minHeight:minimum.height},
    );
    if(!boundsEqual(bounds,next)) win.setBounds(next,false);
  };
  if(scope==='calendar') {
    const calendar=winRegistry.calendar;
    const minimum=getCalendarMinimumSize(calendar);
    if(calendar&&!calendar.isDestroyed()&&isCalendarCollapsed){
      // A collapsed calendar deliberately sits below its normal responsive
      // minimum. Keep the normal width constraint without forcing it open.
      calendar.setMinimumSize(minimum.width,EDGE_COLLAPSED_HEIGHT);
      if(calendarOriginalBounds){
        calendarOriginalBounds=sanitizeWindowBounds(calendarOriginalBounds,calendarOriginalBounds,{minWidth:minimum.width,minHeight:minimum.height});
      }
    }else{
      apply(calendar,minimum);
    }
  }
  if(scope==='notes') Object.values(winRegistry.notes).forEach((win)=>apply(win,getNoteMinimumSize(win)));
}
function createCalendarWindow(){
  if(winRegistry.calendar&&!winRegistry.calendar.isDestroyed())return showCalendar(),winRegistry.calendar;
  const saved=windowBounds.calendar;
  const defaults=getDefaultCalendarBounds();
  const minimum=getCalendarMinimumSize(saved || defaults);
  const bounds=sanitizeWindowBounds(saved || {}, defaults, { minWidth: minimum.width, minHeight: minimum.height });
  winRegistry.calendar=createWidget({...bounds,minWidth:minimum.width,minHeight:minimum.height});
  winRegistry.calendar.webContents.on('did-finish-load',()=>{
    const cal=winRegistry.calendar;
    if(!cal||cal.isDestroyed()) return;
    cal.webContents.send('toggle-collapse',isCalendarCollapsed);
    setTimeout(()=>checkEdgeAutoHide(),40);
    setTimeout(()=>deliverStartupReliabilityIssues(cal),250);
  });
  winRegistry.calendar.loadURL(makeWidgetURL('/calendar'));
  if(isDev&&process.env.OKNOTE_OPEN_DEVTOOLS==='1')winRegistry.calendar.webContents.openDevTools({mode:'detach'});
  winRegistry.calendar.on('move', ()=>{
    if(edgeBoundsAnimating) return;
    debouncedSaveWindowBounds();
    checkEdgeAutoHide();
  });
  winRegistry.calendar.on('resize', ()=>{
    if(edgeBoundsAnimating) return;
    debouncedSaveWindowBounds();
    checkEdgeAutoHide();
  });
  winRegistry.calendar.on('closed',()=>{winRegistry.calendar=null;clearEdgeTimers();stopEdgePolling();isCalendarCollapsed=false;calendarOriginalBounds=null;pointerOutsideSince=0});
  return winRegistry.calendar;
}

// ── Edge auto-hide (calendar) ──
const EDGE_COLLAPSED_HEIGHT=28;
const EDGE_POLL_INTERVAL=160;
const EDGE_EXIT_GRACE_MS=900;
const EDGE_ANIMATION_FRAME_MS=16;
const EDGE_COLLAPSE_DURATION_MS=210;
const EDGE_EXPAND_DURATION_MS=270;
const EDGE_HOVER_PADDING=10;
const EDGE_EXIT_PADDING=72;
let prefersReducedMotion=false;
const EDGE_SNAP_THRESHOLD=8;
const EDGE_TITLEBAR_KEEPALIVE_HEIGHT=88;
const EDGE_TITLEBAR_KEEPALIVE_X=180;
let edgeHoverPollTimer=null;
let isCalendarCollapsed=false;
let calendarOriginalBounds=null;
let _edgeResizing=false;
let pointerOutsideSince=0;
let edgeBoundsAnimTimer=null;
let edgeBoundsAnimating=false;

function clearEdgeTimers() {
  pointerOutsideSince=0;
  if(edgeBoundsAnimTimer) clearTimeout(edgeBoundsAnimTimer);
  edgeBoundsAnimTimer=null;
  edgeBoundsAnimating=false;
}

function stopEdgePolling(){
  if(edgeHoverPollTimer) clearInterval(edgeHoverPollTimer);
  edgeHoverPollTimer=null;
}

function ensureEdgePolling(){
  if(edgeHoverPollTimer) return;
  edgeHoverPollTimer=setInterval(()=>checkEdgeAutoHide(),EDGE_POLL_INTERVAL);
}

function getCalendarEdgeInfo(bounds) {
  const disp=screen.getDisplayNearestPoint({x:bounds.x+Math.floor(bounds.width/2),y:bounds.y+Math.floor(bounds.height/2)});
  const wa=disp.workArea;
  const threshold=EDGE_SNAP_THRESHOLD;
  const nearLeft=bounds.x<=wa.x+threshold;
  const nearRight=bounds.x+bounds.width>=wa.x+wa.width-threshold;
  const nearTop=bounds.y<=wa.y+threshold;
  const nearBottom=bounds.y+bounds.height>=wa.y+wa.height-threshold;
  return { nearEdge: nearLeft||nearRight||nearTop||nearBottom, nearLeft, nearRight, nearTop, nearBottom };
}

function pointInBounds(point,bounds,padding=0){
  return point.x>=bounds.x-padding&&
    point.x<=bounds.x+bounds.width+padding&&
    point.y>=bounds.y-padding&&
    point.y<=bounds.y+bounds.height+padding;
}

function pointInEdgeKeepAliveZone(point,bounds){
  if(pointInBounds(point,bounds,EDGE_EXIT_PADDING)) return true;
  const titleBand={
    x:bounds.x-EDGE_TITLEBAR_KEEPALIVE_X,
    y:bounds.y-EDGE_EXIT_PADDING,
    width:bounds.width+EDGE_TITLEBAR_KEEPALIVE_X*2,
    height:Math.min(EDGE_TITLEBAR_KEEPALIVE_HEIGHT,bounds.height)+EDGE_EXIT_PADDING,
  };
  return pointInBounds(point,titleBand,0);
}

function rememberCalendarExpandedBounds(bounds){
  if(!bounds||bounds.height<=EDGE_COLLAPSED_HEIGHT+8) return;
  calendarOriginalBounds={x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height};
}

function setCalendarBounds(cal,bounds){
  _edgeResizing=true;
  try{
    cal.setBounds(bounds,false);
  }finally{
    _edgeResizing=false;
  }
}

function easeInOutSine(t){
  return -(Math.cos(Math.PI*t)-1)/2;
}

function animateCalendarBounds(cal,target,duration=EDGE_EXPAND_DURATION_MS,easing=easeInOutSine,onDone){
  if(!cal||cal.isDestroyed()) return;
  if(edgeBoundsAnimTimer) clearTimeout(edgeBoundsAnimTimer);
  if(prefersReducedMotion){
    edgeBoundsAnimTimer=null;
    edgeBoundsAnimating=false;
    setCalendarBounds(cal,target);
    saveWindowBounds();
    if(typeof onDone==='function') onDone();
    return;
  }
  const start=cal.getBounds();
  const started=Date.now();
  edgeBoundsAnimating=true;
  const tick=()=>{
    if(!cal||cal.isDestroyed()){
      clearEdgeTimers();
      return;
    }
    const t=Math.min(1,(Date.now()-started)/duration);
    const k=easing(t);
    const next={
      x:Math.round(start.x+(target.x-start.x)*k),
      y:Math.round(start.y+(target.y-start.y)*k),
      width:Math.round(start.width+(target.width-start.width)*k),
      height:Math.round(start.height+(target.height-start.height)*k),
    };
    setCalendarBounds(cal,next);
    if(t>=1){
      edgeBoundsAnimTimer=null;
      edgeBoundsAnimating=false;
      setCalendarBounds(cal,target);
      saveWindowBounds();
      if(typeof onDone==='function') onDone();
      return;
    }
    edgeBoundsAnimTimer=setTimeout(tick,EDGE_ANIMATION_FRAME_MS);
  };
  tick();
}

function collapseCalendar(cal){
  if(!cal||cal.isDestroyed()||isCalendarCollapsed) return;
  const cursor=screen.getCursorScreenPoint();
  const b=cal.getBounds();
  if(pointInEdgeKeepAliveZone(cursor,b)) return;
  const {nearBottom,nearTop}=getCalendarEdgeInfo(b);
  rememberCalendarExpandedBounds(b);
  isCalendarCollapsed=true;
  pointerOutsideSince=0;
  const minimum=getCalendarMinimumSize(cal);
  cal.setMinimumSize(minimum.width,EDGE_COLLAPSED_HEIGHT);
  const collapsedY=nearBottom&&!nearTop?b.y+b.height-EDGE_COLLAPSED_HEIGHT:b.y;
  animateCalendarBounds(
    cal,
    {x:b.x,y:collapsedY,width:b.width,height:EDGE_COLLAPSED_HEIGHT},
    EDGE_COLLAPSE_DURATION_MS,
    easeInOutSine,
    ()=>{
    if(cal&&!cal.isDestroyed()&&isCalendarCollapsed) cal.webContents.send('toggle-collapse',true);
    },
  );
}

function expandCalendar(cal,hoverExpanded=false){
  if(!cal||cal.isDestroyed()) return;
  clearEdgeTimers();
  const b=cal.getBounds();
  const target=calendarOriginalBounds
    ? {...calendarOriginalBounds}
    : {x:b.x,y:b.y,width:b.width,height:680};
  const minimum=getCalendarMinimumSize(cal);
  // Keep the collapsed minimum until the window has reached its full bounds.
  // Raising minHeight first makes Windows jump partway open before animation.
  cal.setMinimumSize(minimum.width,EDGE_COLLAPSED_HEIGHT);
  isCalendarCollapsed=false;
  cal.webContents.send('toggle-collapse',false);
  animateCalendarBounds(cal,target,EDGE_EXPAND_DURATION_MS,easeInOutSine,()=>{
    if(cal&&!cal.isDestroyed()&&!isCalendarCollapsed){
      cal.setMinimumSize(minimum.width,minimum.height);
      cal.webContents.send('toggle-collapse',false);
    }
  });
  if(!hoverExpanded&&!getCalendarEdgeInfo(target).nearEdge) calendarOriginalBounds=null;
}

function checkEdgeAutoHide(){
  if(_edgeResizing) return; // prevent recursive calls from setBounds→resize
  const cal=winRegistry.calendar;
  if(!cal||cal.isDestroyed()||!cal.isVisible()) {
    stopEdgePolling();
    return;
  }

  if(!appSettings.calendar.edgeAutoHide){
    clearEdgeTimers();
    stopEdgePolling();
    if(isCalendarCollapsed) expandCalendar(cal,false);
    return;
  }

  const bounds=cal.getBounds();
  const { nearEdge } = getCalendarEdgeInfo(bounds);
  if(!nearEdge&&!isCalendarCollapsed){
    clearEdgeTimers();
    stopEdgePolling();
    calendarOriginalBounds=null;
    return;
  }
  ensureEdgePolling();
  const cursor=screen.getCursorScreenPoint();

  if(isCalendarCollapsed){
    if(!nearEdge){
      expandCalendar(cal,false);
      return;
    }
    if(pointInBounds(cursor,bounds,EDGE_HOVER_PADDING)){
      expandCalendar(cal,true);
      return;
    }
    return;
  }

  const pointerInside=pointInEdgeKeepAliveZone(cursor,bounds);
  if(pointerInside){
    pointerOutsideSince=0;
    if(nearEdge) rememberCalendarExpandedBounds(bounds);
    return;
  }

  const now=Date.now();
  if(!pointerOutsideSince){
    pointerOutsideSince=now;
    return;
  }
  if(now-pointerOutsideSince>=EDGE_EXIT_GRACE_MS) collapseCalendar(cal);
}

// ── Notes ──
let noteIdSeq=Date.now();
let externalNoteDrag=null;
let dockDragPreviewWin=null;
let dockDragPreviewOutside=false;
function generateNoteId(){return`note_${++noteIdSeq}`}

function getDockZone(bounds) {
  return {
    top: bounds.y + Math.max(120, Math.round(bounds.height * 0.46)),
    left: bounds.x + Math.min(340, Math.max(260, Math.round(bounds.width * 0.18))),
    right: bounds.x + bounds.width,
    bottom: bounds.y + bounds.height,
  };
}
function isPointInDockZone(x, y) {
  const cal = winRegistry.calendar;
  if (!cal || cal.isDestroyed() || !cal.isVisible() || isCalendarCollapsed) return false;
  const zone = getDockZone(cal.getBounds());
  return x >= zone.left && x <= zone.right && y >= zone.top && y <= zone.bottom;
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function createDockPreviewHtml(note) {
  const color = safeHexColor(note && note.color, '#2563EB');
  const title = escapeHtml(note && note.title ? note.title : '便签');
  const tag = note && note.noteType === 'echo' ? '视图' : note && note.noteType === 'daily' ? '每日' : '独立';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden;font-family:"Microsoft YaHei",system-ui,sans-serif;color:#132033;}
    .card{box-sizing:border-box;width:220px;height:168px;border-radius:8px;border:1px solid rgba(255,255,255,.28);background:${color}dd;box-shadow:0 18px 48px rgba(0,0,0,.34);overflow:hidden;transform:rotate(1.5deg) scale(.98);}
    body.outside .card{border-color:rgba(239,68,68,.58);box-shadow:0 18px 48px rgba(239,68,68,.32);}
    .head{display:flex;align-items:center;gap:8px;padding:10px 12px 5px;font-size:13px;font-weight:600;}
    .dot{width:10px;height:10px;border-radius:999px;background:${color};box-shadow:0 0 0 2px rgba(255,255,255,.18);}
    .title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}
    .pill{font-size:11px;opacity:.45;background:rgba(255,255,255,.12);border-radius:999px;padding:2px 7px;}
    .hint{padding:0 12px;font-size:11px;opacity:.48;}
  </style></head><body><div class="card"><div class="head"><span class="dot"></span><span class="title">${title}</span><span class="pill">${tag}</span></div><div class="hint">拖拽中，松开后完成操作</div></div></body></html>`;
}
function destroyDockDragPreview() {
  if (dockDragPreviewWin && !dockDragPreviewWin.isDestroyed()) dockDragPreviewWin.close();
  dockDragPreviewWin = null;
  dockDragPreviewOutside = false;
}
function beginDockDragPreview(note, x, y) {
  destroyDockDragPreview();
  dockDragPreviewWin = new BrowserWindow({
    width: 220, height: 168, x: Math.round(x - 110), y: Math.round(y - 24),
    frame: false, transparent: true, skipTaskbar: true, resizable: false,
    focusable: false, hasShadow: false, backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false, spellcheck: false },
  });
  hardenWebContents(dockDragPreviewWin, false);
  dockDragPreviewWin.setIgnoreMouseEvents(true);
  dockDragPreviewWin.setAlwaysOnTop(true, 'screen-saver');
  dockDragPreviewWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createDockPreviewHtml(note || {}))}`);
  dockDragPreviewWin.on('closed', () => { dockDragPreviewWin = null; dockDragPreviewOutside = false; });
}
function moveDockDragPreview(x, y, outside) {
  if (!dockDragPreviewWin || dockDragPreviewWin.isDestroyed()) return;
  dockDragPreviewWin.setBounds({ x: Math.round(x - 110), y: Math.round(y - 24), width: 220, height: 168 });
  if (dockDragPreviewOutside !== !!outside) {
    dockDragPreviewOutside = !!outside;
    dockDragPreviewWin.webContents.executeJavaScript(`document.body.classList.toggle('outside', ${dockDragPreviewOutside ? 'true' : 'false'})`).catch(() => {});
  }
}

function createNoteWindow(noteId,isNew,placement,initialOptions){
  if(noteId!=null&&!isSafeIdentifier(noteId)) return null;
  noteId=noteId||generateNoteId();
  let createdNote=null;
  if(isNew&&!loadNoteData(noteId)){
    createdNote=createInitialNote(noteId,initialOptions||{});
    const createResult=saveNoteDataResult(noteId,createdNote);
    if(!createResult.ok||!createResult.note) return null;
    createdNote=createResult.note;
  }
  if(winRegistry.notes[noteId]&&!winRegistry.notes[noteId].isDestroyed()){ensureWindowVisible(winRegistry.notes[noteId]);winRegistry.notes[noteId].show();winRegistry.notes[noteId].focus();return winRegistry.notes[noteId]}
  const{workArea:primaryWorkArea}=screen.getPrimaryDisplay();
  const saved=windowBounds[noteId];
  const defX=Math.min(primaryWorkArea.x+480,primaryWorkArea.x+primaryWorkArea.width-320);
  const defY=primaryWorkArea.y+40+Object.keys(winRegistry.notes).length*20;
  const opts={width:270,height:340,x:defX,y:defY};
  if(saved&&saved.x!=null){opts.x=saved.x;opts.y=saved.y;opts.width=saved.width;opts.height=saved.height}
  if(placement&&typeof placement==='object'){
    if(Number.isFinite(placement.x)) opts.x=Math.round(placement.x);
    if(Number.isFinite(placement.y)) opts.y=Math.round(placement.y);
    if(Number.isFinite(placement.width)) opts.width=Math.round(placement.width);
    if(Number.isFinite(placement.height)) opts.height=Math.round(placement.height);
  }
  const minimum=getNoteMinimumSize(opts);
  const w=createWidget({...sanitizeWindowBounds(opts, { width: 270, height: 340, x: defX, y: defY }, { minWidth: minimum.width, minHeight: minimum.height }),minWidth:minimum.width,minHeight:minimum.height});
  const hash = isNew ? `/note/${noteId}/new` : `/note/${noteId}`;
  w.loadURL(makeWidgetURL(hash));
  w.on('move', debouncedSaveWindowBounds);
  w.on('resize', debouncedSaveWindowBounds);
  w.on('closed',()=>{
    delete winRegistry.notes[noteId];
  });
  winRegistry.notes[noteId]=w;
  if(createdNote) notifyNotesChanged({note:createdNote});
  return w;
}

// ── Settings ──
function createSettingsWindow(){
  if(winRegistry.settings&&!winRegistry.settings.isDestroyed()){
    winRegistry.settings.setAlwaysOnTop(true,'pop-up-menu');
    winRegistry.settings.show();
    winRegistry.settings.moveTop();
    winRegistry.settings.focus();
    return winRegistry.settings
  }
  winRegistry.settings=createWidget({width:560,height:660,minWidth:500,minHeight:520,x:undefined,y:undefined});
  winRegistry.settings.setAlwaysOnTop(true,'pop-up-menu');
  winRegistry.settings.loadURL(makeWidgetURL('/settings'));
  winRegistry.settings.on('closed',()=>{winRegistry.settings=null});
  return winRegistry.settings;
}

// ── Tidy ──
function getTidyNoteEntries(){
  return Object.entries(winRegistry.notes).filter(([id,w])=>{
    if(!w||w.isDestroyed()||!w.isVisible()) return false;
    const note=loadNoteData(id);
    if(note&&note.isHidden===true) return false;
    if(note&&note.isDocked===true) return false;
    return true;
  });
}

function tidyAllNotes(){
  const rawEntries=getTidyNoteEntries();
  if(rawEntries.length===0)return;
  const gap=12,margin=12;
  const cal=winRegistry.calendar;
  const liveCalBounds=cal&&!cal.isDestroyed()&&cal.isVisible()?cal.getBounds():null;
  const calBounds=isCalendarCollapsed&&calendarOriginalBounds?calendarOriginalBounds:liveCalBounds;
  const preferredDisplay=calBounds?screen.getDisplayMatching(calBounds):screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const displays=[preferredDisplay,...screen.getAllDisplays().filter((display)=>display.id!==preferredDisplay.id)];
  const queue=rawEntries.map((entry)=>{
    const [,win]=entry;
    const bounds=win.getBounds();
    const [minWidth,minHeight]=win.getMinimumSize();
    return {entry,width:Math.max(minWidth,bounds.width),height:Math.max(minHeight,Math.min(440,bounds.height)),minWidth,minHeight};
  });
  const preferredRegions=calBounds
    ? createPreferredTidyRegions(preferredDisplay.workArea,calBounds,margin,gap)
    : [createFullTidyRegion(preferredDisplay.workArea,margin)];
  const otherDisplayRegions=displays.slice(1).map((display)=>createFullTidyRegion(display.workArea,margin));
  const regions=[...preferredRegions,...otherDisplayRegions];
  const layout=packTidyItemsResponsive(queue,regions,gap);
  layout.placements.forEach(({item,bounds})=>{
    const [,win]=item.entry;
    if(win&&!win.isDestroyed()) win.setBounds(bounds);
  });
  // If the total window area exceeds all displays, keep every remaining note
  // reachable with a bounded cascade instead of placing it off-screen.
  const preferredFallback=layout.remaining.length>0
    ? preferredRegions.find((region)=>layout.remaining.some((item)=>region.width>=item.minWidth&&region.height>=item.minHeight))
    : null;
  const fallback=preferredFallback||otherDisplayRegions[0]||createFullTidyRegion(preferredDisplay.workArea,margin);
  layout.remaining.forEach((item,index)=>{
    const [,win]=item.entry;
    if(!win||win.isDestroyed()) return;
    const width=Math.min(fallback.width,Math.max(item.minWidth,item.width));
    const height=Math.min(fallback.height,Math.max(item.minHeight,item.height));
    const travelX=Math.max(1,fallback.width-width);
    const travelY=Math.max(1,fallback.height-height);
    win.setBounds({
      x:Math.round(fallback.x+(index*28)%travelX),
      y:Math.round(fallback.y+(index*28)%travelY),
      width:Math.round(width),
      height:Math.round(height),
    });
  });
  saveWindowBounds();
}

// ── Broadcast ──
function broadcastSettings(){
  const all=[winRegistry.calendar,winRegistry.settings,...Object.values(winRegistry.notes)].filter(Boolean);
  all.forEach(w=>{if(!w.isDestroyed())w.webContents.send('settings-changed',{
    themeMode: appSettings.themeMode,
    autoLaunch: appSettings.autoLaunch,
    startMinimized: appSettings.startMinimized,
    hideNotificationContent: appSettings.hideNotificationContent,
    globalFontFamily: appSettings.globalFontFamily,
    globalFontSize: appSettings.globalFontSize,
    calendar: {...appSettings.calendar},
    notes: {...appSettings.notes},
  })});
}

function broadcastPersistenceFailure(title,message){
  const all=[winRegistry.calendar,winRegistry.settings,...Object.values(winRegistry.notes)].filter(Boolean);
  all.forEach((win)=>{
    if(win&&!win.isDestroyed()) win.webContents.send('persistence-failed',{title,message});
  });
}

let startupReliabilityIssuesDeliveredCount = 0;
const startupReliabilityDeliveryWindows = new WeakSet();
function deliverStartupReliabilityIssues(win) {
  if (startupReliabilityIssuesDeliveredCount >= startupReliabilityIssues.length || !win || win.isDestroyed()) return;
  const send = () => {
    startupReliabilityDeliveryWindows.delete(win);
    if (!win || win.isDestroyed()) return;
    const pending = startupReliabilityIssues.slice(startupReliabilityIssuesDeliveredCount);
    if (pending.length === 0) return;
    startupReliabilityIssuesDeliveredCount = startupReliabilityIssues.length;
    const title = pending.length === 1 ? pending[0].title : '发现数据可靠性问题';
    const message = pending.map((issue) => `${issue.title}：${issue.message}`).join('；');
    win.webContents.send('persistence-failed', { title, message });
  };
  if (win.webContents.isLoading()) {
    if (startupReliabilityDeliveryWindows.has(win)) return;
    startupReliabilityDeliveryWindows.add(win);
    win.webContents.once('did-finish-load', () => setTimeout(send, 80));
    return;
  }
  send();
}

// ── Broadcast helpers ──
let eventsCache = null;
let eventsRevision = 0;
let eventsLoadError = null;
function loadEventsSnapshot(force = false){
  if (!force && Array.isArray(eventsCache) && !eventsLoadError) return eventsCache;
  const eventsPath=path.join(DATA_DIR,'events.json');
  const hadStoredEvents=[eventsPath,`${eventsPath}.bak`].some((candidate)=>fs.existsSync(candidate));
  // Reminder reads accept both supported storage formats and never rewrite a
  // large existing file on the UI-owning main-process path.
  const events=loadAppData('events.json',false);
  if(Array.isArray(events)){
    eventsCache=events;
    eventsLoadError=null;
  }else{
    eventsCache=[];
    eventsLoadError=hadStoredEvents?'事件主文件与可用备份均无法读取；原文件已保留，应用不会用空数组覆盖它。':null;
  }
  try {
    const stat = fs.statSync(path.join(DATA_DIR, 'events.json'));
    eventsRevision = Math.max(eventsRevision, Math.floor(stat.mtimeMs));
  } catch {
    eventsRevision = Math.max(eventsRevision, Date.now());
  }
  return eventsCache;
}
function persistEventsSnapshot(events){
  if(!Array.isArray(events)) return false;
  if(!saveAppData('events.json',events)) return false;
  eventsCache=events;
  eventsRevision=Math.max(Date.now(),eventsRevision+1);
  return true;
}
function getEventsState(){
  return {events:loadEventsSnapshot(Boolean(eventsLoadError)),revision:eventsRevision,...(eventsLoadError?{loadError:eventsLoadError}:{})};
}

const REMINDER_POLL_MS = 15 * 1000;
const REMINDER_LATE_GRACE_MS = 2 * 60 * 60 * 1000;
const REMINDER_STATE_FILE = 'reminder-state.json';
const REMINDER_HISTORY_FILE = 'reminder-history.json';
const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_MAX_CATCH_UP_MS = 3650 * DAY_MS;
const REMINDER_CHECKPOINT_MS = 10 * 60 * 1000;
let reminderTimer = null;
let reminderState = { fired: {} };
let reminderHistory = [];
const reportedReminderDataIssues = new Set();
let reminderToastSeq = 0;
const reminderToastWins = new Map();
const REMINDER_TOAST_WIDTH = 438;
const REMINDER_TOAST_HEIGHT = 154;
const REMINDER_TOAST_MARGIN = 22;
const REMINDER_TOAST_GAP = 12;

function reportReminderDataIssue(title, message) {
  const signature = `${title}:${message}`;
  if (reportedReminderDataIssues.has(signature)) return;
  reportedReminderDataIssues.add(signature);
  queueStartupReliabilityIssue(title, message);
  const target = [winRegistry.calendar, winRegistry.settings, ...Object.values(winRegistry.notes)]
    .find((win) => win && !win.isDestroyed());
  if (target) deliverStartupReliabilityIssues(target);
}
function loadReminderState() {
  const raw = loadAppData(REMINDER_STATE_FILE);
  reminderState = isPlainRecord(raw) && isPlainRecord(raw.fired)
    ? { fired: raw.fired, ...(typeof raw.lastCheckedAt === 'string' ? { lastCheckedAt: raw.lastCheckedAt } : {}) }
    : { fired: {} };
  const history = loadAppData(REMINDER_HISTORY_FILE);
  const normalizedHistory = normalizeReminderHistory(history, 500);
  reminderHistory = normalizedHistory.entries;
  if (normalizedHistory.rejectedCount > 0) {
    reportReminderDataIssue(
      '部分提醒记录已隔离',
      `提醒历史中有 ${normalizedHistory.rejectedCount} 条损坏记录未载入；日历与其余提醒仍可使用，原文件会保留为下一次写入前的备份。`,
    );
  }
}
function saveReminderState() {
  return saveAppData(REMINDER_STATE_FILE, reminderState);
}
function checkpointReminderState(nowMs = Date.now(), force = false) {
  const previousMs = Date.parse(reminderState.lastCheckedAt || '');
  if (!force && Number.isFinite(previousMs) && nowMs - previousMs < REMINDER_CHECKPOINT_MS) return true;
  const nextState = { fired: { ...(reminderState.fired || {}) }, lastCheckedAt: new Date(nowMs).toISOString() };
  if (!saveAppData(REMINDER_STATE_FILE, nextState)) return false;
  reminderState = nextState;
  return true;
}
function cleanupReminderState() {
  const cutoff = Date.now() - 30 * DAY_MS;
  let changed = false;
  for (const [key, value] of Object.entries(reminderState.fired || {})) {
    const ts = Date.parse(value);
    if (!Number.isFinite(ts) || ts < cutoff) {
      delete reminderState.fired[key];
      changed = true;
    }
  }
  if (changed && !saveReminderState()) {
    broadcastPersistenceFailure('提醒状态未保存','提醒清理状态写入失败，稍后会自动重试。');
  }
}
function createReminderToastHtml(event, playSound) {
  const timeLabel = event.isAllDay ? '全天（09:00 提醒）' : (event.startTime || '未设置开始时间');
  const hideContent = appSettings.hideNotificationContent === true;
  const title = escapeHtml(hideContent ? '事件提醒' : (event.title || '未命名事件'));
  const body = escapeHtml(hideContent ? '打开 OKNote 查看详情' : `${event.startDate} ${timeLabel}`);
  const shouldPlaySound = playSound ? 'true' : 'false';
  const themeOverride = appSettings.themeMode === 'dark'
    ? `.toast{background:#1c1c1eee;border-color:rgba(255,255,255,.14);box-shadow:0 18px 50px rgba(0,0,0,.42)}.toast::before{background:linear-gradient(145deg,rgba(255,255,255,.07),transparent 48%)}.toast::after{display:none}.title{color:#f5f5f7}.eyebrow,.time{color:rgba(245,245,247,.68)}button{color:#f5f5f7;background:rgba(255,255,255,.10);box-shadow:inset 0 0 0 1px rgba(255,255,255,.09)}button:hover,.close:hover{background:rgba(255,255,255,.16);color:#fff}.close{color:rgba(245,245,247,.68);background:rgba(255,255,255,.07)}`
    : `.toast{background:#f2f2f7f2;border-color:rgba(255,255,255,.72)}.title{color:#1d1d1f}.eyebrow,.time{color:rgba(29,29,31,.64)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:100%;height:100%;background:rgba(0,0,0,0)!important;overflow:hidden;font-family:"Microsoft YaHei",Segoe UI,system-ui,sans-serif;color:#111827;}
    body{box-sizing:border-box;padding:12px;}
    .toast{box-sizing:border-box;position:relative;width:100%;height:100%;border-radius:22px;background:linear-gradient(145deg,rgba(255,255,255,.76),rgba(244,247,251,.68) 48%,rgba(226,232,240,.58));border:1px solid rgba(255,255,255,.62);box-shadow:0 18px 50px rgba(15,23,42,.24),0 1px 0 rgba(255,255,255,.86) inset,0 -1px 0 rgba(15,23,42,.035) inset,0 0 0 1px rgba(15,23,42,.052) inset;overflow:hidden;clip-path:inset(0 round 22px);animation:reminder-in .22s cubic-bezier(.16,1,.3,1),reminder-glow 1.25s ease-in-out .18s 2;}
    .toast::before{content:"";position:absolute;inset:0;border-radius:inherit;background:radial-gradient(circle at 16% 0%,rgba(255,255,255,.78),transparent 40%),radial-gradient(circle at 82% 110%,rgba(148,163,184,.18),transparent 42%),linear-gradient(120deg,rgba(255,255,255,.32),transparent 44%);pointer-events:none;}
    .toast::after{content:"";position:absolute;inset:.5px;border-radius:21px;border:1px solid rgba(255,255,255,.38);background-image:radial-gradient(rgba(15,23,42,.045) .45px,transparent .45px);background-size:4px 4px;opacity:.28;pointer-events:none;}
    .body{position:relative;z-index:1;display:grid;grid-template-columns:42px minmax(0,1fr);grid-template-rows:auto auto;column-gap:12px;row-gap:9px;padding:16px 17px 14px;}
    .icon{grid-row:1 / 3;width:42px;height:42px;border-radius:13px;background:linear-gradient(145deg,rgba(249,250,251,.86),rgba(203,213,225,.58));border:1px solid rgba(255,255,255,.72);display:flex;align-items:center;justify-content:center;flex:none;color:#2563eb;font-size:20px;font-weight:800;box-shadow:0 8px 22px rgba(15,23,42,.12),0 1px 0 rgba(255,255,255,.85) inset;}
    .icon-dot{width:12px;height:12px;border-radius:999px;background:#3b82f6;box-shadow:0 0 0 5px rgba(59,130,246,.13),0 0 18px rgba(59,130,246,.36);}
    .content{min-width:0;}
    .eyebrow{font-size:11px;color:rgba(15,23,42,.52);margin-bottom:3px;font-weight:700;}
    .title{font-size:18px;line-height:1.18;font-weight:760;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#111827;}
    .time{font-size:12.5px;color:rgba(30,41,59,.64);margin-top:4px;font-weight:550;}
    .actions{display:flex;justify-content:flex-end;align-items:end;align-self:end;}
    button{font:inherit;border:0;color:#0f172a;border-radius:999px;padding:6px 13px;font-size:13px;background:rgba(255,255,255,.54);cursor:pointer;font-weight:720;box-shadow:0 1px 0 rgba(255,255,255,.78) inset,0 0 0 1px rgba(15,23,42,.08),0 8px 20px rgba(15,23,42,.10);}
    button:hover{background:rgba(255,255,255,.72);}
    button:active{transform:translateY(1px);background:rgba(226,232,240,.74);}
    .close{position:absolute;right:10px;top:10px;z-index:3;width:28px;height:28px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:9px;font-size:20px;line-height:1;font-weight:400;color:rgba(15,23,42,.62);box-shadow:none;background:rgba(255,255,255,.28);}
    .close:hover{background:rgba(255,255,255,.64);color:#111827;}
    @keyframes reminder-in{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}
    @keyframes reminder-glow{0%,100%{box-shadow:0 18px 50px rgba(15,23,42,.24),0 1px 0 rgba(255,255,255,.86) inset,0 0 0 1px rgba(15,23,42,.052) inset}50%{box-shadow:0 20px 56px rgba(15,23,42,.29),0 1px 0 rgba(255,255,255,.90) inset,0 0 0 1px rgba(59,130,246,.14) inset,0 0 0 4px rgba(59,130,246,.08)}}
    @media (prefers-reduced-motion:reduce){.toast{animation:none!important}button{transition:none!important}}
    ${themeOverride}
  </style></head><body><div class="toast"><button class="close" id="close" type="button" aria-label="关闭提醒" title="关闭">×</button><div class="body"><div class="icon"><span class="icon-dot"></span></div><div class="content"><div class="eyebrow">OKNote 提醒</div><div class="title">${title}</div><div class="time">${body}</div></div><div class="actions"><button id="dismiss" type="button">知道了</button></div></div></div><script>
    (() => {
      const dismiss = () => {
        if (window.electronAPI && window.electronAPI.dismissReminderToast) {
          window.electronAPI.dismissReminderToast();
        }
        setTimeout(() => window.close(), 80);
      };
      document.getElementById('dismiss')?.addEventListener('click', dismiss);
      document.getElementById('close')?.addEventListener('click', dismiss);
      document.addEventListener('keydown', (event) => { if (event.key === 'Escape') dismiss(); });
      if (!${shouldPlaySound}) return;
      const play = () => {
        try {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (!AudioCtx) return;
          const ctx = new AudioCtx();
          const master = ctx.createGain();
          master.gain.setValueAtTime(0.0001, ctx.currentTime);
          master.gain.exponentialRampToValueAtTime(0.64, ctx.currentTime + 0.025);
          master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.62);
          master.connect(ctx.destination);

          const start = ctx.currentTime + 0.04;
          for (const [freq, type, level] of [[740, 'sine', 1.0], [1480, 'triangle', 0.30]]) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, start);
            gain.gain.setValueAtTime(level, start);
            osc.connect(gain);
            gain.connect(master);
            osc.start(start);
            osc.stop(start + 0.52);
          }

          if (ctx.resume) ctx.resume().catch(() => {});
          setTimeout(() => ctx.close().catch(() => {}), 900);
        } catch {}
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(play, 70), { once: true });
      } else {
        setTimeout(play, 70);
      }
    })();
  </script></body></html>`;
}
function getReminderToastBounds(index) {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  return {
    x: Math.round(workArea.x + workArea.width - REMINDER_TOAST_WIDTH - REMINDER_TOAST_MARGIN),
    y: Math.round(Math.max(
      workArea.y + REMINDER_TOAST_MARGIN,
      workArea.y + workArea.height - REMINDER_TOAST_HEIGHT - REMINDER_TOAST_MARGIN - index * (REMINDER_TOAST_HEIGHT + REMINDER_TOAST_GAP)
    )),
    width: REMINDER_TOAST_WIDTH,
    height: REMINDER_TOAST_HEIGHT,
  };
}
function repositionReminderToasts() {
  let index = 0;
  for (const win of reminderToastWins.values()) {
    if (!win || win.isDestroyed()) continue;
    win.setBounds(getReminderToastBounds(index));
    index += 1;
  }
}
function pulseReminderAttention() {
  const cal = winRegistry.calendar;
  if (cal && !cal.isDestroyed()) {
    try {
      cal.flashFrame(true);
      setTimeout(() => { if (!cal.isDestroyed()) cal.flashFrame(false); }, 10000);
    } catch {}
  }
}
function showReminderToast(event, reminderKey) {
  const token = `reminder_${Date.now()}_${++reminderToastSeq}`;
  const index = reminderToastWins.size;
  const toast = new BrowserWindow({
    ...getReminderToastBounds(index),
    frame: false,
    transparent: true,
    skipTaskbar: true,
    show: false,
    focusable: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'reminder-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
      safeDialogs: true,
    },
  });
  hardenWebContents(toast, false);
  toast.setAlwaysOnTop(true, 'screen-saver', 1);
  toast.webContents.once('did-fail-load',()=>{if(reminderKey) requeueReminderKey(reminderKey)});
  void toast.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createReminderToastHtml(event, !!(event.reminder && event.reminder.playSound)))}`)
    .catch(()=>{if(reminderKey) requeueReminderKey(reminderKey)});
  toast.showInactive();
  toast.moveTop();
  pulseReminderAttention();
  reminderToastWins.set(token, toast);
  const closeTimer = setTimeout(() => {
    if (!toast.isDestroyed()) toast.close();
  }, 5 * 60 * 1000);
  toast.on('closed', () => {
    clearTimeout(closeTimer);
    reminderToastWins.delete(token);
    repositionReminderToasts();
  });
  return true;
}
function markReminderHistoryEntryRead(id, key) {
  const next=reminderHistory.map((entry)=>entry.id===id||(key&&entry.key===key)?{...entry,read:true}:entry);
  if(!next.some((entry,index)=>entry!==reminderHistory[index])) return true;
  if(!saveAppData(REMINDER_HISTORY_FILE,next)) return false;
  reminderHistory=next;
  broadcastReminderHistory();
  return true;
}
function requeueReminderKey(key) {
  if(typeof key!=='string'||!key) return;
  if(!Object.prototype.hasOwnProperty.call(reminderState.fired||{},key)&&!reminderHistory.some((entry)=>entry.key===key)) return;
  const nextState={...reminderState,fired:{...(reminderState.fired||{})}};
  delete nextState.fired[key];
  const nextHistory=reminderHistory.filter((entry)=>entry.key!==key);
  try{
    applyDataChanges([
      {fileName:REMINDER_STATE_FILE,data:nextState},
      {fileName:REMINDER_HISTORY_FILE,data:nextHistory},
    ],'requeue failed reminder');
    reminderState=nextState;
    reminderHistory=nextHistory;
    broadcastReminderHistory();
  }catch(error){
    console.error('requeueReminderKey failed:',error.message);
  }
}
function fireEventReminder(event, reminderKey) {
  try {
    if (Notification.isSupported()) {
      const hideContent = appSettings.hideNotificationContent === true;
      const timeLabel = event.isAllDay ? '全天（09:00 提醒）' : (event.startTime || '未设置开始时间');
      const notification = new Notification({
        title: hideContent ? 'OKNote 事件提醒' : (event.title || 'OKNote 事件提醒'),
        body: hideContent ? '打开 OKNote 查看详情' : `${event.startDate} ${timeLabel}`,
        silent: !(event.reminder && event.reminder.playSound),
        timeoutType: 'never',
      });
      notification.on('click', () => {
        markReminderHistoryEntryRead(null, reminderKey);
        showCalendar();
        openEventEditorInCalendar(event);
      });
      notification.on('failed',()=>requeueReminderKey(reminderKey));
      notification.show();
      return true;
    }
    if (reminderToastWins.size < 3) return showReminderToast(event,reminderKey);
  } catch (error) {
    console.error('fireEventReminder failed:', error.message);
  }
  return false;
}
function fireReminderSummary(count) {
  if (count <= 0) return true;
  try {
    if (!Notification.isSupported()) return false;
    const notification = new Notification({
      title: 'OKNote 提醒汇总',
      body: `另有 ${count} 条到期提醒，已保存在提醒记录中。`,
      silent: true,
      timeoutType: 'never',
    });
    notification.on('click', () => showCalendar());
    notification.show();
    return true;
  } catch (error) {
    console.error('fireReminderSummary failed:',error.message);
    return false;
  }
}
function fireMissedReminderSummary(count) {
  if (count <= 0) return true;
  try {
    if (Notification.isSupported()) {
    const notification = new Notification({
      title: 'OKNote 错过的提醒',
      body: `${count} 条提醒在应用未运行或设备休眠期间到期，已保存在提醒记录中。`,
      silent: true,
      timeoutType: 'never',
    });
    notification.on('click', () => showCalendar());
    notification.show();
    }
  } catch (error) {
    console.error('fireMissedReminderSummary failed:',error.message);
  }
  pulseReminderAttention();
  return true;
}
function broadcastReminderHistory() {
  const wins=[winRegistry.calendar,winRegistry.settings,...Object.values(winRegistry.notes)].filter(Boolean);
  wins.forEach((win)=>{
    if(win&&!win.isDestroyed()) win.webContents.send('reminder-history-changed',reminderHistory);
  });
}
function checkEventReminders() {
  try {
    const storedEvents = loadEventsSnapshot(Boolean(eventsLoadError));
    const nowMs = Date.now();
    if (eventsLoadError) {
      console.warn('Reminder scan deferred until events can be read:', eventsLoadError);
      return;
    }
    const normalized = normalizeReminderEvents(storedEvents);
    if (normalized.rejectedCount > 0 || normalized.repairedCount > 0) {
      reportReminderDataIssue(
        '部分事件未按原值参与提醒扫描',
        `${normalized.rejectedCount} 条事件已隔离，${normalized.repairedCount} 条事件的非法可选字段已忽略；其他提醒仍会继续扫描，事件文件未被改写。`,
      );
    }
    const events = normalized.events.filter((event) => event.reminder && event.reminder.enabled === true);
    if (events.length === 0) {
      checkpointReminderState(nowMs);
      return;
    }
    const previousCheckMs = Date.parse(reminderState.lastCheckedAt || '');
    const catchUpStartMs = Number.isFinite(previousCheckMs)
      ? Math.max(previousCheckMs, nowMs - REMINDER_MAX_CATCH_UP_MS)
      : nowMs - REMINDER_LATE_GRACE_MS;
    const expanded = expandReminderEventsForDueWindow(events, catchUpStartMs, nowMs);
    const due = collectDueReminders({
      events: expanded,
      fired: reminderState.fired,
      nowMs,
      catchUpStartMs,
      lateGraceMs: REMINDER_LATE_GRACE_MS,
      getStartMillis: eventStartMillis,
    });

    if (due.length > 0) {
      const firedAt = new Date().toISOString();
      const liveDue = due.filter((item) => !item.missed);
      const missedDue = due.filter((item) => item.missed);
      const deliveredLive = [];
      const failedLive = [];
      for (const item of liveDue) {
        if (fireEventReminder(item.event,item.key)) deliveredLive.push(item);
        else failedLive.push(item);
      }
      const delivered = [...missedDue,...deliveredLive];
      if (delivered.length === 0) {
        console.warn(`Reminder delivery deferred for ${failedLive.length} event(s)`);
        return;
      }
      const nextState = {
        fired: { ...(reminderState.fired || {}) },
        lastCheckedAt: failedLive.length > 0
          ? (reminderState.lastCheckedAt || new Date(catchUpStartMs).toISOString())
          : firedAt,
      };
      const additions = delivered.map(({event,key,reminderMs,missed}) => {
        nextState.fired[key] = firedAt;
        return {
          id: `reminder_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`,
          key,
          eventId: event.seriesId || event.id,
          title: event.title || '未命名事件',
          startDate: event.startDate,
          startTime: event.startTime,
          isAllDay: event.isAllDay === true,
          firedAt,
          read: false,
          ...(missed ? { missed: true, scheduledFor: new Date(reminderMs).toISOString() } : {}),
        };
      });
      const nextHistory = [...reminderHistory, ...additions].slice(-500);
      try {
        applyDataChanges([
          {fileName:REMINDER_STATE_FILE,data:nextState},
          {fileName:REMINDER_HISTORY_FILE,data:nextHistory},
        ],'record reminders');
        reminderState = nextState;
        reminderHistory = nextHistory;
        if(failedLive.length>0) console.warn(`Reminder delivery will retry for ${failedLive.length} event(s)`);
        fireMissedReminderSummary(missedDue.length);
        broadcastReminderHistory();
      } catch (error) {
        console.error('persist reminders failed:',error.message);
        broadcastPersistenceFailure('提醒记录未保存','磁盘写入失败，提醒将在下一轮扫描时重试。');
      }
    } else if (!checkpointReminderState(nowMs)) {
      broadcastPersistenceFailure('提醒检查点未保存','本轮没有漏掉提醒，但离线检查时间未能写入磁盘，稍后会自动重试。');
    }
    cleanupReminderState();
  } catch (e) {
    console.error('checkEventReminders failed:', e.message);
  }
}
function startReminderScheduler() {
  loadReminderState();
  if (reminderTimer) clearInterval(reminderTimer);
  checkEventReminders();
  reminderTimer = setInterval(checkEventReminders, REMINDER_POLL_MS);
}
function stopReminderScheduler() {
  if (reminderTimer) clearInterval(reminderTimer);
  reminderTimer = null;
}

function broadcastEventsChanged(data={}){
  const payload={action:'events-changed',events:loadEventsSnapshot(),revision:eventsRevision,...data};
  const wins=[winRegistry.calendar,...Object.values(winRegistry.notes)];
  wins.forEach(w=>{if(w&&!w.isDestroyed()) w.webContents.send('events-changed',payload)});
  setTimeout(()=>checkEventReminders(),500);
}

// ── IPC ──
function eventMutationFailure(code, message) {
  return { ok: false, code, message, ...getEventsState() };
}

function mutateEventRecord(request) {
  if (!request || typeof request !== 'object') return eventMutationFailure('invalid', '事件操作格式无效');
  const events = loadEventsSnapshot();
  if(eventsLoadError) return eventMutationFailure('load_failed', eventsLoadError);
  if (hasRevisionConflict(request.expectedRevision, eventsRevision)) {
    return eventMutationFailure('conflict', '事件列表已在其他窗口中变化，请确认最新内容后重试');
  }
  const type = request.type;
  if (type === 'delete') {
    if (!isSafeIdentifier(request.id)) return eventMutationFailure('invalid', '事件 ID 无效');
    const index = events.findIndex((event) => event && event.id === request.id);
    if (index < 0) return { ok: true, deletedId: request.id, ...getEventsState() };
    const existing = events[index];
    if (typeof request.expectedUpdatedAt === 'string' && existing.updatedAt !== request.expectedUpdatedAt) {
      return eventMutationFailure('conflict', '该事件已在其他窗口中更新，请确认最新内容后重试');
    }
    const next = events.filter((event) => event && event.id !== request.id);
    if (!persistEventsSnapshot(next)) return eventMutationFailure('save_failed', '事件删除未能写入磁盘');
    broadcastEventsChanged({ action: 'event-deleted', eventId: request.id });
    return { ok: true, deletedId: request.id, ...getEventsState() };
  }
  if (type !== 'create' && type !== 'update') return eventMutationFailure('invalid', '不支持的事件操作');
  const incoming = request.event;
  if (!incoming || typeof incoming !== 'object' || !isSafeIdentifier(incoming.id)) {
    return eventMutationFailure('invalid', '事件内容无效');
  }
  const matchingEvents=events.filter((event)=>event&&event.id===incoming.id);
  const existing=matchingEvents.reduce((latest,event)=>!latest||String(event.updatedAt||'')>String(latest.updatedAt||'')?event:latest,null);
  const index=existing?events.indexOf(existing):-1;
  if (type === 'create' && existing) return eventMutationFailure('duplicate', '事件已存在，已阻止重复创建');
  if (type === 'update' && !existing) return eventMutationFailure('not_found', '事件已在其他窗口中删除');
  if (type === 'update' && typeof request.expectedUpdatedAt === 'string' && existing.updatedAt !== request.expectedUpdatedAt) {
    return eventMutationFailure('conflict', '该事件已在其他窗口中更新，请确认最新内容后重试');
  }
  const safeEvent = sanitizeEventPayload(incoming, existing);
  if (!safeEvent) return eventMutationFailure('invalid', '事件日期、标题或重复规则无效');
  const next = index >= 0
    ? [...events.filter((event)=>!event||event.id!==incoming.id),safeEvent]
    : [...events, safeEvent];
  if (!persistEventsSnapshot(next)) return eventMutationFailure('save_failed', '事件未能写入磁盘');
  broadcastEventsChanged({ action: type === 'create' ? 'event-created' : 'event-updated', eventId: safeEvent.id });
  return { ok: true, event: safeEvent, ...getEventsState() };
}

function getRendererContext(event) {
  const win=event&&event.sender?BrowserWindow.fromWebContents(event.sender):null;
  if(!win||win.isDestroyed()) return {role:'unknown',win:null,noteId:null};
  if(win===winRegistry.calendar) return {role:'calendar',win,noteId:null};
  if(win===winRegistry.settings) return {role:'settings',win,noteId:null};
  const noteEntry=Object.entries(winRegistry.notes).find(([,noteWin])=>noteWin===win);
  if(noteEntry) return {role:'note',win,noteId:noteEntry[0]};
  return {role:'unknown',win,noteId:null};
}

function setupIPC(){
  if (isIsolatedTestInstance) {
    ipcMain.handle('__finish-isolated-test', () => {
      forceAppQuit = true;
      app.isQuitting = true;
      setImmediate(() => app.quit());
      return { ok: true };
    });
  }
  ipcMain.handle('get-settings',()=>({
    themeMode: appSettings.themeMode,
    autoLaunch: appSettings.autoLaunch,
    startMinimized: appSettings.startMinimized,
    hideNotificationContent: appSettings.hideNotificationContent,
    globalFontFamily: appSettings.globalFontFamily,
    globalFontSize: appSettings.globalFontSize,
    calendar: {...appSettings.calendar},
    notes: {...appSettings.notes},
  }));
  ipcMain.handle('get-system-fonts',()=>getSystemFonts());
  ipcMain.handle('set-auto-launch',(_event,enabled)=>{
    appSettings.autoLaunch=!!enabled;
    const result=applyLoginItemSettings();
    if(!result.ok){
      appSettings.autoLaunch=!!result.enabled;
      return {ok:false,enabled:appSettings.autoLaunch,message:'系统未接受开机启动设置'};
    }
    if(!saveSettings()) return {ok:false,enabled:appSettings.autoLaunch,message:'开机启动已设置，但偏好未能写入磁盘'};
    broadcastSettings();
    return {ok:true,enabled:appSettings.autoLaunch};
  });
  ipcMain.handle('set-start-minimized',(_event,enabled)=>{
    const previous=appSettings.startMinimized;
    appSettings.startMinimized=enabled===true;
    const result=applyLoginItemSettings();
    if(!result.ok){
      appSettings.startMinimized=previous;
      applyLoginItemSettings();
      return {ok:false,enabled:previous,message:'系统未接受带 --hidden 参数的启动项，设置已恢复'};
    }
    if(!saveSettings()){
      appSettings.startMinimized=previous;
      applyLoginItemSettings();
      return {ok:false,enabled:previous,message:'启动项已修改，但偏好写入失败；设置已恢复'};
    }
    broadcastSettings();
    return {ok:true,enabled:appSettings.startMinimized};
  });
  ipcMain.on('set-setting',(_event,scope,key,value)=>{
    const sanitizedValue=sanitizeSettingChange(scope,key,value);
    if(sanitizedValue===undefined) return;
    if(scope==='theme'){
      applyThemePreset(sanitizedValue);
    }else if(scope==='global'){
      appSettings[key]=sanitizedValue;
      if(key==='startMinimized') applyLoginItemSettings();
    }else if(appSettings[scope] && typeof appSettings[scope]==='object' && key in appSettings[scope]){
      appSettings[scope][key]=sanitizedValue;
      if(key==='fontSize') applyResponsiveWindowMinimums(scope);
      // If edgeAutoHide is changed
      if(scope==='calendar'&&key==='edgeAutoHide'){
        if(sanitizedValue){
          // Turned ON: proactively check if already near edge
          setTimeout(()=>checkEdgeAutoHide(),40);
        }else{
          clearEdgeTimers();
          stopEdgePolling();
          const cal=winRegistry.calendar;
          if(cal&&!cal.isDestroyed()&&isCalendarCollapsed) expandCalendar(cal,false);
        }
      }
    }else{
      return;
    }
    scheduleSettingsCommit();
  });
  ipcMain.on('set-reduced-motion',(_e,reduced)=>{prefersReducedMotion=reduced===true});
  ipcMain.on('set-window-draft-state',(event,entries)=>{
    if(!BrowserWindow.fromWebContents(event.sender)) return;
    const safeEntries=sanitizeDraftEntries(entries);
    if(safeEntries.length>0) windowDraftStates.set(event.sender.id,safeEntries);
    else windowDraftStates.delete(event.sender.id);
  });
  ipcMain.handle('confirm-window-draft-action',(event,actionLabel,noteId)=>{
    const win=BrowserWindow.fromWebContents(event.sender);
    if(!win||win.isDestroyed()) return false;
    const label=typeof actionLabel==='string'&&actionLabel.trim()?actionLabel.trim().slice(0,40):'继续';
    return isSafeIdentifier(noteId)
      ? confirmDiscardNoteDrafts([noteId],label,win)
      : confirmDiscardWindowDrafts(win,label);
  });
  ipcMain.on('window-close',event=>{BrowserWindow.fromWebContents(event.sender)?.close()});
  ipcMain.handle('hide-note',(event,noteSnapshot)=>{
    const win = BrowserWindow.fromWebContents(event.sender);
    if(!win || win.isDestroyed()) return {ok:false,message:'便签窗口已经关闭'};
    const noteEntry=Object.entries(winRegistry.notes).find(([,noteWin])=>noteWin===win);
    if(!noteEntry) return {ok:false,message:'无法识别当前便签窗口'};
    const [noteId]=noteEntry;
    if(!isPlainRecord(noteSnapshot)||noteSnapshot.id!==noteId){
      broadcastPersistenceFailure('便签保持打开','没有收到当前便签的完整内容，已取消隐藏以避免丢失修改。');
      return {ok:false,message:'没有收到当前便签的完整内容'};
    }
    if(!confirmDiscardWindowDrafts(win,'隐藏')) {
      return {ok:false,canceled:true,message:'已取消隐藏，便签和草稿均保留'};
    }
    const nextNote={...noteSnapshot,id:noteId,isHidden:true,updatedAt:new Date().toISOString()};
    const saveResult=saveNoteDataResult(noteId,nextNote);
    if(!saveResult.ok||!saveResult.note){
      return {ok:false,message:'便签写入失败，窗口已保持打开'};
    }
    const persisted=saveResult.note;
    notifyNotesChanged({note:persisted});
    saveWindowBounds();
    closeWindowWithoutDraftPrompt(win);
    return {ok:true,note:persisted};
  });
  ipcMain.handle('hide-note-by-id',(event,noteId)=>{
    if(!isSafeIdentifier(noteId)) return {ok:false,message:'便签 ID 无效'};
    const note=loadNoteData(noteId);
    if(!note){
      broadcastPersistenceFailure('便签状态未更新','无法读取该便签，未执行隐藏操作。');
      return {ok:false,message:'无法读取该便签'};
    }
    const w=winRegistry.notes[noteId];
    if(!confirmDiscardNoteDrafts([noteId],'隐藏',w||getRendererContext(event).win)) return {ok:false,canceled:true,message:'已取消，便签和草稿均保留'};
    if(note&&note.isDocked===true){
      const nextNote={...note,isDocked:true,isHidden:true};
      const saveResult=saveNoteDataResult(noteId,nextNote);
      if(!saveResult.ok||!saveResult.note) return {ok:false,message:'便签状态未能写入磁盘'};
      notifyNotesChanged({note:saveResult.note});
      return {ok:true,note:saveResult.note};
    }
    const nextNote={...note,isHidden:true};
    const saveResult=saveNoteDataResult(noteId,nextNote);
    if(!saveResult.ok||!saveResult.note) return {ok:false,message:'便签状态未能写入磁盘'};
    const persisted=saveResult.note;
    notifyNotesChanged({note:persisted});
    if(w&&!w.isDestroyed()){
      saveWindowBounds();
      closeWindowWithoutDraftPrompt(w);
    }
    return {ok:true,note:persisted};
  });
  ipcMain.on('create-note',(_event,options)=>{
    const safeOptions=options&&typeof options==='object'?options:{};
    if(safeOptions.noteType==='daily'){
      openDailyNoteWindow(safeOptions.activeDate);
      return;
    }
    if(safeOptions.noteType==='echo'){
      openViewNoteWindow(safeOptions);
      return;
    }
    createNoteWindow(null,true,undefined,safeOptions);
  });
  ipcMain.handle('delete-note',(event,noteId)=>{
    try {
      const w=winRegistry.notes[noteId];
      if(!confirmDiscardNoteDrafts([noteId],'移入回收站',w||getRendererContext(event).win)) return {ok:false,canceled:true,message:'已取消，便签和草稿均保留'};
      const result=moveNoteToTrash(noteId);
      if(!result.ok) return result;
      if(w&&!w.isDestroyed()) closeWindowWithoutDraftPrompt(w);
      delete winRegistry.notes[noteId];
      saveWindowBounds();
      notifyNotesChanged({deletedId:noteId});
      return result;
    } catch(e) {
      console.error('delete-note failed:',e.message);
      return {ok:false,message:'便签未能移入回收站'};
    }
  });
  ipcMain.handle('list-deleted-notes',()=>listDeletedNotes());
  ipcMain.handle('restore-deleted-note',(_event,trashId)=>restoreDeletedNote(trashId));
  ipcMain.handle('permanently-delete-note',(_event,trashId)=>permanentlyDeleteNote(trashId));
  ipcMain.on('open-settings',()=>createSettingsWindow());
  ipcMain.on('tidy-notes',()=>tidyAllNotes());
  ipcMain.on('dismiss-reminder-toast',(event)=>{
    const win=BrowserWindow.fromWebContents(event.sender);
    if(win&&!win.isDestroyed()) win.close();
  });
  ipcMain.handle('get-reminder-history',()=>reminderHistory);
  ipcMain.handle('mark-reminder-history-read',(_event,id)=>{
    try {
      if(id!==undefined&&id!==null) return markReminderHistoryEntryRead(id,null);
      const next=reminderHistory.map((entry)=>{
        if(id===undefined||id===null||entry.id===id) return {...entry,read:true};
        return entry;
      });
      if(!saveAppData(REMINDER_HISTORY_FILE,next)) return false;
      reminderHistory=next;
      broadcastReminderHistory();
      return true;
    } catch(e) {
      console.error('mark-reminder-history-read failed:',e.message);
      return false;
    }
  });
  ipcMain.on('open-event-editor',(_event,eventData)=>openEventEditorInCalendar(eventData));

  // ── Note visibility management ──
  ipcMain.handle('show-note',(_event,noteId)=>{
    if(!isSafeIdentifier(noteId)) return {ok:false,message:'便签 ID 无效'};
    const note=loadNoteData(noteId);
    if(!note){
      broadcastPersistenceFailure('便签状态未更新','无法读取该便签，未执行显示操作。');
      return {ok:false,message:'无法读取该便签'};
    }
    const nextNote={...note,isHidden:false};
    const saveResult=saveNoteDataResult(noteId,nextNote);
    if(!saveResult.ok||!saveResult.note) return {ok:false,message:'便签状态未能写入磁盘'};
    const persisted=saveResult.note;
    if(persisted.isDocked===true){
      showCalendar();
      notifyNotesChanged({note:persisted});
      setTimeout(()=>{
        const cal=winRegistry.calendar;
        if(cal&&!cal.isDestroyed()) cal.webContents.send('focus-note',{noteId,noteType:persisted.noteType||'independent'});
      },120);
      return {ok:true,note:persisted};
    }
    const noteWindow=createNoteWindow(noteId);
    if(!noteWindow||noteWindow.isDestroyed()){
      const rollbackResult=saveNoteDataResult(noteId,{...persisted,isHidden:true});
      if(rollbackResult.ok&&rollbackResult.note) notifyNotesChanged({note:rollbackResult.note});
      return {ok:false,message:'便签窗口未能打开，已恢复为隐藏状态'};
    }
    notifyNotesChanged({note:persisted});
    return {ok:true,note:persisted};
  });
  ipcMain.handle('get-visible-note-ids',()=>Object.entries(winRegistry.notes)
    .filter(([,w])=>w&&!w.isDestroyed()&&w.isVisible())
    .map(([id])=>id));

  ipcMain.on('begin-note-window-drag',(event,noteId,noteSnapshot,screenX,screenY)=>{
    if(getRendererContext(event).noteId!==noteId) return;
    const win=BrowserWindow.fromWebContents(event.sender);
    if(!win||win.isDestroyed()||!isSafeIdentifier(noteId)||!Number.isFinite(screenX)||!Number.isFinite(screenY)) return;
    const b=win.getBounds();
    externalNoteDrag={
      noteId,
      win,
      noteSnapshot: noteSnapshot&&typeof noteSnapshot==='object'?noteSnapshot:{},
      startBounds:b,
      offsetX:screenX-b.x,
      offsetY:screenY-b.y,
      overDock:false,
    };
    win.webContents.send('note-dock-hover',false);
  });
  ipcMain.on('move-note-window-drag',(event,screenX,screenY)=>{
    const drag=externalNoteDrag;
    if(!drag||getRendererContext(event).win!==drag.win) return;
    if(!drag||!drag.win||drag.win.isDestroyed()||!Number.isFinite(screenX)||!Number.isFinite(screenY)) return;
    const overDock=isPointInDockZone(screenX,screenY);
    const width=overDock?220:drag.startBounds.width;
    const height=overDock?168:drag.startBounds.height;
    const nextBounds=overDock
      ? {x:Math.round(screenX-width/2),y:Math.round(screenY-24),width,height}
      : {x:Math.round(screenX-drag.offsetX),y:Math.round(screenY-drag.offsetY),width,height};
    drag.win.setBounds(nextBounds);
    if(drag.overDock!==overDock){
      drag.overDock=overDock;
      drag.win.webContents.send('note-dock-hover',overDock);
    }
  });
  ipcMain.on('end-note-window-drag',(event,screenX,screenY,moved)=>{
    const drag=externalNoteDrag;
    if(!drag||getRendererContext(event).win!==drag.win) return;
    externalNoteDrag=null;
    if(!drag||!drag.win||drag.win.isDestroyed()||!Number.isFinite(screenX)||!Number.isFinite(screenY)) return;
    const overDock=(isPointInDockZone(screenX,screenY)||drag.overDock)&&!!moved;
    if(overDock){
      if(!confirmDiscardWindowDrafts(drag.win,'挂载')){
        drag.win.setBounds(drag.startBounds);
        drag.win.webContents.send('note-dock-hover',false);
        return;
      }
      const note=loadNoteData(drag.noteId);
      const nextNote={...(note||{}),...drag.noteSnapshot,isDocked:true,dockedOrder:Number.isFinite((note||{}).dockedOrder)?note.dockedOrder:Date.now()};
      const saveResult=saveNoteDataResult(drag.noteId,nextNote);
      if(!saveResult.ok||!saveResult.note){
        drag.win.webContents.send('note-dock-hover',false);
        return;
      }
      closeWindowWithoutDraftPrompt(drag.win);
      notifyNotesChanged({note:saveResult.note});
      return;
    }
    drag.win.webContents.send('note-dock-hover',false);
    debouncedSaveWindowBounds();
  });

  // ── Data persistence IPC ──
  ipcMain.handle('save-app-data',(event,key,data)=>{
    if(!isValidDataKey(key)) return false;
    if(!key.startsWith('note_')&&key!=='__crash_log') return false;
    let safeData=data;
    // Events are mutated atomically by ID through mutate-event. Refuse legacy
    // whole-array writes so a stale renderer snapshot cannot replace newer data.
    if(key==='events') return false;
    if(key==='tags'&&!Array.isArray(data)) return false;
    if(key.startsWith('note_')){
      const noteId=key.slice('note_'.length);
      if(!isSafeIdentifier(noteId)||!data||typeof data!=='object'||Array.isArray(data)) {
        return {ok:false,code:'invalid',message:'便签保存请求无效'};
      }
      if('id' in data&&data.id!==noteId) return {ok:false,code:'invalid',message:'便签 ID 不一致'};
      const expectedRevision=getNoteRevision(data);
      // Preserve fields written by newer versions or another surface while
      // applying this renderer's known snapshot.
      const existing=loadNoteData(noteId);
      safeData={...(existing||{}),...data,id:noteId,updatedAt:new Date().toISOString()};
      if(existing){
        for(const field of ['noteType','isHidden','isDocked','dockedOrder','createdAt']){
          if(Object.prototype.hasOwnProperty.call(existing,field)) safeData[field]=existing[field];
        }
        if(existing.noteType==='echo'){
          safeData.echoTagId=existing.echoTagId;
          safeData.viewTagIds=Array.isArray(existing.viewTagIds)?[...existing.viewTagIds]:[];
        }
      }
      if(safeData.noteType==='daily'){
        const canonicalId=ensureSingleDailyNote();
        if(canonicalId&&canonicalId!==noteId){
          const canonical=loadNoteData(canonicalId);
          const merged=mergeDailyNoteRecords([
            {id:canonicalId,note:canonical||{id:canonicalId,noteType:'daily',items:[]}},
            {id:noteId,note:safeData},
          ],canonicalId);
          if(!merged||!saveNoteData(canonicalId,merged)) {
            recordNotePersistenceResult(event.sender.id,noteId,false);
            return {ok:false,code:'save_failed',message:'每日待办未能写入磁盘'};
          }
          recordNotePersistenceResult(event.sender.id,noteId,true);
          notifyNotesChanged({deletedId:noteId});
          const persistedCanonical=loadNoteData(canonicalId)||merged;
          notifyNotesChanged({note:persistedCanonical});
          const staleWindow=BrowserWindow.fromWebContents(event.sender);
          if(staleWindow&&staleWindow!==winRegistry.calendar&&!staleWindow.isDestroyed()){
            setTimeout(()=>{
              if(!staleWindow.isDestroyed()) staleWindow.close();
            },0);
          }
          return {ok:true,note:persistedCanonical};
        }
      }
      const result=saveNoteDataResult(noteId,safeData,{expectedRevision});
      recordNotePersistenceResult(event.sender.id,noteId,result.ok);
      if(result.ok&&result.note) notifyNotesChanged({note:result.note},event.sender.id);
      return result;
    }
    return saveAppData(`${key}.json`,safeData);
  });
  ipcMain.handle('load-app-data',(_event,key)=>{
    if(!isValidDataKey(key)) return null;
    if(!key.startsWith('note_')&&key!=='notes'&&key!=='__crash_log') return null;
    return loadAppData(`${key}.json`);
  });

  ipcMain.handle('get-notes-state',async()=>{
    if(noteCacheHydrationPromise) await noteCacheHydrationPromise;
    return getAllNotesState();
  });
  ipcMain.handle('get-note-summaries',async()=>{
    if(noteCacheHydrationPromise) await noteCacheHydrationPromise;
    return getNoteSummaries();
  });

  ipcMain.handle('get-events-state',()=>getEventsState());
  ipcMain.handle('mutate-event',(_event,request)=>{
    try { return mutateEventRecord(request); }
    catch(e){
      console.error('mutate-event failed:',e.message);
      return eventMutationFailure('internal', '事件保存失败，请重试');
    }
  });

  // ── Restore note windows on restart ──
  ipcMain.on('restore-notes',(_event,noteIds)=>{
    if(Array.isArray(noteIds)){
      const ids=[...new Set(noteIds.filter(isSafeIdentifier))];
      let cursor=0;
      const restoreBatch=()=>{
        ids.slice(cursor,cursor+8).forEach(id=>createNoteWindow(id));
        cursor+=8;
        if(cursor<ids.length) setTimeout(restoreBatch,40);
      };
      restoreBatch();
      const hasSavedBounds = ids.some(id => windowBounds[id]);
      if(!hasSavedBounds) setTimeout(()=>tidyAllNotes(),Math.ceil(ids.length/8)*45+80);
    }
  });

  // ── Tag management ──
  ipcMain.handle('get-tags',()=>{
    try{return loadTagsState()}catch(e){
      console.error('get-tags failed:',e.message);
      return {tags:[],loadError:'标签数据无法读取；标签已切换为只读，原文件不会被覆盖。'};
    }
  });
  ipcMain.handle('save-tag',(_event,tag)=>{
    try{
      const safeTag=sanitizeTagPayload(tag);
      if(!safeTag) return {ok:false,message:'标签内容无效'};
      const state=loadTagsState();
      if(state.loadError) return {ok:false,loadError:state.loadError,message:state.loadError};
      const tags=[...state.tags];
      const idx=tags.findIndex(t=>t.id===safeTag.id);
      if(idx>=0) tags[idx]=safeTag;
      else tags.push(safeTag);
      if(!saveAppData('tags.json',tags)) return {ok:false,message:'标签未能写入磁盘'};
      tagsLoadError=null;
      return {ok:true,tag:safeTag};
    }catch(e){console.error('save-tag failed:',e.message);return {ok:false,message:'标签未能保存，原数据已保留'}}
  });
  ipcMain.handle('delete-tag',(event,tagId)=>{
    try{
      if(!isSafeIdentifier(tagId)) return {ok:false,message:'标签 ID 无效'};
      const state=loadTagsState();
      if(state.loadError) return {ok:false,loadError:state.loadError,message:state.loadError};
      const tags=state.tags.filter(t=>t.id!==tagId);
      const events=loadEventsSnapshot();
      if(eventsLoadError) return {ok:false,message:eventsLoadError};
      const updatedEvents=events.map(ev=>{
        if(!ev||ev.tagId!==tagId) return ev;
        const next={...ev};
        delete next.tagId;
        next.updatedAt=new Date().toISOString();
        return next;
      });
      const changes=[
        {fileName:'events.json',data:updatedEvents},
        {fileName:'tags.json',data:tags},
      ];
      let notesChanged=false;
      const changedNotes=[];
      const trashedViewNotes=[];
      for(const [fileNoteId,raw] of noteCache.entries()){
        if(!raw||typeof raw!=='object'||Array.isArray(raw)) continue;
        const viewTagIds=Array.isArray(raw.viewTagIds)?raw.viewTagIds.filter(id=>id!==tagId):raw.viewTagIds;
        const nextEchoTagId=raw.echoTagId===tagId?(Array.isArray(viewTagIds)?viewTagIds[0]:undefined):raw.echoTagId;
        const changed=raw.echoTagId===tagId||(Array.isArray(raw.viewTagIds)&&viewTagIds.length!==raw.viewTagIds.length);
        if(!changed) continue;
        if(!isSafeIdentifier(fileNoteId)) continue;
        if(raw.noteType==='echo'&&(!Array.isArray(viewTagIds)||viewTagIds.length===0)){
          const trashId=`trash_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
          changes.push({
            fileName:`.trash/${trashId}.json`,
            data:{trashId,noteId:fileNoteId,deletedAt:new Date().toISOString(),note:raw,bounds:windowBounds[fileNoteId]||null},
          });
          changes.push({fileName:`note_${fileNoteId}.json`,delete:true});
          trashedViewNotes.push(fileNoteId);
        }else{
          const nextNote={
            ...raw,
            viewTagIds,
            echoTagId:nextEchoTagId,
            revision:getNoteRevision(raw)+1,
            updatedAt:new Date().toISOString(),
          };
          changes.push({fileName:`note_${fileNoteId}.json`,data:nextNote});
          changedNotes.push([fileNoteId,nextNote]);
        }
        notesChanged=true;
      }
      const affectedNoteIds=[...changedNotes.map(([noteId])=>noteId),...trashedViewNotes];
      if(!confirmDiscardNoteDrafts(affectedNoteIds,'删除标签',getRendererContext(event).win)) {
        return {ok:false,canceled:true,message:'已取消删除标签，便签和草稿均保留'};
      }
      applyDataChanges(changes,'delete tag');
      changedNotes.forEach(([noteId,note])=>noteCache.set(noteId,note));
      for(const noteId of trashedViewNotes){
        noteCache.delete(noteId);
        delete windowBounds[noteId];
        const noteWindow=winRegistry.notes[noteId];
        if(noteWindow&&!noteWindow.isDestroyed()) closeWindowWithoutDraftPrompt(noteWindow);
        delete winRegistry.notes[noteId];
      }
      if(trashedViewNotes.length>0) saveWindowBounds();
      eventsCache=updatedEvents;
      eventsRevision=Math.max(Date.now(),eventsRevision+1);
      broadcastEventsChanged({tagId,action:'tag-deleted'});
      if(notesChanged) notifyNotesChanged();
      return {ok:true};
    }catch(e){console.error('delete-tag failed:',e.message);return {ok:false,message:'标签未能删除，原数据已保留'}}
  });

  // ── Event sync ──
  ipcMain.on('notify-events-changed',()=>{
    broadcastEventsChanged({action:'events-changed'});
  });
  ipcMain.handle('create-event-from-echo',(_event,eventData)=>{
    try{
      const result=mutateEventRecord({type:'create',event:eventData});
      if(!result.ok||!result.event) return null;
      const safeEvent=result.event;
      if(winRegistry.calendar&&!winRegistry.calendar.isDestroyed()){
        winRegistry.calendar.webContents.send('echo-event-created',safeEvent);
      }
      return safeEvent;
    }catch(e){console.error('create-event-from-echo failed:',e.message);return null}
  });
  ipcMain.handle('get-events-by-tag',(_event,tagId)=>{
    try{
      const events=loadEventsSnapshot();
      return eventsByTag(events,tagId,eventsLoadError);
    }catch(e){
      console.error('get-events-by-tag failed:',e.message);
      throw e;
    }
  });

  // ── Dock management (window lifecycle only; render manages dock UI) ──
  ipcMain.handle('dock-note',(event,noteId,noteSnapshot)=>{
    if(getRendererContext(event).noteId!==noteId) return {ok:false,message:'当前便签窗口与目标不一致'};
    if(!isSafeIdentifier(noteId)) return {ok:false,message:'便签 ID 无效'};
    const w=winRegistry.notes[noteId];
    if(w&&!w.isDestroyed()&&!confirmDiscardWindowDrafts(w,'挂载')) return {ok:false,canceled:true,message:'已取消挂载，草稿仍保留'};
    const snapshot=noteSnapshot&&typeof noteSnapshot==='object'?noteSnapshot:{};
    const nextNote={...snapshot,isDocked:true,dockedOrder:Number.isFinite(snapshot.dockedOrder)?snapshot.dockedOrder:Date.now()};
    const saveResult=saveNoteDataResult(noteId,nextNote);
    if(!saveResult.ok||!saveResult.note) return {ok:false,message:'便签状态未能写入磁盘'};
    const persisted=saveResult.note;
    if(w&&!w.isDestroyed()) closeWindowWithoutDraftPrompt(w); // close window, renderer renders in calendar
    notifyNotesChanged({note:persisted});
    return {ok:true,note:persisted};
  });
  const undockNoteFromCalendar=(noteId,noteSnapshot,placement)=>{
    if(!isSafeIdentifier(noteId)) return {ok:false,message:'便签 ID 无效'};
    if(!confirmDiscardNoteDrafts([noteId],'取消挂载',winRegistry.calendar)) return {ok:false,canceled:true,message:'已取消挂载，草稿仍保留'};
    const existing=loadNoteData(noteId);
    if(!existing) return {ok:false,message:'找不到要取消挂载的便签'};
    const snapshot=noteSnapshot&&typeof noteSnapshot==='object'?noteSnapshot:{};
    const nextNote={...existing,...snapshot,id:noteId,isDocked:false,isHidden:false};
    const saveResult=saveNoteDataResult(noteId,nextNote);
    if(!saveResult.ok||!saveResult.note) return {ok:false,message:'便签状态未能写入磁盘'};
    const persisted=saveResult.note;
    const noteWindow=createNoteWindow(noteId,false,placement);
    if(!noteWindow||noteWindow.isDestroyed()){
      const rollbackResult=saveNoteDataResult(noteId,{...persisted,isDocked:true});
      if(rollbackResult.ok&&rollbackResult.note) notifyNotesChanged({note:rollbackResult.note});
      return {ok:false,message:'便签窗口未能打开，已保留在挂载区'};
    }
    notifyNotesChanged({note:persisted});
    return {ok:true,note:persisted};
  };
  ipcMain.handle('undock-note',(_event,noteId,noteSnapshot)=>undockNoteFromCalendar(noteId,noteSnapshot));
  ipcMain.handle('undock-note-at',(_event,noteId,x,y,noteSnapshot)=>{
    if(!Number.isFinite(x)||!Number.isFinite(y)) return {ok:false,message:'拖放位置无效'};
    return undockNoteFromCalendar(noteId,noteSnapshot,{x:Math.round(x),y:Math.round(y)});
  });
  ipcMain.on('begin-dock-drag-preview',(_event,noteSnapshot,x,y)=>{
    if(!Number.isFinite(x)||!Number.isFinite(y)) return;
    beginDockDragPreview(noteSnapshot&&typeof noteSnapshot==='object'?noteSnapshot:{},x,y);
  });
  ipcMain.on('move-dock-drag-preview',(_event,x,y,outside)=>{
    if(!Number.isFinite(x)||!Number.isFinite(y)) return;
    moveDockDragPreview(x,y,!!outside);
  });
  ipcMain.on('end-dock-drag-preview',()=>destroyDockDragPreview());

  // ── Calendar height sync ──
  ipcMain.on('calendar-height',(_event,height)=>{
    const cal=winRegistry.calendar;
    if(!cal||cal.isDestroyed()) return;
    if(isCalendarCollapsed) {
      if(calendarOriginalBounds&&Number.isFinite(height)&&height>100){
        const {workArea}=screen.getDisplayMatching(calendarOriginalBounds);
        const maxHeight=Math.max(100,workArea.y+workArea.height-calendarOriginalBounds.y-8);
        calendarOriginalBounds.height=Math.min(maxHeight,Math.round(height));
      }
      return;
    }
    if(Number.isFinite(height)&&height>100){
      const b=cal.getBounds();
      const {workArea}=screen.getDisplayMatching(b);
      const maxHeight=Math.max(100,workArea.y+workArea.height-b.y-8);
      setCalendarBounds(cal,{x:b.x,y:b.y,width:b.width,height:Math.min(maxHeight,Math.round(height))});
    }
  });

  // ── Tag sync broadcast ──
  ipcMain.on('notify-tags-changed',()=>{
    const all=[winRegistry.calendar,winRegistry.settings,...Object.values(winRegistry.notes)].filter(Boolean);
    all.forEach(w=>{if(!w.isDestroyed())w.webContents.send('tags-changed')});
  });
}

// ── App ──
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance',()=>{
    if (app.isReady()) showCalendar();
  });
  app.whenReady().then(async()=>{
    if(process.platform==='win32') app.setAppUserModelId('com.oknote.app');
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    ensureDataDir();
    prepareLegacyLocalData();
    loadSettings();
    loadWindowBounds();
    setupIPC();createTray();
    if(!process.argv.includes('--hidden')) createCalendarWindow();
    noteCacheHydrationPromise=(async()=>{
      try {
        migrateLegacyNotesFile();
        noteCacheReady=false;
        await hydrateNoteCacheAsync();
        ensureSingleDailyNote();
        ensureUniqueViewNotes();
        const cal=winRegistry.calendar;
        if(cal&&!cal.isDestroyed()&&windowBounds.calendar){
          const current=cal.getBounds();
          const minimum=getCalendarMinimumSize(windowBounds.calendar);
          cal.setBounds(sanitizeWindowBounds(windowBounds.calendar,current,{minWidth:minimum.width,minHeight:minimum.height}),false);
        }
        broadcastSettings();
        notifyNotesChanged();
        const all=[winRegistry.calendar,winRegistry.settings,...Object.values(winRegistry.notes)].filter(Boolean);
        all.forEach((win)=>{if(win&&!win.isDestroyed()) win.webContents.send('tags-changed')});
      } catch (error) {
        console.error('startup note hydration failed:', error.message);
        queueStartupReliabilityIssue('便签数据未完全载入', '应用已继续启动；请检查数据目录是否可读后重试。');
        try {
          noteCacheReady=false;
          await hydrateNoteCacheAsync();
          ensureSingleDailyNote();
          ensureUniqueViewNotes();
        } catch (fallbackError) {
          console.error('fallback note hydration failed:', fallbackError.message);
          noteCacheReady=false;
        }
      }
    })();
    try { await noteCacheHydrationPromise; }
    finally { noteCacheHydrationPromise=null; }
    applyLoginItemSettings();
    startReminderScheduler();
    // Start async font loading in background (non-blocking)
    loadSystemFontsAsync();
    if(!app.isPackaged&&process.env.OKNOTE_SMOKE_TEST==='1'){
      fs.writeFileSync(path.join(USER_DATA_DIR,'.smoke-ready'),new Date().toISOString(),'utf8');
      setTimeout(()=>{forceAppQuit=true;app.isQuitting=true;app.quit()},120);
    }
  });
  app.on('window-all-closed',()=>{});
  app.on('before-quit',(event)=>{
    if(!forceAppQuit){
      event.preventDefault();
      requestAppQuit();
      return;
    }
    app.isQuitting=true;
    clearTimeout(boundsSaveTimer);
    if(settingsSaveTimer) clearTimeout(settingsSaveTimer);
    if(settingsBroadcastTimer) clearTimeout(settingsBroadcastTimer);
    settingsSaveTimer=null;
    settingsBroadcastTimer=null;
    saveSettings();
    if(!eventsLoadError) checkpointReminderState(Date.now(), true);
    stopReminderScheduler();
    saveWindowBounds();
  });
  app.on('activate',()=>{createCalendarWindow()});
}
