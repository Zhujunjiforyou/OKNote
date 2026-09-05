// Shared Electron value rules. Renderer parity is exercised in data-rules.test.ts.
const SAFE_IDENTIFIER_RE = /^[a-zA-Z0-9_-]{1,160}$/;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafeIdentifier(value) {
  return typeof value === 'string' && SAFE_IDENTIFIER_RE.test(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isDateKey(value) {
  if (typeof value !== 'string' || !DATE_KEY_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function isTimeKey(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function safeHexColor(value, fallback = '#2563EB') {
  return typeof value === 'string' && HEX_COLOR_RE.test(value) ? value : fallback;
}

module.exports = { HEX_COLOR_RE, isPlainRecord, isSafeIdentifier, isFiniteNumber, isDateKey, isTimeKey, safeHexColor };
