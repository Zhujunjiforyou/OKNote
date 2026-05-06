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
      if (isCalendarCollapsed && calendarOriginalBounds) {
        b.calendar = { x: calendarOriginalBounds.x, y: calendarOriginalBounds.y, width: calendarOriginalBounds.width, height: calendarOriginalBounds.height };
      } else {
        b.calendar = winRegistry.calendar.getBounds();
      }
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
  calendar: { ...perWindowDefaults, edgeAutoHide: true },
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
      appSettings.calendar = { ...perWindowDefaults, edgeAutoHide: true, ...raw.calendar };
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

function loadNoteData(noteId) {
  if (typeof noteId !== 'string' || !noteId.trim()) return null;
  const note = loadAppData(`note_${noteId}.json`);
  return note && typeof note === 'object' ? note : null;
}

function saveNoteData(noteId, patchOrNote) {
  if (typeof noteId !== 'string' || !noteId.trim()) return false;
  const existing = loadNoteData(noteId) || { id: noteId, items: [] };
  const snapshot = patchOrNote && typeof patchOrNote === 'object' ? patchOrNote : {};
  const next = {
    ...existing,
    ...snapshot,
    id: noteId,
    updatedAt: new Date().toISOString(),
  };
  return saveAppData(`note_${noteId}.json`, next);
}

function notifyNotesChanged() {
  if (winRegistry.calendar && !winRegistry.calendar.isDestroyed()) {
    winRegistry.calendar.webContents.send('notes-changed');
  }
}

const NOTE_COLORS = ['#FF8C42', '#22D3EE', '#FB7185', '#A78BFA', '#FBBF24', '#34D399', '#F472B6', '#60A5FA', '#F59E0B', '#818CF8', '#FB923C', '#38BDF8', '#A3E635', '#E879F9', '#FDA4AF', '#67E8F9'];
function safeHexColor(value, fallback = '#6366f1') {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}
function createInitialNote(noteId, options = {}) {
  const ts = new Date().toISOString();
  const noteType = options && options.noteType === 'echo' ? 'echo' : 'independent';
  const color = safeHexColor(options && options.color, NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)]);
  const title = typeof options.title === 'string' && options.title.trim()
    ? options.title.trim()
    : noteType === 'echo'
      ? '视图便签'
      : '新便签';
  return {
    id: noteId,
    title,
    color,
    transparency: typeof appSettings.notes.backgroundOpacity === 'number' ? appSettings.notes.backgroundOpacity : 0.88,
    items: [],
    fontFamily: appSettings.notes.fontFamily || 'Microsoft YaHei',
    fontSize: appSettings.notes.fontSize || 14,
    noteType,
    ...(noteType === 'echo' && typeof options.echoTagId === 'string' ? { echoTagId: options.echoTagId } : {}),
    ...(noteType === 'echo' && typeof options.echoTagId === 'string' ? { viewTagIds: [options.echoTagId] } : {}),
    isDocked: false,
    isPinned: false,
    isArchived: false,
    createdAt: ts,
    updatedAt: ts,
  };
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
    width:opts.width||400,height:opts.height||680,x:opts.x,y:opts.y,
    frame:false,transparent:true,skipTaskbar:true,
    resizable:true,hasShadow:false,backgroundColor:'#00000000',
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false},
  });
}

