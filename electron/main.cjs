const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
const DEV_PORT = parseInt(process.env.VITE_PORT || '5199', 10);
const BOUNDS_FILE = path.join(app.getPath('userData'), 'window-bounds.json');

// ── Window registry ──
const winRegistry = { calendar: null, notes: {}, settings: null };

// ── Settings ──
const DATA_DIR = path.join(app.getPath('userData'), 'data');
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
let windowBounds = {};

function loadWindowBounds() {
  try {
    if (fs.existsSync(BOUNDS_FILE)) {
      windowBounds = JSON.parse(fs.readFileSync(BOUNDS_FILE, 'utf-8'));
    }
  } catch(e) { console.error('loadWindowBounds failed:', e.message); windowBounds = {}; }
}
function saveWindowBounds() {
  const b = {};
  try {
    if (winRegistry.calendar && !winRegistry.calendar.isDestroyed()) {
      b.calendar = winRegistry.calendar.getBounds();
    }
  } catch(e) { console.error('saveWindowBounds calendar getBounds failed:', e.message); }
  for (const [id, w] of Object.entries(winRegistry.notes)) {
    try {
      if (!w.isDestroyed()) {
        b[id] = w.getBounds();
      }
    } catch(e) { console.error('saveWindowBounds note getBounds failed:', id, e.message); }
  }
  try { fs.writeFileSync(BOUNDS_FILE, JSON.stringify(b, null, 2)); } catch(e) { console.error('saveWindowBounds failed:', e.message); }
}

// ── Debounced bounds save ──
let boundsSaveTimer = null;
function debouncedSaveWindowBounds() {
  if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
  boundsSaveTimer = setTimeout(() => {
    saveWindowBounds();
    boundsSaveTimer = null;
  }, 300);
}

const perWindowDefaults = {
  fontFamily: 'Inter',
  fontSize: 14,
  backgroundColor: '#0d0d10',
  backgroundOpacity: 0.88,
  textColor: '#e2e8f0',
};
let appSettings = {
  themeMode: 'dark',
  autoLaunch: false,
  globalFontFamily: 'Microsoft YaHei',
  globalFontSize: 14,
  calendar: { ...perWindowDefaults },
  notes: { ...perWindowDefaults },
};

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      appSettings.themeMode = raw.themeMode || 'dark';
      appSettings.autoLaunch = typeof raw.autoLaunch === 'boolean' ? raw.autoLaunch : false;
      appSettings.globalFontFamily = raw.globalFontFamily || 'Microsoft YaHei';
      appSettings.globalFontSize = raw.globalFontSize || 14;
      appSettings.calendar = { ...perWindowDefaults, ...raw.calendar };
      appSettings.notes = { ...perWindowDefaults, ...raw.notes };
    }
  } catch (e) { console.error('loadSettings failed:', e.message); }
}
function saveSettings() {
  try { fs.writeFileSync(settingsPath, JSON.stringify(appSettings, null, 2)); } catch (e) { console.error('saveSettings failed:', e.message); }
}

// ── Data persistence (events, notes, countdowns) ──
function ensureDataDir() {
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { console.error('ensureDataDir failed:', e.message); }
}
function saveAppData(fileName, data) {
  ensureDataDir();
  const filePath = path.join(DATA_DIR, fileName);
  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch (e) {
    console.error('saveAppData failed:', fileName, e.message);
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    return false;
  }
}
function loadAppData(fileName) {
  const filePath = path.join(DATA_DIR, fileName);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (e) {
    console.error('loadAppData failed:', fileName, e.message);
  }
  return null;
}

// Validation helper: only allow safe alphanumeric/underscore/hyphen keys
function isValidDataKey(key) {
  return typeof key === 'string' && /^[a-zA-Z0-9_-]+$/.test(key);
}

// ── System fonts (async, non-blocking) ──
let cachedFonts = null;
const builtinFonts = [
  'Microsoft YaHei', 'SimSun', 'SimHei', 'KaiTi', 'FangSong',
  'DengXian', 'YouYuan', 'NSimSun', 'Microsoft JhengHei',
  'Arial', 'Times New Roman', 'Courier New', 'Consolas', 'Segoe UI',
  'Verdana', 'Georgia', 'Tahoma', 'Trebuchet MS', 'Impact', 'Comic Sans MS',
  'Palatino Linotype', 'Lucida Console', 'Cambria', 'Calibri',
];

