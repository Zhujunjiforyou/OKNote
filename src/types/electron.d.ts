export interface PerWindowSettings {
  fontFamily: string;
  fontSize: number;
  backgroundColor: string;
  backgroundOpacity: number;
  textColor: string;
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

  onAction: (callback: (action: string) => void) => () => void;

  createNote: () => void;
  deleteNote: (noteId: string) => void;
  showNote: (noteId: string) => void;
  getVisibleNoteIds: () => Promise<string[]>;
  openSettings: () => void;
  tidyNotes: () => void;
  setAutoLaunch: (enabled: boolean) => void;

  // Data persistence
  saveAppData: (key: string, data: unknown) => Promise<boolean>;
  loadAppData: (key: string) => Promise<unknown | null>;
  deleteAppData: (key: string) => Promise<boolean>;
  listAppData: (prefix?: string) => Promise<string[]>;
  restoreNotes: (noteIds: string[]) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