// ── Calendar ──
function showCalendar(){const w=winRegistry.calendar;if(w&&!w.isDestroyed()){w.show();w.focus()}else{createCalendarWindow()}}
function toggleCalendar(){const w=winRegistry.calendar;if(w&&!w.isDestroyed()){w.isVisible()?w.hide():(w.show(),w.focus())}else{createCalendarWindow()}}
function openEventEditorInCalendar(eventData){
  if(!eventData||typeof eventData!=='object'||typeof eventData.id!=='string') return;
  showCalendar();
  const cal=winRegistry.calendar;
  if(!cal||cal.isDestroyed()) return;
  const send=()=>{if(!cal.isDestroyed()) cal.webContents.send('open-event-editor',eventData)};
  if(isCalendarCollapsed){
    expandCalendar(cal,false);
    setTimeout(send,190);
    return;
  }
  if(cal.webContents.isLoading()){
    cal.webContents.once('did-finish-load',()=>setTimeout(send,120));
  }else{
    setTimeout(send,40);
  }
}
function createCalendarWindow(){
  if(winRegistry.calendar&&!winRegistry.calendar.isDestroyed())return showCalendar(),winRegistry.calendar;
  const{width:sw}=screen.getPrimaryDisplay().workAreaSize;
  const defX=Math.min(40,sw-460),defY=40;
  const saved=windowBounds.calendar;
  winRegistry.calendar=createWidget({width:saved?.width||420,height:saved?.height||500,x:saved?.x!=null?saved.x:defX,y:saved?.y!=null?saved.y:defY});
  winRegistry.calendar.webContents.on('did-finish-load',()=>{
    const cal=winRegistry.calendar;
    if(!cal||cal.isDestroyed()) return;
    cal.webContents.send('toggle-collapse',isCalendarCollapsed);
    setTimeout(()=>checkEdgeAutoHide(),40);
  });
  winRegistry.calendar.loadURL(makeWidgetURL('/calendar'));
  if(isDev)winRegistry.calendar.webContents.openDevTools({mode:'detach'});
  winRegistry.calendar.on('move', ()=>{
    if(edgeBoundsAnimating) return;
    debouncedSaveWindowBounds();
    checkEdgeAutoHide();
  });
  winRegistry.calendar.on('resize', ()=>{
    if(edgeBoundsAnimating) return;
    debouncedSaveWindowBounds();
    checkEdgeAutoHide();
  });
  if(appSettings.calendar.edgeAutoHide) ensureEdgePolling();
  winRegistry.calendar.on('closed',()=>{winRegistry.calendar=null;clearEdgeTimers();stopEdgePolling();isCalendarCollapsed=false;calendarOriginalBounds=null;pointerOutsideSince=0});
  return winRegistry.calendar;
}

// ── Edge auto-hide (calendar) ──
const EDGE_COLLAPSED_HEIGHT=36;
const EDGE_POLL_INTERVAL=45;
const EDGE_EXIT_GRACE_MS=55;
const EDGE_HOVER_PADDING=10;
let edgeHoverPollTimer=null;
let isCalendarCollapsed=false;
let calendarOriginalBounds=null;
let _edgeResizing=false;
let pointerOutsideSince=0;
let edgeBoundsAnimTimer=null;
let edgeBoundsAnimating=false;

function clearEdgeTimers() {
  pointerOutsideSince=0;
  if(edgeBoundsAnimTimer) clearInterval(edgeBoundsAnimTimer);
  edgeBoundsAnimTimer=null;
  edgeBoundsAnimating=false;
}

function stopEdgePolling(){
  if(edgeHoverPollTimer) clearInterval(edgeHoverPollTimer);
  edgeHoverPollTimer=null;
}

function ensureEdgePolling(){
  if(edgeHoverPollTimer) return;
  edgeHoverPollTimer=setInterval(()=>checkEdgeAutoHide(),EDGE_POLL_INTERVAL);
}

function getCalendarEdgeInfo(bounds) {
  const disp=screen.getDisplayNearestPoint({x:bounds.x+Math.floor(bounds.width/2),y:bounds.y+Math.floor(bounds.height/2)});
  const wa=disp.workArea;
  const threshold=20;
  const nearLeft=bounds.x<=wa.x+threshold;
  const nearRight=bounds.x+bounds.width>=wa.x+wa.width-threshold;
  const nearTop=bounds.y<=wa.y+threshold;
  return { nearEdge: nearLeft||nearRight||nearTop, nearLeft, nearRight, nearTop };
}

function pointInBounds(point,bounds,padding=0){
  return point.x>=bounds.x-padding&&
    point.x<=bounds.x+bounds.width+padding&&
    point.y>=bounds.y-padding&&
    point.y<=bounds.y+bounds.height+padding;
}

function rememberCalendarExpandedBounds(bounds){
  if(!bounds||bounds.height<=EDGE_COLLAPSED_HEIGHT+8) return;
  calendarOriginalBounds={x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height};
}

function setCalendarBounds(cal,bounds){
  _edgeResizing=true;
  try{
    cal.setBounds(bounds,false);
  }finally{
    _edgeResizing=false;
  }
}