function loadSystemFontsAsync() {
  const names = new Set(builtinFonts);

  // Read font directories
  const fontDirs = [
    'C:\\Windows\\Fonts',
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Fonts'),
  ];
  fontDirs.forEach((fontDir) => {
    try {
      if (fs.existsSync(fontDir)) {
        const files = fs.readdirSync(fontDir);
        files.forEach((f) => {
          const l = f.toLowerCase();
          if (l.endsWith('.ttf') || l.endsWith('.otf') || l.endsWith('.ttc')) {
            let name = f.replace(/\.(ttf|otf|ttc)$/i, '');
            name = name.replace(/[_-]\s*(Regular|Bold|Italic|BoldItalic|Light|Medium|Thin|Heavy|Black|ExtraBold|SemiBold|ExtraLight|SemiLight|Oblique|Normal|Condensed|Expanded|Narrow)$/i, '');
            name = name.replace(/[_-]\s*(reg|bd|it|bi|lt|md|th|hv|blk|n)$/i, '');
            if (name.trim() && name.trim().length < 50) names.add(name.trim());
          }
        });
      }
    } catch (e) { /* ignore */ }
  });

  // PowerShell query (async, non-blocking)
  const psScript = `[Console]::OutputEncoding = [Text.Encoding]::UTF8; @('HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts','HKCU:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts') | ForEach-Object { $key = Get-ItemProperty -Path $_ -ErrorAction SilentlyContinue; if ($key) { $key.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' -and $_.Name.Length -gt 1 -and $_.Name.Length -lt 80 } | ForEach-Object { (($_.Name -replace '\\s*\\((TrueType|OpenType)\\)', '') -replace '\\s+$', '').Trim() } } }`;
  exec(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ').trim()}"`,
    { encoding: 'utf-8', timeout: 15000 },
    (err, stdout) => {
      if (!err && stdout) {
        stdout.split(/[\r\n]+/).forEach((line) => {
          const name = line.trim();
          if (name) names.add(name);
        });
      }
      cachedFonts = [...names].sort();
    }
  );
}

function getSystemFonts() {
  return cachedFonts || [...builtinFonts].sort();
}

// ── Tray icon (16×16 pixel-art memo icon) ──
// Draws a rounded rectangle with three horizontal lines representing a sticky note
function createTrayIcon() {
  const s = 16; const buf = Buffer.alloc(s*s*4);
  for (let y=0; y<s; y++) for (let x=0; x<s; x++) {
    const i = (y*s+x)*4;
    const inR = x>=2 && x<s-2 && y>=1 && y<s-1;
    const onB = (x===2||x===s-3)&&y>=1&&y<s-1 || (y===1||y===s-2)&&x>=2&&x<s-3;
    const l1=y===5&&x>=5&&x<12, l2=y===8&&x>=5&&x<11, l3=y===11&&x>=5&&x<9;
    if(l1||l2||l3){buf[i]=0xfb;buf[i+1]=0xbf;buf[i+2]=0x24;buf[i+3]=255}
    else if(onB){buf[i]=0x3b;buf[i+1]=0x82;buf[i+2]=0xf6;buf[i+3]=255}
    else if(inR){buf[i]=0x1e;buf[i+1]=0x29;buf[i+2]=0x3e;buf[i+3]=200}
  }
  return nativeImage.createFromBuffer(buf,{width:s,height:s});
}
let tray=null;
function createTray(){
  tray=new Tray(createTrayIcon());
  tray.setToolTip('OKNote');
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'新建便签',click:()=>createNoteWindow(null,true)},
    {label:'新建事件',click:()=>{showCalendar();if(winRegistry.calendar)winRegistry.calendar.webContents.send('action','new-event')}},
    {type:'separator'},
    {label:'显示/隐藏日历',click:()=>toggleCalendar()},
    {label:'整理全部便签',click:()=>tidyAllNotes()},
    {type:'separator'},
    {label:'偏好设置',click:()=>createSettingsWindow()},
    {type:'separator'},
    {label:'退出',click:()=>{app.isQuitting=true;app.quit()}},
  ]));
  tray.on('double-click',()=>toggleCalendar());
}

// ── Widget factory ──
function makeWidgetURL(hash){return isDev?`http://localhost:${DEV_PORT}/#${hash}`:`file://${path.join(__dirname,'..','dist','index.html')}#${hash}`}
function createWidget(opts={}){
  return new BrowserWindow({
    width:opts.width||400,height:opts.height||500,x:opts.x,y:opts.y,
    frame:false,transparent:true,skipTaskbar:true,
    resizable:true,hasShadow:false,backgroundColor:'#00000000',
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false},
  });
}

