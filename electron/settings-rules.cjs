// Pure settings rules; persistence, defaults and window effects stay in main.cjs.
const { HEX_COLOR_RE, isPlainRecord, safeHexColor } = require('./data-rules.cjs');

const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 60;

function clampFontSetting(value) {
  const numeric = Number(value);
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Number.isFinite(numeric) ? numeric : 14));
}

function safeFontFamily(value, fallback) {
  return typeof value === 'string' && value.trim() && value.length <= 120 ? value.trim() : fallback;
}

function safeOpacity(value, fallback = 0.88) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(1, Math.max(0.1, numeric)) : fallback;
}

function normalizeWindowSettings(raw, fallback, includeEdgeAutoHide = false) {
  const source = isPlainRecord(raw) ? raw : {};
  return {
    fontFamily: safeFontFamily(source.fontFamily, fallback.fontFamily),
    fontSize: clampFontSetting(source.fontSize),
    backgroundColor: safeHexColor(source.backgroundColor, fallback.backgroundColor),
    backgroundOpacity: safeOpacity(source.backgroundOpacity, fallback.backgroundOpacity),
    textColor: safeHexColor(source.textColor, fallback.textColor),
    ...(includeEdgeAutoHide ? {
      edgeAutoHide: source.edgeAutoHide !== false,
      showDockArea: source.showDockArea !== false,
    } : {}),
  };
}

// Stored settings may fall back; invalid IPC colors/fonts/opacity are rejected.
function sanitizeSettingChange(scope, key, value) {
  if (scope === 'theme' && key === 'themeMode') return value === 'light' || value === 'dark' ? value : undefined;
  if (scope === 'global' && key === 'globalFontSize') return clampFontSetting(value);
  if (scope === 'global' && key === 'globalFontFamily') return safeFontFamily(value, undefined);
  if (scope === 'global' && key === 'startMinimized') return value === true;
  if (scope === 'global' && key === 'hideNotificationContent') return value === true;
  if (scope !== 'calendar' && scope !== 'notes') return undefined;
  if (key === 'fontFamily') return safeFontFamily(value, undefined);
  if (key === 'fontSize') return clampFontSetting(value);
  if (key === 'backgroundColor' || key === 'textColor') {
    return typeof value === 'string' && HEX_COLOR_RE.test(value) ? value : undefined;
  }
  if (key === 'backgroundOpacity') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? safeOpacity(numeric) : undefined;
  }
  if (scope === 'calendar' && key === 'edgeAutoHide') return !!value;
  if (scope === 'calendar' && key === 'showDockArea') return !!value;
  return undefined;
}

module.exports = { clampFontSetting, safeFontFamily, normalizeWindowSettings, sanitizeSettingChange };
