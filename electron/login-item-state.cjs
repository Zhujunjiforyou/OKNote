const path = require('node:path');
const { loginItemOptions } = require('./platform.cjs');

function macLoginItemState(actual) {
  const pending = actual.status === 'requires-approval';
  const enabled = pending || actual.openAtLogin === true;
  return {
    enabled,
    status: actual.status || (enabled ? 'enabled' : 'not-registered'),
    pending,
    message: pending ? '等待 macOS 批准，请在系统设置 → 通用 → 登录项中允许 OKNote。' : '',
  };
}

function setMacLoginItem(app, enabled) {
  // A pending request is already registered. Do not re-register it, or undo a
  // user's choice in System Settings on the next ordinary app launch.
  let state = macLoginItemState(app.getLoginItemSettings());
  if (state.enabled !== enabled) {
    app.setLoginItemSettings({ openAtLogin: enabled });
    state = macLoginItemState(app.getLoginItemSettings());
  }
  return { ...state, ok: state.enabled === enabled };
}

function setWindowsLoginItem(app, settings, explicitEnable = false, executable = process.execPath) {
  // Keep the name stable across notification identity and product-name changes.
  const options = loginItemOptions(settings, 'win32', executable);
  // Electron parses the query path as a command line; quote paths with spaces.
  const query = { path: `"${options.path}"`, args: options.args };
  const ownItem = (item) => item.scope === 'user' && typeof item.path === 'string'
    && path.win32.normalize(item.path).toLowerCase() === path.win32.normalize(executable).toLowerCase();
  const readItems = () => (app.getLoginItemSettings(query).launchItems || []).filter(ownItem);
  const matchingArgs = (item) => Array.isArray(item.args) && item.args.length === options.args.length
    && item.args.every((arg, index) => arg === options.args[index]);
  let items = readItems();
  const canonical = items.find((item) => item.name === options.name);
  const legacy = items.find((item) => item.name === 'electron.app.OKNote');
  // Ordinary launches and --hidden changes must preserve Windows' disabled state.
  const enabled = explicitEnable || (canonical || legacy)?.enabled !== false;
  if (!options.openAtLogin || !canonical || !matchingArgs(canonical) || canonical.enabled !== enabled) {
    app.setLoginItemSettings({ ...options, enabled });
  }
  items = readItems();
  const registered = items.some((item) => item.name === options.name && (!options.openAtLogin || matchingArgs(item)));
  if (registered !== options.openAtLogin || (explicitEnable && !items.some((item) => item.name === options.name && item.enabled))) {
    return { ok: false, enabled: registered, startMinimized: settings.startMinimized };
  }
  // Migrate only the known old name for this executable and account, after the
  // replacement has been verified. Other Electron apps/installations stay intact.
  for (const item of items.filter((entry) => entry.name === 'electron.app.OKNote')) {
    app.setLoginItemSettings({ name: item.name, path: executable, openAtLogin: false });
  }
  items = readItems();
  const current = items.some((item) => item.name === options.name && (!options.openAtLogin || matchingArgs(item)));
  return {
    ok: current === options.openAtLogin && !items.some((item) => item.name === 'electron.app.OKNote'),
    enabled: current,
    startMinimized: settings.startMinimized,
  };
}

module.exports = { setWindowsLoginItem, macLoginItemState, setMacLoginItem };
