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

module.exports = { macLoginItemState, setMacLoginItem };