// ── Calendar ──
function showCalendar(){const w=winRegistry.calendar;if(w&&!w.isDestroyed()){w.show();w.focus()}}
function toggleCalendar(){const w=winRegistry.calendar;if(w&&!w.isDestroyed()){w.isVisible()?w.hide():showCalendar()}}
function createCalendarWindow(){
  if(winRegistry.calendar&&!winRegistry.calendar.isDestroyed())return showCalendar(),winRegistry.calendar;
  const{width:sw}=screen.getPrimaryDisplay().workAreaSize;
  const defX=Math.min(40,sw-460),defY=40;
  const saved=windowBounds.calendar;
  winRegistry.calendar=createWidget({width:saved?.width||420,height:saved?.height||500,x:saved?.x!=null?saved.x:defX,y:saved?.y!=null?saved.y:defY});
  winRegistry.calendar.loadURL(makeWidgetURL('/calendar'));
  if(isDev)winRegistry.calendar.webContents.openDevTools({mode:'detach'});
  winRegistry.calendar.on('move', debouncedSaveWindowBounds);
  winRegistry.calendar.on('resize', debouncedSaveWindowBounds);
  winRegistry.calendar.on('closed',()=>{winRegistry.calendar=null});
  return winRegistry.calendar;
}

// ── Notes ──
let noteIdSeq=Date.now();
function generateNoteId(){return`note_${++noteIdSeq}`}
function createNoteWindow(noteId,isNew){
  noteId=noteId||generateNoteId();
  if(winRegistry.notes[noteId]&&!winRegistry.notes[noteId].isDestroyed()){winRegistry.notes[noteId].show();winRegistry.notes[noteId].focus();return winRegistry.notes[noteId]}
  const{width:sw}=screen.getPrimaryDisplay().workAreaSize;
  const saved=windowBounds[noteId];
  const defX=Math.min(420+60,sw-290),defY=40+Object.keys(winRegistry.notes).length*20;
  const opts={width:270,height:340,x:defX,y:defY};
  if(saved&&saved.x!=null){opts.x=saved.x;opts.y=saved.y;opts.width=saved.width;opts.height=saved.height}
  const w=createWidget(opts);
  const hash = isNew ? `/note/${noteId}/new` : `/note/${noteId}`;
  w.loadURL(makeWidgetURL(hash));
  w.on('move', debouncedSaveWindowBounds);
  w.on('resize', debouncedSaveWindowBounds);
  w.on('closed',()=>{
    clearTimeout(boundsSaveTimer);
    delete winRegistry.notes[noteId];
  });
  winRegistry.notes[noteId]=w;return w;
}

// ── Settings ──
function createSettingsWindow(){
  if(winRegistry.settings&&!winRegistry.settings.isDestroyed()){winRegistry.settings.show();winRegistry.settings.focus();return winRegistry.settings}
  winRegistry.settings=createWidget({width:440,height:620,x:undefined,y:undefined});
  winRegistry.settings.loadURL(makeWidgetURL('/settings'));
  winRegistry.settings.on('closed',()=>{winRegistry.settings=null});
  return winRegistry.settings;
}

// ── Tidy ──
function tidyAllNotes(){
  const ids=Object.keys(winRegistry.notes);
  if(ids.length===0)return;
  const W=270,H=340,gap=12;
  let calX=40,calY=40,calW=420,calH=500;
  const cal=winRegistry.calendar;
  if(cal&&!cal.isDestroyed()){const b=cal.getBounds();calX=b.x;calY=b.y;calW=b.width;calH=b.height;}
  const startX=calX,startY=calY+calH+gap;
  const{width:sw}=screen.getPrimaryDisplay().workAreaSize;
  const availW=sw-startX-12;
  const cols=Math.max(1,Math.min(ids.length,Math.floor((availW+gap)/(W+gap))));
  ids.forEach((id,i)=>{
    const w=winRegistry.notes[id];
    if(w&&!w.isDestroyed())w.setBounds({
      x:startX+(i%cols)*(W+gap),y:startY+Math.floor(i/cols)*(H+gap),width:W,height:H
    });
  });
  saveWindowBounds();
}

// ── Broadcast ──
function broadcastSettings(){
  const all=[winRegistry.calendar,winRegistry.settings,...Object.values(winRegistry.notes)].filter(Boolean);
  all.forEach(w=>{if(!w.isDestroyed())w.webContents.send('settings-changed',{
    themeMode: appSettings.themeMode,
    globalFontFamily: appSettings.globalFontFamily,
    globalFontSize: appSettings.globalFontSize,
    calendar: {...appSettings.calendar},
    notes: {...appSettings.notes},
  })});
}

