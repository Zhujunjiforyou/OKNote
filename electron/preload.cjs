const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,

  // ── Settings ──
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSetting: (windowType, key, value) => ipcRenderer.send('set-setting', windowType, key, value),
  onSettingsChanged: (callback) => {
    const handler = (_event, settings) => callback(settings);
    ipcRenderer.on('settings-changed', handler);
    return () => ipcRenderer.removeListener('settings-changed', handler);
  },

  // ── System fonts ──
  getSystemFonts: () => ipcRenderer.invoke('get-system-fonts'),

  // ── Window ──
  closeWindow: () => ipcRenderer.send('window-close'),
  hideNote: () => ipcRenderer.send('hide-note'),

  // ── Actions from main process ──
  onAction: (callback) => {
    const handler = (_event, action) => callback(action);
    ipcRenderer.on('action', handler);
    return () => ipcRenderer.removeListener('action', handler);
  },

  // ── Note management (for launcher) ──
  createNote: () => ipcRenderer.send('create-note'),
  deleteNote: (noteId) => ipcRenderer.send('delete-note', noteId),
  showNote: (noteId) => ipcRenderer.send('show-note', noteId),
  getVisibleNoteIds: () => ipcRenderer.invoke('get-visible-note-ids'),
  openSettings: () => ipcRenderer.send('open-settings'),
  tidyNotes: () => ipcRenderer.send('tidy-notes'),
  setAutoLaunch: (enabled) => ipcRenderer.send('set-auto-launch', enabled),

  // ── Data persistence ──
  saveAppData: (key, data) => ipcRenderer.invoke('save-app-data', key, data),
  loadAppData: (key) => ipcRenderer.invoke('load-app-data', key),
  deleteAppData: (key) => ipcRenderer.invoke('delete-app-data', key),
  listAppData: (prefix) => ipcRenderer.invoke('list-app-data', prefix),
  restoreNotes: (noteIds) => ipcRenderer.send('restore-notes', noteIds),
});
