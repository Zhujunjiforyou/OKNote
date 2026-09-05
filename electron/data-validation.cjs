const { HEX_COLOR_RE, isPlainRecord, isSafeIdentifier, isFiniteNumber, isDateKey } = require('./data-rules.cjs');

function degradedValidation(reason, details = {}) {
  return { valid: true, degraded: true, reason, ...details };
}

function isAcceptedValidation(result) {
  return result === true || (isPlainRecord(result) && result.valid === true);
}

function isDegradedValidation(result) {
  return isPlainRecord(result) && result.valid === true && result.degraded === true;
}

function assessRecoverableArrayDocument(value, entryValidator, identitySelector = null) {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;

  let validEntries = 0;
  let invalidEntries = 0;
  let degradedEntries = 0;
  let duplicateEntries = 0;
  const seenIds = new Set();
  for (const entry of value) {
    const result = entryValidator(entry);
    if (!isAcceptedValidation(result)) {
      invalidEntries += 1;
      continue;
    }
    validEntries += 1;
    if (isDegradedValidation(result)) degradedEntries += 1;
    if (typeof identitySelector === 'function') {
      const identity = identitySelector(entry);
      if (typeof identity === 'string' && identity) {
        if (seenIds.has(identity)) duplicateEntries += 1;
        else seenIds.add(identity);
      }
    }
  }

  if (validEntries === 0) return false;
  if (invalidEntries > 0 || degradedEntries > 0 || duplicateEntries > 0) {
    return degradedValidation('mixed-validity-records', {
      totalEntries: value.length,
      validEntries,
      invalidEntries,
      degradedEntries,
      duplicateEntries,
    });
  }
  return true;
}

function isRecoverableEvent(value) {
  return isPlainRecord(value) && isSafeIdentifier(value.id) && isDateKey(value.startDate);
}

function isRecoverableNoteItem(value) {
  return isPlainRecord(value)
    && (typeof value.id === 'string' || typeof value.content === 'string');
}

function assessRecoverableNote(value, expectedId) {
  if (!isPlainRecord(value) || !Array.isArray(value.items)) return false;
  if (expectedId) {
    if (Object.prototype.hasOwnProperty.call(value, 'id') && value.id !== expectedId) return false;
  } else if (!isSafeIdentifier(value.id)) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'noteType')
    && !['independent', 'echo', 'view', 'daily'].includes(value.noteType)) return false;
  return assessRecoverableArrayDocument(
    value.items,
    isRecoverableNoteItem,
    (item) => (isPlainRecord(item) && typeof item.id === 'string' ? item.id : null),
  );
}

function isRecoverableReminderHistoryEntry(value) {
  return isPlainRecord(value)
    && isSafeIdentifier(value.id)
    && isSafeIdentifier(value.eventId)
    && isDateKey(value.startDate)
    && typeof value.firedAt === 'string'
    && Number.isFinite(Date.parse(value.firedAt));
}

function assessRecoverableReminderState(value) {
  if (!isPlainRecord(value) || !isPlainRecord(value.fired)) return false;
  if (Object.prototype.hasOwnProperty.call(value, 'lastCheckedAt')
    && (typeof value.lastCheckedAt !== 'string' || !Number.isFinite(Date.parse(value.lastCheckedAt)))) return false;
  const firedEntries = Object.entries(value.fired);
  return assessRecoverableArrayDocument(firedEntries, ([key, timestamp]) => (
    typeof key === 'string'
      && key.length > 0
      && key.length <= 520
      && typeof timestamp === 'string'
      && Number.isFinite(Date.parse(timestamp))
  ), ([key]) => key);
}

