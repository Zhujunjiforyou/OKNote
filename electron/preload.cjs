const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  ...(process.env.OKNOTE_E2E_TEST === '1'
    ? { finishIsolatedTest: () => ipcRenderer.invoke('__finish-isolated-test') }
    : {}),

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
  onSystemFontsChanged: (callback) => {
    const handler = (_event, fonts) => callback(fonts);
    ipcRenderer.on('system-fonts-changed', handler);
    return () => ipcRenderer.removeListener('system-fonts-changed', handler);
  },
  setReducedMotion: (reduced) => ipcRenderer.send('set-reduced-motion', reduced === true),

  // ── Window ──
  closeWindow: () => ipcRenderer.send('window-close'),
  setWindowDraftState: (entries) => ipcRenderer.send('set-window-draft-state', entries),
  confirmWindowDraftAction: (actionLabel, noteId) => ipcRenderer.invoke('confirm-window-draft-action', actionLabel, noteId),
  hideNote: (noteSnapshot) => ipcRenderer.invoke('hide-note', noteSnapshot),
  hideNoteById: (noteId) => ipcRenderer.invoke('hide-note-by-id', noteId),

  // ── Actions from main process ──
  onAction: (callback) => {
    const handler = (_event, action) => callback(action);
    ipcRenderer.on('action', handler);
    return () => ipcRenderer.removeListener('action', handler);
  },

  // ── Note management (for launcher) ──
  createNote: (options) => ipcRenderer.send('create-note', options),
  deleteNote: (noteId) => ipcRenderer.invoke('delete-note', noteId),
  listDeletedNotes: () => ipcRenderer.invoke('list-deleted-notes'),
  restoreDeletedNote: (trashId) => ipcRenderer.invoke('restore-deleted-note', trashId),
  permanentlyDeleteNote: (trashId) => ipcRenderer.invoke('permanently-delete-note', trashId),
  showNote: (noteId) => ipcRenderer.invoke('show-note', noteId),
  openSettings: () => ipcRenderer.send('open-settings'),
  tidyNotes: () => ipcRenderer.send('tidy-notes'),
  dismissReminderToast: () => ipcRenderer.send('dismiss-reminder-toast'),
  getReminderHistory: () => ipcRenderer.invoke('get-reminder-history'),
  markReminderHistoryRead: (id) => ipcRenderer.invoke('mark-reminder-history-read', id),
  onReminderHistoryChanged: (callback) => {
    const handler = (_event, history) => callback(history);
    ipcRenderer.on('reminder-history-changed', handler);
    return () => ipcRenderer.removeListener('reminder-history-changed', handler);
  },
  onPersistenceFailure: (callback) => {
    const handler = (_event, issue) => callback(issue);
    ipcRenderer.on('persistence-failed', handler);
    return () => ipcRenderer.removeListener('persistence-failed', handler);
  },
  setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled),
  setStartMinimized: (enabled) => ipcRenderer.invoke('set-start-minimized', enabled),
  openEventEditor: (eventData) => ipcRenderer.send('open-event-editor', eventData),
  onOpenEventEditor: (callback) => {
    const handler = (_event, eventData) => callback(eventData);
    ipcRenderer.on('open-event-editor', handler);
    return () => ipcRenderer.removeListener('open-event-editor', handler);
  },
  onFocusNote: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('focus-note', handler);
    return () => ipcRenderer.removeListener('focus-note', handler);
  },

  // ── Narrow persistence capabilities ──
  saveNote: (noteId, data) => ipcRenderer.invoke('save-app-data', `note_${noteId}`, data),
  loadNote: (noteId) => ipcRenderer.invoke('load-app-data', `note_${noteId}`),
  reportCrash: (data) => ipcRenderer.invoke('save-app-data', '__crash_log', data),
  getNotesState: () => ipcRenderer.invoke('get-notes-state'),
  getNoteSummaries: () => ipcRenderer.invoke('get-note-summaries'),
  restoreNotes: (noteIds, dockedIds) => ipcRenderer.send('restore-notes', noteIds, dockedIds),

  // Event data is owned by the main process and mutated by ID so concurrent
  // renderer windows cannot overwrite one another with stale arrays.
  getEventsState: () => ipcRenderer.invoke('get-events-state'),
  mutateEvent: (request) => ipcRenderer.invoke('mutate-event', request),

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
  dockNote: (noteId, noteSnapshot) => ipcRenderer.invoke('dock-note', noteId, noteSnapshot),
  undockNote: (noteId, noteSnapshot) => ipcRenderer.invoke('undock-note', noteId, noteSnapshot),
  undockNoteAt: (noteId, x, y, noteSnapshot) => ipcRenderer.invoke('undock-note-at', noteId, x, y, noteSnapshot),
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
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('notes-changed', handler);
    return () => ipcRenderer.removeListener('notes-changed', handler);
  },
});