// ── IPC ──
function setupIPC(){
  ipcMain.handle('get-settings',()=>({
    themeMode: appSettings.themeMode,
    autoLaunch: appSettings.autoLaunch,
    globalFontFamily: appSettings.globalFontFamily,
    globalFontSize: appSettings.globalFontSize,
    calendar: {...appSettings.calendar},
    notes: {...appSettings.notes},
  }));
  ipcMain.handle('get-system-fonts',()=>getSystemFonts());
  ipcMain.on('set-auto-launch',(_e,enabled)=>{
    appSettings.autoLaunch=!!enabled;
    app.setLoginItemSettings({ openAtLogin: appSettings.autoLaunch });
    saveSettings();
  });
  ipcMain.on('set-setting',(_e,scope,key,value)=>{
    if(scope==='theme'){
      appSettings.themeMode=value;
    }else if(scope==='global'){
      if(key in appSettings) appSettings[key]=value;
    }else if(appSettings[scope] && typeof appSettings[scope]==='object' && key in appSettings[scope]){
      appSettings[scope][key]=value;
    }else{
      return;
    }
    saveSettings();
    broadcastSettings();
  });
  ipcMain.on('window-close',event=>{BrowserWindow.fromWebContents(event.sender)?.close()});
  ipcMain.on('hide-note',(event)=>{
    const win = BrowserWindow.fromWebContents(event.sender);
    if(win && !win.isDestroyed()){ saveWindowBounds(); win.hide(); }
  });
  ipcMain.on('create-note',()=>{createNoteWindow(null,true)});
  ipcMain.on('delete-note',(_e,noteId)=>{const w=winRegistry.notes[noteId];if(w&&!w.isDestroyed()){const fp=path.join(DATA_DIR,`note_${noteId}.json`);try{if(fs.existsSync(fp))fs.unlinkSync(fp)}catch(e){console.error('deleteNoteFile failed:',e.message)}w.close()}});
  ipcMain.on('open-settings',()=>{createSettingsWindow()});
  ipcMain.on('tidy-notes',()=>{tidyAllNotes()});

  // ── Note visibility management ──
  ipcMain.on('show-note',(_e,noteId)=>{
    if(typeof noteId==='string') createNoteWindow(noteId);
  });
  ipcMain.handle('get-visible-note-ids',()=>Object.keys(winRegistry.notes));

  // ── Data persistence IPC ──
  ipcMain.handle('save-app-data',(_e,key,data)=>{
    if(!isValidDataKey(key)) return false;
    return saveAppData(`${key}.json`,data);
  });
  ipcMain.handle('load-app-data',(_e,key)=>{
    if(!isValidDataKey(key)) return null;
    return loadAppData(`${key}.json`);
  });
  ipcMain.handle('delete-app-data',(_e,key)=>{
    if(!isValidDataKey(key)) return false;
    const fp = path.join(DATA_DIR, `${key}.json`);
    try { if(fs.existsSync(fp)){fs.unlinkSync(fp);return true} } catch(e){console.error('deleteAppData failed:',e.message)}
    return false;
  });
  ipcMain.handle('list-app-data',(_e,prefix)=>{
    ensureDataDir();
    try {
      const files = fs.readdirSync(DATA_DIR);
      if(prefix) return files.filter(f => f.startsWith(prefix) && f.endsWith('.json'));
      return files.filter(f => f.endsWith('.json'));
    } catch(e) { console.error('listAppData failed:',e.message); return []; }
  });

  // ── Restore note windows on restart ──
  ipcMain.on('restore-notes',(_e,noteIds)=>{
    if(Array.isArray(noteIds)){
      noteIds.forEach(id=>createNoteWindow(id));
      const hasSavedBounds = noteIds.some(id => windowBounds[id]);
      if(!hasSavedBounds) tidyAllNotes();
    }
  });
}

// ── App ──
app.whenReady().then(()=>{
  Menu.setApplicationMenu(null);
  ensureDataDir();
  loadSettings();loadWindowBounds();setupIPC();createTray();
  createCalendarWindow();
  app.setLoginItemSettings({ openAtLogin: appSettings.autoLaunch });
  // Start async font loading in background (non-blocking)
  loadSystemFontsAsync();
});
app.on('window-all-closed',()=>{});
app.on('before-quit',()=>{app.isQuitting=true;clearTimeout(boundsSaveTimer);saveWindowBounds()});
app.on('activate',()=>{createCalendarWindow()});
