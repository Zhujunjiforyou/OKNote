// Run inside a branded OKNote test runtime. Only the native notification boundary
// is simulated; scheduler, persistence and fallback windows are production code.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
if (!process.versions.electron || process.platform !== 'darwin') throw new Error('Run this check inside a macOS OKNote test runtime.');
const electron = require('electron');
const { app, BrowserWindow } = electron;
process.on('uncaughtException', error => {console.error(error);app.exit(1);});
const root = path.join(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'oknote-reminder-delivery-'));
const created = [];
let simulatedSettings = { authorizationStatus: 2, alertSetting: 2, alertStyle: 1, notificationCenterSetting: 2, soundSetting: 2 };
class SimulatedNotification extends EventEmitter {
  static isSupported() { return true; }
  constructor(options) { super(); this.options = options; created.push(this); }
  show() { if (simulatedSettings.authorizationStatus === 1) this.emit('failed', 'Permission denied'); }
  close() { this.emit('close'); }
}
// Electron's exports are read-only; substitute only main.cjs's module import.
const Module = require('node:module');
const originalLoad = Module._load;
const appElectron = Object.create(electron);
Object.defineProperty(appElectron, 'Notification', {value:SimulatedNotification});
Module._load = function(request, parent, isMain) {
  if(request === 'electron' && parent?.filename === path.join(root,'electron/main.cjs')) return appElectron;
  if(request === './macos-desktop-window.cjs' && parent?.filename === path.join(root,'electron/main.cjs')) {
    const desktop = originalLoad.apply(this, arguments);
    return { ...desktop, getBinding: () => {
      const binding = Object.create(desktop.getBinding());
      Object.defineProperty(binding, 'getNotificationSettings', {value:async () => simulatedSettings});
      return binding;
    } };
  }
  return originalLoad.apply(this, arguments);
};
process.env.OKNOTE_E2E_TEST = '1';
process.env.OKNOTE_NATIVE_NOTIFICATION_QA = '1';
process.env.OKNOTE_DATA_DIR = profile;
app.setPath('userData', profile);
fs.mkdirSync(path.join(profile, 'data'));
const now = new Date(Date.now() - 60000);
const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
const event = {id:'qa_delivery',title:'取修好的相机',startDate:date,startTime:time,isAllDay:false,reminder:{enabled:true,minutesBefore:0,playSound:false}};
fs.writeFileSync(path.join(profile,'data/events.json'), JSON.stringify([event]));
fs.writeFileSync(path.join(profile,'data/reminder-state.json'),JSON.stringify({fired:{},lastCheckedAt:new Date(Date.now()-180000).toISOString()}));
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
const history = () => {
  const file = path.join(profile,'data/reminder-history.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : [];
};
async function until(check, label, timeoutMs = 15000) {
  const deadline = Date.now()+timeoutMs;
  while(Date.now()<deadline) { if(await check()) return; await delay(50); }
  throw new Error(`Timed out: ${label}`);
}
async function run() {
  require('../electron/main.cjs');
  await app.whenReady();
  await until(() => created.length === 1, 'native submission');
  assert.equal(history().length,0,'submission must not consume the reminder');
  await delay(500);
  assert.equal(history().length,0,'missing macOS callbacks must remain pending');
  await until(() => history().length === 1, 'fallback delivery');
  const toast = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().startsWith('data:text/html'));
  assert.ok(toast && toast.isVisible(),'the real fallback window must be visible before success is recorded');
  assert.ok(await toast.webContents.executeJavaScript('document.body.textContent.includes("取修好的相机")'));
  assert.equal(created.length,1,'pending scans must not duplicate notification submissions');
  created[0].emit('show');
  await delay(100);
  assert.equal(history().length,1,'late native acknowledgement must not duplicate history');
  toast.close();
  simulatedSettings = { ...simulatedSettings, authorizationStatus:1, alertSetting:1, alertStyle:0 };
  const calendar = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('#/calendar'));
  // The first scan has advanced its checkpoint. A newly created past event
  // would be filtered out before the permission branch can run.
  const deniedAt = new Date(Math.ceil((Date.now()+5000)/60000)*60000);
  const deniedEvent = { ...event, id:'qa_permission_off', title:'通知关闭时的提醒',
    startDate:`${deniedAt.getFullYear()}-${String(deniedAt.getMonth()+1).padStart(2,'0')}-${String(deniedAt.getDate()).padStart(2,'0')}`,
    startTime:`${String(deniedAt.getHours()).padStart(2,'0')}:${String(deniedAt.getMinutes()).padStart(2,'0')}` };
  const mutation = await calendar.webContents.executeJavaScript(`window.electronAPI.mutateEvent(${JSON.stringify({type:'create',event:deniedEvent})})`);
  assert.ok(mutation.ok);
  await until(() => history().some(entry => entry.eventId === deniedEvent.id), 'suppressed trigger recorded', deniedAt.getTime()-Date.now()+30000);
  assert.equal(created.length,2,'the denied event must reach native submission');
  assert.equal(created[1].options.title,deniedEvent.title);
  assert.equal(history().find(entry => entry.eventId === deniedEvent.id).read,false,'triggering never means read');
  assert.equal(BrowserWindow.getAllWindows().some(win => win.webContents.getURL().startsWith('data:text/html')),false,'denied permission must not be bypassed by a fallback window');
  fs.writeFileSync(path.join(root,'test-results/mac-review-reminder-qa.json'),JSON.stringify({
    createdAt:new Date().toISOString(),electron:process.versions.electron,passed:true,
    nativeBoundary:'simulated callbacks and notification settings; no OS notifications or permission changes',
    verified:['no early history','timeout fallback window visible','single submission','late callback deduplication','permission denial suppresses fallback and remains unread'],
  },null,2)+'\n');
  console.log('PASS missing macOS notification callbacks: real scheduler waits, shows fallback, then records once');
  console.log('PASS denied notification permission: trigger recorded unread, no forced fallback');
}
run().then(() => app.exit(0), error => {console.error(error);app.exit(1);});