function animateCalendarBounds(cal,target,duration=150,onDone){
  if(!cal||cal.isDestroyed()) return;
  if(edgeBoundsAnimTimer) clearInterval(edgeBoundsAnimTimer);
  const start=cal.getBounds();
  const started=Date.now();
  const ease=(t)=>1-Math.pow(1-t,3);
  edgeBoundsAnimating=true;
  edgeBoundsAnimTimer=setInterval(()=>{
    if(!cal||cal.isDestroyed()){
      clearEdgeTimers();
      return;
    }
    const t=Math.min(1,(Date.now()-started)/duration);
    const k=ease(t);
    const next={
      x:Math.round(start.x+(target.x-start.x)*k),
      y:Math.round(start.y+(target.y-start.y)*k),
      width:Math.round(start.width+(target.width-start.width)*k),
      height:Math.round(start.height+(target.height-start.height)*k),
    };
    setCalendarBounds(cal,next);
    if(t>=1){
      clearInterval(edgeBoundsAnimTimer);
      edgeBoundsAnimTimer=null;
      edgeBoundsAnimating=false;
      setCalendarBounds(cal,target);
      saveWindowBounds();
      if(typeof onDone==='function') onDone();
    }
  },24);
}

function collapseCalendar(cal){
  if(!cal||cal.isDestroyed()||isCalendarCollapsed) return;
  const cursor=screen.getCursorScreenPoint();
  const b=cal.getBounds();
  if(pointInBounds(cursor,b,EDGE_HOVER_PADDING)) return;
  rememberCalendarExpandedBounds(b);
  isCalendarCollapsed=true;
  pointerOutsideSince=0;
  cal.webContents.send('toggle-collapse',true);
  animateCalendarBounds(cal,{x:b.x,y:b.y,width:b.width,height:EDGE_COLLAPSED_HEIGHT},135,()=>{
    if(cal&&!cal.isDestroyed()&&isCalendarCollapsed) cal.webContents.send('toggle-collapse',true);
  });
}

function expandCalendar(cal,hoverExpanded=false){
  if(!cal||cal.isDestroyed()) return;
  clearEdgeTimers();
  const b=cal.getBounds();
  const target=calendarOriginalBounds
    ? {x:b.x,y:b.y,width:calendarOriginalBounds.width,height:calendarOriginalBounds.height}
    : {x:b.x,y:b.y,width:b.width,height:680};
  isCalendarCollapsed=false;
  animateCalendarBounds(cal,target,145,()=>{
    if(cal&&!cal.isDestroyed()&&!isCalendarCollapsed) cal.webContents.send('toggle-collapse',false);
  });
  if(!hoverExpanded&&!getCalendarEdgeInfo(target).nearEdge) calendarOriginalBounds=null;
}

function checkEdgeAutoHide(){
  if(_edgeResizing) return; // prevent recursive calls from setBounds→resize
  const cal=winRegistry.calendar;
  if(!cal||cal.isDestroyed()||!cal.isVisible()) return;

  if(!appSettings.calendar.edgeAutoHide){
    clearEdgeTimers();
    if(isCalendarCollapsed) expandCalendar(cal,false);
    return;
  }

  const bounds=cal.getBounds();
  const { nearEdge } = getCalendarEdgeInfo(bounds);
  const cursor=screen.getCursorScreenPoint();

  if(isCalendarCollapsed){
    if(!nearEdge){
      expandCalendar(cal,false);
      return;
    }
    if(pointInBounds(cursor,bounds,EDGE_HOVER_PADDING)){
      expandCalendar(cal,true);
      return;
    }
    return;
  }

  const pointerInside=pointInBounds(cursor,bounds,EDGE_HOVER_PADDING);
  if(pointerInside){
    pointerOutsideSince=0;
    if(nearEdge) rememberCalendarExpandedBounds(bounds);
    return;
  }

  if(!nearEdge){
    clearEdgeTimers();
    calendarOriginalBounds=null;
    return;
  }

  const now=Date.now();
  if(!pointerOutsideSince){
    pointerOutsideSince=now;
    return;
  }
  if(now-pointerOutsideSince>=EDGE_EXIT_GRACE_MS) collapseCalendar(cal);
}

