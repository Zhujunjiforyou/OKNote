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
  hideNoteById: (noteId) => ipcRenderer.send('hide-note-by-id', noteId),

  // ── Actions from main process ──
  onAction: (callback) => {
    const handler = (_event, action) => callback(action);
    ipcRenderer.on('action', handler);
    return () => ipcRenderer.removeListener('action', handler);
  },

  // ── Note management (for launcher) ──
  createNote: (options) => ipcRenderer.send('create-note', options),
  deleteNote: (noteId) => ipcRenderer.send('delete-note', noteId),
  showNote: (noteId) => ipcRenderer.send('show-note', noteId),
  getVisibleNoteIds: () => ipcRenderer.invoke('get-visible-note-ids'),
  openSettings: () => ipcRenderer.send('open-settings'),
  tidyNotes: () => ipcRenderer.send('tidy-notes'),
  setAutoLaunch: (enabled) => ipcRenderer.send('set-auto-launch', enabled),
  showDayContextMenu: (dateStr, screenX, screenY) => ipcRenderer.send('show-day-context-menu', dateStr, screenX, screenY),
  openEventEditor: (eventData) => ipcRenderer.send('open-event-editor', eventData),
  onOpenEventEditor: (callback) => {
    const handler = (_event, eventData) => callback(eventData);
    ipcRenderer.on('open-event-editor', handler);
    return () => ipcRenderer.removeListener('open-event-editor', handler);
  },
  onDayContextAction: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('day-context-action', handler);
    return () => ipcRenderer.removeListener('day-context-action', handler);
  },

  // ── Data persistence ──
  saveAppData: (key, data) => ipcRenderer.invoke('save-app-data', key, data),
  loadAppData: (key) => ipcRenderer.invoke('load-app-data', key),
  deleteAppData: (key) => ipcRenderer.invoke('delete-app-data', key),
  listAppData: (prefix) => ipcRenderer.invoke('list-app-data', prefix),
  restoreNotes: (noteIds, dockedIds) => ipcRenderer.send('restore-notes', noteIds, dockedIds),

  // ── Tags ──
  getTags: () => ipcRenderer.invoke('get-tags'),
  saveTag: (tag) => ipcRenderer.invoke('save-tag', tag),
  deleteTag: (tagId) => ipcRenderer.invoke('delete-tag', tagId),

  // ── Event sync ──
  notifyEventsChanged: () => ipcRenderer.send('notify-events-changed'),
  onEventsChanged: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('events-changed', handler);
    return () => ipcRenderer.removeListener('events-changed', handler);
  },
  createEventFromEcho: (eventData) => ipcRenderer.invoke('create-event-from-echo', eventData),
  onEchoEventCreated: (callback) => {
    const handler = (_event, eventData) => callback(eventData);
    ipcRenderer.on('echo-event-created', handler);
    return () => ipcRenderer.removeListener('echo-event-created', handler);
  },
  getEventsByTag: (tagId) => ipcRenderer.invoke('get-events-by-tag', tagId),

  // ── Dock management ──
  dockNote: (noteId, noteSnapshot) => ipcRenderer.send('dock-note', noteId, noteSnapshot),
  undockNote: (noteId, noteSnapshot) => ipcRenderer.send('undock-note', noteId, noteSnapshot),
  undockNoteAt: (noteId, x, y, noteSnapshot) => ipcRenderer.send('undock-note-at', noteId, x, y, noteSnapshot),
  beginNoteWindowDrag: (noteId, noteSnapshot, screenX, screenY) => ipcRenderer.send('begin-note-window-drag', noteId, noteSnapshot, screenX, screenY),
  moveNoteWindowDrag: (screenX, screenY) => ipcRenderer.send('move-note-window-drag', screenX, screenY),
  endNoteWindowDrag: (screenX, screenY, moved) => ipcRenderer.send('end-note-window-drag', screenX, screenY, moved),
  onNoteDockHover: (callback) => {
    const handler = (_event, inside) => callback(inside);
    ipcRenderer.on('note-dock-hover', handler);
    return () => ipcRenderer.removeListener('note-dock-hover', handler);
  },
  beginDockDragPreview: (noteSnapshot, x, y) => ipcRenderer.send('begin-dock-drag-preview', noteSnapshot, x, y),
  moveDockDragPreview: (x, y, outside) => ipcRenderer.send('move-dock-drag-preview', x, y, outside),
  endDockDragPreview: () => ipcRenderer.send('end-dock-drag-preview'),

  // ── Edge auto-hide state ──
  onToggleCollapse: (callback) => {
    const handler = (_event, collapsed) => callback(collapsed);
    ipcRenderer.on('toggle-collapse', handler);
    return () => ipcRenderer.removeListener('toggle-collapse', handler);
  },

  // ── Calendar height sync ──
  notifyCalendarHeight: (height) => ipcRenderer.send('calendar-height', height),

  // ── Tag sync ──
  notifyTagsChanged: () => ipcRenderer.send('notify-tags-changed'),
  onTagsChanged: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('tags-changed', handler);
    return () => ipcRenderer.removeListener('tags-changed', handler);
  },

  // ── Notes sync (dock/undock) ──
  onNotesChanged: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('notes-changed', handler);
    return () => ipcRenderer.removeListener('notes-changed', handler);
  },
});
