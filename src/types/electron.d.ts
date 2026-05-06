export interface PerWindowSettings {
  fontFamily: string;
  fontSize: number;
  backgroundColor: string;
  backgroundOpacity: number;
  textColor: string;
  edgeAutoHide?: boolean;
}

export interface AllSettings {
  themeMode: 'dark' | 'light';
  autoLaunch: boolean;
  globalFontFamily: string;
  globalFontSize: number;
  calendar: PerWindowSettings;
  notes: PerWindowSettings;
}

export interface ElectronAPI {
  isElectron: boolean;
  platform: string;

  getSettings: () => Promise<AllSettings>;
  setSetting: (scope: string, key: string, value: unknown) => void;
  onSettingsChanged: (callback: (settings: AllSettings) => void) => () => void;

  getSystemFonts: () => Promise<string[]>;

  closeWindow: () => void;
  hideNote: () => void;
  hideNoteById: (noteId: string) => void;

  onAction: (callback: (action: string) => void) => () => void;

  createNote: (options?: { noteType?: 'independent' | 'echo'; echoTagId?: string; title?: string; color?: string }) => void;
  deleteNote: (noteId: string) => void;
  showNote: (noteId: string) => void;
  getVisibleNoteIds: () => Promise<string[]>;
  openSettings: () => void;
  tidyNotes: () => void;
  setAutoLaunch: (enabled: boolean) => void;
  showDayContextMenu: (dateStr: string, screenX: number, screenY: number) => void;
  openEventEditor: (eventData: unknown) => void;
  onOpenEventEditor: (callback: (eventData: unknown) => void) => () => void;
  onDayContextAction: (callback: (payload: { dateStr: string; mode: 'single' | 'multi' }) => void) => () => void;

  // Data persistence
  saveAppData: (key: string, data: unknown) => Promise<boolean>;
  loadAppData: (key: string) => Promise<unknown | null>;
  deleteAppData: (key: string) => Promise<boolean>;
  listAppData: (prefix?: string) => Promise<string[]>;
  restoreNotes: (noteIds: string[], dockedIds?: string[]) => void;

  // Tags
  getTags: () => Promise<unknown[]>;
  saveTag: (tag: unknown) => Promise<boolean>;
  deleteTag: (tagId: string) => Promise<boolean>;

  // Event sync
  notifyEventsChanged: () => void;
  onEventsChanged: (callback: (data: { tagId?: string }) => void) => () => void;
  createEventFromEcho: (eventData: unknown) => Promise<unknown>;
  onEchoEventCreated: (callback: (event: unknown) => void) => () => void;
  getEventsByTag: (tagId: string) => Promise<unknown[]>;

  // Dock management
  dockNote: (noteId: string, noteSnapshot?: unknown) => void;
  undockNote: (noteId: string, noteSnapshot?: unknown) => void;
  undockNoteAt: (noteId: string, x: number, y: number, noteSnapshot?: unknown) => void;
  beginNoteWindowDrag: (noteId: string, noteSnapshot: unknown, screenX: number, screenY: number) => void;
  moveNoteWindowDrag: (screenX: number, screenY: number) => void;
  endNoteWindowDrag: (screenX: number, screenY: number, moved: boolean) => void;
  onNoteDockHover: (callback: (inside: boolean) => void) => () => void;
  beginDockDragPreview: (noteSnapshot: unknown, x: number, y: number) => void;
  moveDockDragPreview: (x: number, y: number, outside: boolean) => void;
  endDockDragPreview: () => void;

  // Edge auto-hide
  onToggleCollapse: (callback: (collapsed: boolean) => void) => () => void;

  // Tag sync
  notifyTagsChanged: () => void;
  onTagsChanged: (callback: () => void) => () => void;

  // Notes sync (dock/undock)
  onNotesChanged: (callback: () => void) => () => void;

  // Calendar window height sync
  notifyCalendarHeight: (height: number) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