const SETTINGS_FIELD_VALIDATORS = {
  themeMode: (value) => value === 'dark' || value === 'light',
  autoLaunch: (value) => typeof value === 'boolean',
  startMinimized: (value) => typeof value === 'boolean',
  hideNotificationContent: (value) => typeof value === 'boolean',
  globalFontFamily: (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 120,
  globalFontSize: (value) => isFiniteNumber(value),
};

const WINDOW_SETTING_FIELD_VALIDATORS = {
  fontFamily: (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 120,
  fontSize: (value) => isFiniteNumber(value),
  backgroundColor: (value) => typeof value === 'string' && HEX_COLOR_RE.test(value),
  backgroundOpacity: (value) => isFiniteNumber(value),
  textColor: (value) => typeof value === 'string' && HEX_COLOR_RE.test(value),
  edgeAutoHide: (value) => typeof value === 'boolean',
  showDockArea: (value) => typeof value === 'boolean',
};

function validateKnownFields(record, validators, requireKnownField = true) {
  if (!isPlainRecord(record)) return false;
  const knownEntries = Object.entries(validators)
    .filter(([key]) => Object.prototype.hasOwnProperty.call(record, key));
  if (requireKnownField && knownEntries.length === 0) return false;
  return knownEntries.every(([key, validator]) => validator(record[key]));
}

function isRecoverableWindowSettings(value) {
  return validateKnownFields(value, WINDOW_SETTING_FIELD_VALIDATORS);
}

function isRecoverableSettings(value) {
  if (!isPlainRecord(value)) return false;
  const scalarSettings = Object.fromEntries(
    Object.keys(SETTINGS_FIELD_VALIDATORS)
      .filter((key) => Object.prototype.hasOwnProperty.call(value, key))
      .map((key) => [key, value[key]]),
  );
  const hasScalarSetting = Object.keys(scalarSettings).length > 0;
  if (hasScalarSetting && !validateKnownFields(scalarSettings, SETTINGS_FIELD_VALIDATORS)) return false;
  const hasCalendar = Object.prototype.hasOwnProperty.call(value, 'calendar');
  const hasNotes = Object.prototype.hasOwnProperty.call(value, 'notes');
  if (hasCalendar && !isRecoverableWindowSettings(value.calendar)) return false;
  if (hasNotes && !isRecoverableWindowSettings(value.notes)) return false;
  return hasScalarSetting || hasCalendar || hasNotes;
}

function isRecoverableWindowBounds(value) {
  if (!isPlainRecord(value)) return false;
  return Object.values(value).every((bounds) => isPlainRecord(bounds)
    && isFiniteNumber(bounds.width)
    && isFiniteNumber(bounds.height)
    && (!Object.prototype.hasOwnProperty.call(bounds, 'x') || isFiniteNumber(bounds.x))
    && (!Object.prototype.hasOwnProperty.call(bounds, 'y') || isFiniteNumber(bounds.y)));
}

function isValidTagsDocument(value) {
  if (!Array.isArray(value)) return false;
  const seenIds = new Set();
  return value.every((tag) => {
    if (!isPlainRecord(tag) || !isSafeIdentifier(tag.id)) return false;
    const name = typeof tag.name === 'string' ? tag.name.trim() : '';
    if (!name || name.length > 50 || seenIds.has(tag.id)) return false;
    seenIds.add(tag.id);
    return true;
  });
}

function dataDocumentValidator(fileName) {
  if (fileName === 'events.json') {
    return (value) => assessRecoverableArrayDocument(value, isRecoverableEvent, (event) => (
      isPlainRecord(event) && typeof event.id === 'string' ? event.id : null
    ));
  }
  if (fileName === 'notes.json') {
    return (value) => assessRecoverableArrayDocument(value, (note) => assessRecoverableNote(note), (note) => (
      isPlainRecord(note) && typeof note.id === 'string' ? note.id : null
    ));
  }
  if (fileName === 'reminder-history.json') {
    return (value) => assessRecoverableArrayDocument(value, isRecoverableReminderHistoryEntry, (entry) => (
      isPlainRecord(entry) && typeof entry.id === 'string' ? entry.id : null
    ));
  }
  if (fileName === 'tags.json') return isValidTagsDocument;
  if (fileName === 'settings.json') return isRecoverableSettings;
  if (fileName === 'window-bounds.json') return isRecoverableWindowBounds;
  if (fileName === 'reminder-state.json') return assessRecoverableReminderState;
  const noteMatch = /^note_([a-zA-Z0-9_-]+)\.json$/.exec(fileName);
  if (noteMatch) return (value) => assessRecoverableNote(value, noteMatch[1]);
  if (fileName === '__crash_log.json') {
    return (value) => isPlainRecord(value) || Array.isArray(value);
  }
  return () => true;
}

function canonicalNoteFileNames(entries) {
  const noteIds = new Set();
  for (const entry of entries) {
    const match = /^note_([a-zA-Z0-9_-]+)\.json(?:\.bak)?$/.exec(entry);
    if (match) noteIds.add(match[1]);
  }
  return [...noteIds].sort().map((noteId) => `note_${noteId}.json`);
}

function isValidTrashRecord(record) {
  return isPlainRecord(record)
    && isSafeIdentifier(record.trashId)
    && isSafeIdentifier(record.noteId)
    && assessRecoverableNote(record.note, record.noteId) === true
    && typeof record.deletedAt === 'string'
    && Number.isFinite(Date.parse(record.deletedAt));
}

function getReadOnlyDataTargets(changes, loadErrors) {
  if (!Array.isArray(changes) || !loadErrors || typeof loadErrors.has !== 'function') return [];
  return [...new Set(changes
    .map((change) => (isPlainRecord(change) && typeof change.fileName === 'string' ? change.fileName : null))
    .filter((fileName) => fileName && loadErrors.has(fileName)))];
}

function canonicalTrashRecordNames(entries) {
  const names = new Set();
  for (const entry of entries) {
    const match = /^(trash_[a-zA-Z0-9_-]+\.json)(?:\.bak)?$/.exec(entry);
    if (match) names.add(match[1]);
  }
  return [...names].sort();
}

module.exports = {
  canonicalNoteFileNames,
  canonicalTrashRecordNames,
  dataDocumentValidator,
  getReadOnlyDataTargets,
  isValidTagsDocument,
  isValidTrashRecord,
};
