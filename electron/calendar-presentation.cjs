// Only explicit commands temporarily raise the desktop calendar. Ordinary
// desktop clicks and note drags keep the nonactivating panel at desktop level.
function createCalendarPresentation(configureDesktopWindow, app, platform = process.platform) {
  let presented = null;
  let cleanup = null;
  let pendingRestore = null;
  const restore = () => {
    clearImmediate(pendingRestore);
    pendingRestore = null;
    const win = presented;
    presented = null;
    cleanup?.();
    cleanup = null;
    if (win && !win.isDestroyed()) configureDesktopWindow(win);
  };
  const resignActive = () => {
    clearImmediate(pendingRestore);
    // A notification click can briefly move key focus between our panels.
    // Wait for the activation event to finish, then check the application.
    pendingRestore = setImmediate(() => {
      pendingRestore = null;
      if (!app.isActive()) restore();
    });
  };
  const present = (win, { activateApp = false } = {}) => {
    clearImmediate(pendingRestore);
    pendingRestore = null;
    if (platform === 'darwin' && presented !== win) {
      restore();
      // Normal level, ordered in front; never above other applications forever.
      configureDesktopWindow(win, { relativeLevel: 0 });
      presented = win;
      // Window blur also happens inside OKNote and during native activation.
      // Only leaving the application or explicitly hiding/closing it ends presentation.
      app.on('did-resign-active', resignActive);
      // On macOS, hide also reports occlusion during Dock activation. It does
      // not mean the user hid the window. The tray hide command restores explicitly.
      const hidden = () => { if (app.isHidden()) restore(); };
      win.on('hide', hidden);
      for (const event of ['closed', 'minimize']) win.on(event, restore);
      cleanup = () => {
        app.removeListener('did-resign-active', resignActive);
        win.removeListener('hide', hidden);
        for (const event of ['closed', 'minimize']) win.removeListener(event, restore);
      };
    }
    if (win.isMinimized()) win.restore();
    win.show();
    // A nonactivating panel cannot bring its application forward on its own.
    // Only explicit tray opens opt in; ordinary desktop interaction stays inactive.
    if (platform === 'darwin' && activateApp) app.focus({ steal: true });
    win.moveTop();
    win.focus();
  };
  return { present, restore };
}

module.exports = { createCalendarPresentation };
