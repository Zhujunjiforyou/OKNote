// Opt-in Windows native notification check against an installed, packaged app.
// Uses synthetic reminder data; the real profile and login settings are untouched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startSession, waitUntil } = require('./lib/electron-qa-session.cjs');
const root = path.join(__dirname, '..');
const executable = process.env.OKNOTE_ELECTRON_EXECUTABLE;
if (process.platform !== 'win32' || !executable || !path.isAbsolute(executable)) {
  throw new Error('Set OKNOTE_ELECTRON_EXECUTABLE to the absolute path of an installed Windows OKNote.exe.');
}

async function run() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oknote-native-notification-qa-'));
  fs.mkdirSync(path.join(dataDir, 'data'));
  fs.writeFileSync(path.join(dataDir, 'data', 'reminder-state.json'), JSON.stringify({ fired: {}, lastCheckedAt: new Date(Date.now() - 300_000).toISOString() }));
  fs.writeFileSync(path.join(dataDir, 'window-bounds.json'), JSON.stringify({ calendar: { x: 150, y: 120, width: 740, height: 560 } }));
  process.env.OKNOTE_NATIVE_NOTIFICATION_QA = '1';
  const session = await startSession(root, executable, dataDir);
  const api = (method, ...args) => session.calendar.evaluate(`return await window.electronAPI.${method}(${args.map(arg => JSON.stringify(arg)).join(',')});`);
  try {
    console.log('NATIVE_NOTIFICATION_ARMED: a test notification will be triggered in 15 seconds.');
    await new Promise(resolve => setTimeout(resolve, 15_000));
    const now = new Date(Date.now() - 60_000);
    const eventId = `native_identity_qa_${Date.now()}`;
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    assert.equal((await api('mutateEvent', { type: 'create', event: {
      id: eventId, title: 'OKNote 通知外观检查', startDate: date, startTime: time, isAllDay: false,
      reminder: { enabled: true, minutesBefore: 0, playSound: false },
    } })).ok, true);
    await waitUntil(async () => (await api('getReminderHistory')).some(item => item.eventId === eventId), 'native reminder delivery', 25_000);
    const pages = await (await fetch(`http://127.0.0.1:${session.port}/json/list`)).json();
    assert.ok(!pages.some(page => page.url.startsWith('data:text/html')), 'native check must not silently pass through the fallback');
    console.log(`NATIVE_NOTIFICATION_READY ${JSON.stringify({ port: session.port, eventId, dataDir })}`);
    console.log('Inspect the Windows notification source icon/name, then click its body to verify navigation.');
    await waitUntil(async () => (await api('getReminderHistory')).some(item => item.eventId === eventId && item.read), 'native notification click/read state', 120_000);
    await waitUntil(() => session.calendar.evaluate('return Boolean(document.querySelector("[role=dialog]"));'), 'notification opens its event');
    assert.deepEqual(session.errors, []);
    console.log('PASS native notification: scheduled delivery, click, read state and event navigation; isolated data.');
  } finally {
    await session.stop();
    const resolved = path.resolve(dataDir);
    if (path.dirname(resolved) === os.tmpdir() && path.basename(resolved).startsWith('oknote-native-notification-qa-')) {
      fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    }
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