// ── Notes ──
let noteIdSeq=Date.now();
let externalNoteDrag=null;
let dockDragPreviewWin=null;
let dockDragPreviewOutside=false;
function generateNoteId(){return`note_${++noteIdSeq}`}

function getDockZone(bounds) {
  return {
    top: bounds.y + Math.max(120, Math.round(bounds.height * 0.46)),
    left: bounds.x + Math.min(340, Math.max(260, Math.round(bounds.width * 0.18))),
    right: bounds.x + bounds.width,
    bottom: bounds.y + bounds.height,
  };
}
function isPointInDockZone(x, y) {
  const cal = winRegistry.calendar;
  if (!cal || cal.isDestroyed() || !cal.isVisible() || isCalendarCollapsed) return false;
  const zone = getDockZone(cal.getBounds());
  return x >= zone.left && x <= zone.right && y >= zone.top && y <= zone.bottom;
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function createDockPreviewHtml(note) {
  const color = safeHexColor(note && note.color, '#6366f1');
  const title = escapeHtml(note && note.title ? note.title : '便签');
  const tag = note && note.noteType === 'echo' ? '视图' : '独立';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden;font-family:"Microsoft YaHei",system-ui,sans-serif;color:#1a1a2e;}
    .card{box-sizing:border-box;width:220px;height:168px;border-radius:8px;border:1px solid rgba(255,255,255,.28);background:${color}dd;box-shadow:0 18px 48px rgba(0,0,0,.34);overflow:hidden;transform:rotate(1.5deg) scale(.98);}
    body.outside .card{border-color:rgba(239,68,68,.58);box-shadow:0 18px 48px rgba(239,68,68,.32);}
    .head{display:flex;align-items:center;gap:8px;padding:10px 12px 5px;font-size:13px;font-weight:600;}
    .dot{width:10px;height:10px;border-radius:999px;background:${color};box-shadow:0 0 0 2px rgba(255,255,255,.18);}
    .title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}
    .pill{font-size:11px;opacity:.45;background:rgba(255,255,255,.12);border-radius:999px;padding:2px 7px;}
    .hint{padding:0 12px;font-size:11px;opacity:.48;}
  </style></head><body><div class="card"><div class="head"><span class="dot"></span><span class="title">${title}</span><span class="pill">${tag}</span></div><div class="hint">拖拽中，松开后完成操作</div></div></body></html>`;
}
function destroyDockDragPreview() {
  if (dockDragPreviewWin && !dockDragPreviewWin.isDestroyed()) dockDragPreviewWin.close();
  dockDragPreviewWin = null;
  dockDragPreviewOutside = false;
}
function beginDockDragPreview(note, x, y) {
  destroyDockDragPreview();
  dockDragPreviewWin = new BrowserWindow({
    width: 220, height: 168, x: Math.round(x - 110), y: Math.round(y - 24),
    frame: false, transparent: true, skipTaskbar: true, resizable: false,
    focusable: false, hasShadow: false, backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  dockDragPreviewWin.setIgnoreMouseEvents(true);
  dockDragPreviewWin.setAlwaysOnTop(true, 'screen-saver');
  dockDragPreviewWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createDockPreviewHtml(note || {}))}`);
  dockDragPreviewWin.on('closed', () => { dockDragPreviewWin = null; dockDragPreviewOutside = false; });
}
function moveDockDragPreview(x, y, outside) {
  if (!dockDragPreviewWin || dockDragPreviewWin.isDestroyed()) return;
  dockDragPreviewWin.setBounds({ x: Math.round(x - 110), y: Math.round(y - 24), width: 220, height: 168 });
  if (dockDragPreviewOutside !== !!outside) {
    dockDragPreviewOutside = !!outside;
    dockDragPreviewWin.webContents.executeJavaScript(`document.body.classList.toggle('outside', ${dockDragPreviewOutside ? 'true' : 'false'})`).catch(() => {});
  }
}

