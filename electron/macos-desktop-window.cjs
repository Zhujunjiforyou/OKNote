const path = require('node:path');

let binding;
function getBinding() {
  if (!binding) {
    const { app } = require('electron');
    const file = app.isPackaged
      ? path.join(process.resourcesPath, 'native', 'desktop-window.node')
      : path.join(__dirname, '..', 'build', 'native', `darwin-${process.arch}`, 'desktop-window.node');
    binding = require(file);
  }
  return binding;
}

function configureDesktopWindow(win, { level = 'normal', relativeLevel = -1, focusable = true } = {}) {
  // The caller creates a nonactivating panel so show()/focus() do not activate
  // the app. Set the level before Stationary because Electron updates native
  // collection behavior when it changes Chromium's cached window level.
  win.setAlwaysOnTop(true, level, relativeLevel);
  win.setFocusable(focusable);
  getBinding().configure(win.getNativeWindowHandle());
}

module.exports = { configureDesktopWindow, getBinding };
