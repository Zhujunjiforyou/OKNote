export interface PerWindowSettings {
  fontFamily: string;
  fontSize: number;
  backgroundColor: string;
  backgroundOpacity: number;
  textColor: string;
  edgeAutoHide?: boolean;
  showDockArea?: boolean;
}

export interface AllSettings {
  themeMode: 'dark' | 'light';
  autoLaunch: boolean;
  startMinimized: boolean;
  hideNotificationContent: boolean;
  globalFontFamily: string;
  globalFontSize: number;
  calendar: PerWindowSettings;
  notes: PerWindowSettings;
}

export interface EventsState {
  events: unknown[];
  revision: number;
  loadError?: string;
}

export interface EventMutationResult extends EventsState {
  ok: boolean;
  code?: 'invalid' | 'conflict' | 'duplicate' | 'not_found' | 'load_failed' | 'save_failed' | 'internal';
  message?: string;
  event?: unknown;
  deletedId?: string;
}

export interface NoteDockResult {
  ok: boolean;
  canceled?: boolean;
  note?: unknown;
  message?: string;
}

export interface NoteSaveResult {
  ok: boolean;
  code?: 'invalid' | 'conflict' | 'save_failed';
  message?: string;
  note?: unknown;
}

export type WindowDraftKind = 'event-form' | 'quick-event' | 'note-title' | 'new-todo' | 'todo-edit' | 'date-edit' | 'tag-form';

export interface WindowDraftEntry {
  kind: WindowDraftKind;
  noteId?: string;
}

export interface NoteSummary {
  id: string;
  title: string;
  color: string;
  createdAt: string;
  isVisible: boolean;
  isDocked: boolean;
  isHidden: boolean;
  noteType: 'independent' | 'echo' | 'view' | 'daily';
}

export interface TagsState {
  tags: unknown[];
  loadError?: string;
  readOnlyDataAvailable?: boolean;
}

export interface TagMutationResult {
  ok: boolean;
  canceled?: boolean;
  loadError?: string;
  message?: string;
  tag?: unknown;
}

export type EventMutationRequest =
  | { type: 'create' | 'update'; event: unknown; expectedRevision?: number; expectedUpdatedAt?: string }
  | { type: 'delete'; id: string; expectedRevision?: number; expectedUpdatedAt?: string };

export interface ElectronAPI {
  isElectron: boolean;
  platform: string;

  getSettings: () => Promise<AllSettings>;
  setSetting: (scope: string, key: string, value: unknown) => void;
  onSettingsChanged: (callback: (settings: AllSettings) => void) => () => void;
  setReducedMotion: (reduced: boolean) => void;

  getSystemFonts: () => Promise<string[]>;
  onSystemFontsChanged: (callback: (fonts: string[]) => void) => () => void;

  closeWindow: () => void;
  setWindowDraftState: (entries: Array<WindowDraftKind | WindowDraftEntry>) => void;
  confirmWindowDraftAction: (actionLabel: string, noteId?: string) => Promise<boolean>;
  hideNote: (noteSnapshot: unknown) => Promise<{ ok: boolean; canceled?: boolean; note?: unknown; message?: string }>;
  hideNoteById: (noteId: string) => Promise<{ ok: boolean; canceled?: boolean; note?: unknown; message?: string }>;

  onAction: (callback: (action: string) => void) => () => void;

  createNote: (options?: { noteType?: 'independent' | 'echo' | 'daily'; echoTagId?: string; title?: string; color?: string; activeDate?: string }) => void;
  deleteNote: (noteId: string) => Promise<{ ok: boolean; canceled?: boolean; trashId?: string; message?: string }>;
  listDeletedNotes: () => Promise<Array<{ trashId: string; noteId: string; title: string; color: string; deletedAt: string }>>;
  restoreDeletedNote: (trashId: string) => Promise<{ ok: boolean; noteId?: string; message?: string }>;
  permanentlyDeleteNote: (trashId: string) => Promise<{ ok: boolean; trashId?: string; message?: string }>;
  showNote: (noteId: string) => Promise<{ ok: boolean; note?: unknown; message?: string }>;
  openSettings: () => void;
  tidyNotes: () => void;
  dismissReminderToast: () => void;
  getReminderHistory: () => Promise<Array<{ id: string; eventId: string; title: string; startDate: string; startTime?: string; isAllDay: boolean; firedAt: string; read: boolean; missed?: boolean; scheduledFor?: string }>>;
  markReminderHistoryRead: (id?: string) => Promise<boolean>;
  onReminderHistoryChanged: (callback: (history: Array<{ id: string; eventId: string; title: string; startDate: string; startTime?: string; isAllDay: boolean; firedAt: string; read: boolean; missed?: boolean; scheduledFor?: string }>) => void) => () => void;
  onPersistenceFailure: (callback: (issue: { title?: string; message?: string }) => void) => () => void;
  setAutoLaunch: (enabled: boolean) => Promise<{ ok: boolean; enabled: boolean; message?: string }>;
  setStartMinimized: (enabled: boolean) => Promise<{ ok: boolean; enabled: boolean; message?: string }>;
  openEventEditor: (eventData: unknown) => void;
  onOpenEventEditor: (callback: (eventData: unknown) => void) => () => void;
  onFocusNote: (callback: (payload: { noteId: string; noteType?: string; dateStr?: string }) => void) => () => void;

  // Narrow persistence capabilities
  saveNote: (noteId: string, data: unknown) => Promise<NoteSaveResult>;
  loadNote: (noteId: string) => Promise<unknown | null>;
  reportCrash: (data: unknown) => Promise<boolean>;
  getNotesState: () => Promise<unknown[]>;
  getNoteSummaries: () => Promise<NoteSummary[]>;
  restoreNotes: (noteIds: string[], dockedIds?: string[]) => void;
  getEventsState: () => Promise<EventsState>;
  mutateEvent: (request: EventMutationRequest) => Promise<EventMutationResult>;

  // Tags
  getTags: () => Promise<TagsState>;
  saveTag: (tag: unknown) => Promise<TagMutationResult>;
  deleteTag: (tagId: string) => Promise<TagMutationResult>;

  // Event sync
  notifyEventsChanged: () => void;
  onEventsChanged: (callback: (data: { action?: string; tagId?: string; eventId?: string; events?: unknown[]; revision?: number }) => void) => () => void;
  createEventFromEcho: (eventData: unknown) => Promise<unknown>;
  onEchoEventCreated: (callback: (event: unknown) => void) => () => void;
  getEventsByTag: (tagId: string) => Promise<unknown[]>;

  // Dock management
  dockNote: (noteId: string, noteSnapshot?: unknown) => Promise<NoteDockResult>;
  undockNote: (noteId: string, noteSnapshot?: unknown) => Promise<NoteDockResult>;
  undockNoteAt: (noteId: string, x: number, y: number, noteSnapshot?: unknown) => Promise<NoteDockResult>;
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
  onNotesChanged: (callback: (payload?: { note?: unknown; deletedId?: string }) => void) => () => void;

  // Calendar window height sync
  notifyCalendarHeight: (height: number) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