function createNoteWindow(noteId,isNew,placement,initialOptions){
  if(noteId!=null&&typeof noteId!=='string') return null;
  noteId=noteId||generateNoteId();
  if(isNew && !loadNoteData(noteId)) saveNoteData(noteId, createInitialNote(noteId, initialOptions || {}));
  if(winRegistry.notes[noteId]&&!winRegistry.notes[noteId].isDestroyed()){winRegistry.notes[noteId].show();winRegistry.notes[noteId].focus();return winRegistry.notes[noteId]}
  const{width:sw}=screen.getPrimaryDisplay().workAreaSize;
  const saved=windowBounds[noteId];
  const defX=Math.min(420+60,sw-290),defY=40+Object.keys(winRegistry.notes).length*20;
  const opts={width:270,height:340,x:defX,y:defY};
  if(saved&&saved.x!=null){opts.x=saved.x;opts.y=saved.y;opts.width=saved.width;opts.height=saved.height}
  if(placement&&typeof placement==='object'){
    if(Number.isFinite(placement.x)) opts.x=Math.round(placement.x);
    if(Number.isFinite(placement.y)) opts.y=Math.round(placement.y);
    if(Number.isFinite(placement.width)) opts.width=Math.round(placement.width);
    if(Number.isFinite(placement.height)) opts.height=Math.round(placement.height);
  }
  const w=createWidget(opts);
  const hash = isNew ? `/note/${noteId}/new` : `/note/${noteId}`;
  w.loadURL(makeWidgetURL(hash));
  w.on('move', debouncedSaveWindowBounds);
  w.on('resize', debouncedSaveWindowBounds);
  w.on('closed',()=>{
    delete winRegistry.notes[noteId];
  });
  winRegistry.notes[noteId]=w;return w;
}

// ── Settings ──
function createSettingsWindow(){
  if(winRegistry.settings&&!winRegistry.settings.isDestroyed()){
    winRegistry.settings.setAlwaysOnTop(true,'pop-up-menu');
    winRegistry.settings.show();
    winRegistry.settings.moveTop();
    winRegistry.settings.focus();
    return winRegistry.settings
  }
  winRegistry.settings=createWidget({width:440,height:620,x:undefined,y:undefined});
  winRegistry.settings.setAlwaysOnTop(true,'pop-up-menu');
  winRegistry.settings.loadURL(makeWidgetURL('/settings'));
  winRegistry.settings.on('closed',()=>{winRegistry.settings=null});
  return winRegistry.settings;
}

// ── Tidy ──
function getTidyNoteEntries(){
  return Object.entries(winRegistry.notes).filter(([id,w])=>{
    if(!w||w.isDestroyed()||!w.isVisible()) return false;
    const note=loadNoteData(id);
    if(note&&note.isHidden===true) return false;
    if(note&&note.isDocked===true) return false;
    return true;
  });
}

function tidyAllNotes(){
  const entries=getTidyNoteEntries();
  if(entries.length===0)return;
  const H=340,gap=12;
  const margin=12;
  const minScale=0.72;
  const cal=winRegistry.calendar;
  const calBounds=cal&&!cal.isDestroyed()&&cal.isVisible()?cal.getBounds():null;
  const display=calBounds?screen.getDisplayMatching(calBounds):screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const wa=display.workArea;
  const baseX=calBounds?calBounds.x:wa.x+margin;
  const noteWidths=entries.map(([,w])=>{
    try{return Math.max(180,w.getBounds().width||270)}catch{return 270}
  });
  const maxNoteW=Math.max(...noteWidths);
  const startX=Math.round(Math.max(wa.x+margin,Math.min(baseX,wa.x+wa.width-maxNoteW-margin)));
  const desiredY=calBounds?calBounds.y+calBounds.height+gap:wa.y+margin;
  const startY=Math.round(Math.max(wa.y+margin,Math.min(desiredY,wa.y+wa.height-H-margin)));
  const availW=Math.max(maxNoteW,wa.x+wa.width-margin-startX);
  const availH=Math.max(H,wa.y+wa.height-margin-startY);
  let compactScale=minScale;
  const buildRows=(heightScale=1)=>{
    const rows=[];
    let current=[];
    let usedW=0;
    entries.forEach((entry,index)=>{
      const width=noteWidths[index];
      const nextW=current.length===0?width:usedW+gap+width;
      if(current.length>0&&nextW>availW){
        rows.push(current);
        current=[{entry,index,x:0}];
        usedW=width;
      }else{
        current.push({entry,index,x:usedW+(current.length===0?0:gap)});
        usedW=nextW;
      }
    });
    if(current.length>0) rows.push(current);
    const itemH=Math.round(H*heightScale);
    const totalH=rows.length*itemH+Math.max(0,rows.length-1)*gap;
    return {rows,itemH,totalH};
  };
  for(let scale=1;scale>=minScale;scale-=0.02){
    const layout=buildRows(scale);
    if(layout.totalH<=availH){
      compactScale=scale;
      break;
    }
  }
  const layout=buildRows(compactScale);
  layout.rows.forEach((row,rowIndex)=>{
    row.forEach(({entry,index,x})=>{
      const [,w]=entry;
      if(!w||w.isDestroyed()) return;
      w.setBounds({
        x:Math.round(startX+x),
        y:Math.round(startY+rowIndex*(layout.itemH+gap)),
        width:noteWidths[index],
        height:layout.itemH,
      });
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

// ── Broadcast helpers ──
function loadEventsSnapshot(){
  const events=loadAppData('events.json');
  return Array.isArray(events)?events:[];
}

function broadcastEventsChanged(data={}){
  const payload={action:'events-changed',events:loadEventsSnapshot(),...data};
  const wins=[winRegistry.calendar,...Object.values(winRegistry.notes)];
  wins.forEach(w=>{if(w&&!w.isDestroyed()) w.webContents.send('events-changed',payload)});
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
      // If edgeAutoHide is changed
      if(scope==='calendar'&&key==='edgeAutoHide'){
        if(value){
          // Turned ON: proactively check if already near edge
          ensureEdgePolling();
          setTimeout(()=>checkEdgeAutoHide(),40);
        }else{
          clearEdgeTimers();
          stopEdgePolling();
          const cal=winRegistry.calendar;
          if(cal&&!cal.isDestroyed()&&isCalendarCollapsed) expandCalendar(cal,false);
        }
      }
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
  ipcMain.on('hide-note-by-id',(_e,noteId)=>{
    if(typeof noteId!=='string'||!noteId.trim()) return;
    const note=loadNoteData(noteId);
    if(note&&note.isDocked===true){
      saveNoteData(noteId,{...note,isDocked:true,isHidden:true});
      notifyNotesChanged();
      return;
    }
    saveNoteData(noteId,{...(note||{}),isHidden:true});
    const w=winRegistry.notes[noteId];
    if(w&&!w.isDestroyed()){
      saveWindowBounds();
      w.hide();
    }
  });
  ipcMain.on('create-note',(_e,options)=>{createNoteWindow(null,true,undefined,options&&typeof options==='object'?options:{})});
  ipcMain.on('delete-note',(_e,noteId)=>{
    if(typeof noteId!=='string'||!noteId.trim()) return;
    const fp=path.join(DATA_DIR,`note_${noteId}.json`);
    try{if(fs.existsSync(fp))fs.unlinkSync(fp)}catch(e){console.error('deleteNoteFile failed:',e.message)}
    const w=winRegistry.notes[noteId];
    if(w&&!w.isDestroyed()){
      w.close()
    }
    notifyNotesChanged();
  });
  ipcMain.on('open-settings',()=>{createSettingsWindow()});
  ipcMain.on('tidy-notes',()=>{tidyAllNotes()});
  ipcMain.on('show-day-context-menu',(event,dateStr,screenX,screenY)=>{
    const win=BrowserWindow.fromWebContents(event.sender);
    if(!win||win.isDestroyed()||typeof dateStr!=='string') return;
    const template=[
      {label:'新建单日事件',click:()=>win.webContents.send('day-context-action',{dateStr,mode:'single'})},
      {label:'新建跨日事件',click:()=>win.webContents.send('day-context-action',{dateStr,mode:'multi'})},
    ];
    Menu.buildFromTemplate(template).popup({
      window: win,
      x: Number.isFinite(screenX) ? Math.round(screenX - win.getBounds().x) : undefined,
      y: Number.isFinite(screenY) ? Math.round(screenY - win.getBounds().y) : undefined,
    });
  });
  ipcMain.on('open-event-editor',(_e,eventData)=>openEventEditorInCalendar(eventData));

  // ── Note visibility management ──
  ipcMain.on('show-note',(_e,noteId)=>{
    if(typeof noteId==='string'){
      const note=loadNoteData(noteId);
      if(note&&note.isDocked===true){
        saveNoteData(noteId,{...note,isDocked:true,isHidden:false});
        showCalendar();
        notifyNotesChanged();
        return;
      }
      saveNoteData(noteId,{...(note||{}),isHidden:false});
      createNoteWindow(noteId);
    }
  });
  ipcMain.handle('get-visible-note-ids',()=>Object.entries(winRegistry.notes)
    .filter(([,w])=>w&&!w.isDestroyed()&&w.isVisible())
    .map(([id])=>id));

  ipcMain.on('begin-note-window-drag',(event,noteId,noteSnapshot,screenX,screenY)=>{
    const win=BrowserWindow.fromWebContents(event.sender);
    if(!win||win.isDestroyed()||typeof noteId!=='string') return;
    const b=win.getBounds();
    externalNoteDrag={
      noteId,
      win,
      noteSnapshot: noteSnapshot&&typeof noteSnapshot==='object'?noteSnapshot:{},
      startBounds:b,
      offsetX:screenX-b.x,
      offsetY:screenY-b.y,
      overDock:false,
    };
    win.webContents.send('note-dock-hover',false);
  });
  ipcMain.on('move-note-window-drag',(_event,screenX,screenY)=>{
    const drag=externalNoteDrag;
    if(!drag||!drag.win||drag.win.isDestroyed()) return;
    const overDock=isPointInDockZone(screenX,screenY);
    const width=overDock?220:drag.startBounds.width;
    const height=overDock?168:drag.startBounds.height;
    const nextBounds=overDock
      ? {x:Math.round(screenX-width/2),y:Math.round(screenY-24),width,height}
      : {x:Math.round(screenX-drag.offsetX),y:Math.round(screenY-drag.offsetY),width,height};
    drag.win.setBounds(nextBounds);
    if(drag.overDock!==overDock){
      drag.overDock=overDock;
      drag.win.webContents.send('note-dock-hover',overDock);
    }
  });
  ipcMain.on('end-note-window-drag',(_event,screenX,screenY,moved)=>{
    const drag=externalNoteDrag;
    externalNoteDrag=null;
    if(!drag||!drag.win||drag.win.isDestroyed()) return;
    const overDock=(isPointInDockZone(screenX,screenY)||drag.overDock)&&!!moved;
    if(overDock){
      const note=loadNoteData(drag.noteId);
      saveNoteData(drag.noteId,{...(note||{}),...drag.noteSnapshot,isDocked:true});
      drag.win.close();
      notifyNotesChanged();
      return;
    }
    drag.win.webContents.send('note-dock-hover',false);
    debouncedSaveWindowBounds();
  });

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
      const ids=[...new Set(noteIds.filter(id=>typeof id==='string'&&id.trim()))];
      ids.forEach(id=>createNoteWindow(id));
      const hasSavedBounds = ids.some(id => windowBounds[id]);
      if(!hasSavedBounds) tidyAllNotes();
    }
  });

  // ── Tag management ──
  ipcMain.handle('get-tags',()=>{
    try{return loadAppData('tags.json')||[]}catch(e){return[]}
  });
  ipcMain.handle('save-tag',(_e,tag)=>{
    try{
      const tags=loadAppData('tags.json')||[];
      const idx=tags.findIndex(t=>t.id===tag.id);
      if(idx>=0) tags[idx]=tag;
      else tags.push(tag);
      return saveAppData('tags.json',tags);
    }catch(e){console.error('save-tag failed:',e.message);return false}
  });
  ipcMain.handle('delete-tag',(_e,tagId)=>{
    try{
      let tags=loadAppData('tags.json')||[];
      tags=tags.filter(t=>t.id!==tagId);
      // Cascade: remove tagId from events
      const events=loadAppData('events.json')||[];
      if(Array.isArray(events)){
        const updated=events.map(ev=>(ev.tagId===tagId?{...ev,tagId:undefined}:ev));
        saveAppData('events.json',updated);
        broadcastEventsChanged({tagId,action:'tag-deleted'});
      }
      const result=saveAppData('tags.json',tags);
      return result;
    }catch(e){console.error('delete-tag failed:',e.message);return false}
  });

  // ── Event sync ──
  ipcMain.on('notify-events-changed',()=>{
    broadcastEventsChanged({action:'events-changed'});
  });
  ipcMain.handle('create-event-from-echo',(_e,eventData)=>{
    try{
      const events=loadAppData('events.json')||[];
      events.push(eventData);
      saveAppData('events.json',events);
      if(winRegistry.calendar&&!winRegistry.calendar.isDestroyed()){
        winRegistry.calendar.webContents.send('echo-event-created',eventData);
      }
      broadcastEventsChanged({action:'events-changed'});
      return eventData;
    }catch(e){console.error('create-event-from-echo failed:',e.message);return null}
  });
  ipcMain.handle('get-events-by-tag',(_e,tagId)=>{
    try{
      const events=loadAppData('events.json')||[];
      if(!Array.isArray(events)) return [];
      return events.filter(ev=>ev.tagId===tagId);
    }catch(e){return[]}
  });

  // ── Dock management (window lifecycle only; render manages dock UI) ──
  ipcMain.on('dock-note',(_e,noteId,noteSnapshot)=>{
    if(typeof noteId!=='string'||!noteId.trim()) return;
    saveNoteData(noteId,{...(noteSnapshot&&typeof noteSnapshot==='object'?noteSnapshot:{}),isDocked:true});
    const w=winRegistry.notes[noteId];
    if(w&&!w.isDestroyed()) w.close(); // close window, renderer renders in calendar
    notifyNotesChanged();
  });
  ipcMain.on('undock-note',(_e,noteId,noteSnapshot)=>{
    if(typeof noteId!=='string'||!noteId.trim()) return;
    saveNoteData(noteId,{...(noteSnapshot&&typeof noteSnapshot==='object'?noteSnapshot:{}),isDocked:false});
    createNoteWindow(noteId,false); // create new window for the note
    notifyNotesChanged();
  });
  ipcMain.on('undock-note-at',(_e,noteId,x,y,noteSnapshot)=>{
    if(typeof noteId!=='string'||!noteId.trim()) return;
    saveNoteData(noteId,{...(noteSnapshot&&typeof noteSnapshot==='object'?noteSnapshot:{}),isDocked:false});
    createNoteWindow(noteId,false,{x,y});
    notifyNotesChanged();
  });
  ipcMain.on('begin-dock-drag-preview',(_e,noteSnapshot,x,y)=>{
    if(typeof x!=='number'||typeof y!=='number') return;
    beginDockDragPreview(noteSnapshot&&typeof noteSnapshot==='object'?noteSnapshot:{},x,y);
  });
  ipcMain.on('move-dock-drag-preview',(_e,x,y,outside)=>{
    if(typeof x!=='number'||typeof y!=='number') return;
    moveDockDragPreview(x,y,!!outside);
  });
  ipcMain.on('end-dock-drag-preview',()=>{destroyDockDragPreview()});

  // ── Calendar height sync ──
  ipcMain.on('calendar-height',(_e,height)=>{
    const cal=winRegistry.calendar;
    if(!cal||cal.isDestroyed()) return;
    if(isCalendarCollapsed) {
      if(calendarOriginalBounds&&typeof height==='number'&&height>100) calendarOriginalBounds.height=Math.round(height);
      return;
    }
    if(typeof height==='number'&&height>100){
      const b=cal.getBounds();
      setCalendarBounds(cal,{x:b.x,y:b.y,width:b.width,height:Math.round(height)});
    }
  });

  // ── Tag sync broadcast ──
  ipcMain.on('notify-tags-changed',()=>{
    const all=[winRegistry.calendar,winRegistry.settings,...Object.values(winRegistry.notes)].filter(Boolean);
    all.forEach(w=>{if(!w.isDestroyed())w.webContents.send('tags-changed')});
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
app.on('before-quit',()=>{
  app.isQuitting=true;
  clearTimeout(boundsSaveTimer);
  saveWindowBounds();
  // Kill lingering Vite dev server on port 5199 (dev mode only)
  if(isDev){
    if(process.platform==='win32'){
      exec(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${DEV_PORT} ^| findstr LISTENING') do taskkill /F /PID %a`,()=>{});
    }else{
      exec(`lsof -ti:${DEV_PORT} | xargs kill -9`,()=>{});
    }
  }
});
app.on('activate',()=>{createCalendarWindow()});
