// Isolated interaction and render-regression checks. Never reads real notes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startSession, waitUntil, click, fill, key } = require('./lib/electron-qa-session.cjs');
const { delay } = require('./lib/electron-test-driver.cjs');
const { renderAuditSource } = require('./lib/react-render-audit.cjs');
const root = path.join(__dirname, '..');
const executable = process.env.OKNOTE_ELECTRON_EXECUTABLE || require('electron');
const body = (fn) => 'return (' + fn.toString() + ')();';
const api = (client, method, ...args) => client.evaluate('return window.electronAPI.' + method + '(' + args.map(JSON.stringify).join(',') + ');');
const loadNote = (client) => api(client, 'loadNote', 'perf_note');
const commits = (client) => client.evaluate('return window.__auditRenders;');
const reset = (client) => client.evaluate('window.__auditRenders.length = 0;');
const nextFrame = (client) => client.evaluate('await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);');
async function installAudit(client, selector) {
  await client.call('Page.enable');
  await client.call('Page.addScriptToEvaluateOnNewDocument', { source: renderAuditSource });
  await client.call('Page.reload');
  await waitUntil(() => client.evaluate('return Boolean(document.querySelector(' + JSON.stringify(selector) + ') && window.__auditRenders?.length);'), 'instrumented surface');
  await delay(300);
}
async function run() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oknote-render-qa-'));
  const now = new Date();
  const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  const stamp = now.toISOString();
  fs.mkdirSync(path.join(dataDir, 'data'));
  fs.writeFileSync(path.join(dataDir, 'data', 'note_perf_note.json'), JSON.stringify({
    id: 'perf_note', title: '性能回归便签', color: '#FDE047', noteType: 'independent', isHidden: false, isDocked: false,
    createdAt: stamp, updatedAt: stamp, revision: 0,
    items: Array.from({ length: 200 }, (_, i) => ({ id: 'task_' + i, noteId: 'perf_note', content: '测试待办 ' + i, isCompleted: false, sortOrder: i })),
  }));
  fs.writeFileSync(path.join(dataDir, 'data', 'events.json'), JSON.stringify([
    { id: 'event_a', title: '性能回归事件', startDate: today, isAllDay: true, color: '#22C55E', createdAt: stamp, updatedAt: stamp },
  ]));
  fs.writeFileSync(path.join(dataDir, 'window-bounds.json'), JSON.stringify({
    calendar: { x: 40, y: 40, width: 900, height: 700 }, perf_note: { x: 950, y: 100, width: 380, height: 600 },
  }));
  let session;
  try {
    session = await startSession(root, executable, dataDir);
    const cal = session.calendar;
    const note = await session.page('#/note/perf_note');
    await installAudit(note, 'input[aria-label="待办内容"]');
    await installAudit(cal, '.cal-month-title');
    assert.ok((await commits(note)).some((entry) => entry.todos === 200), 'observer must see initial rows');
    assert.ok((await commits(cal)).some((entry) => entry.dayCells >= 28), 'observer must see initial date cells');

    await reset(note);
    await note.evaluate(body(async function () {
      const input = document.querySelector('input[aria-label="待办内容"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      input.focus();
      for (const value of ['输', '输入', '输入草稿', '']) {
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(requestAnimationFrame);
      }
    }));
    assert.equal((await commits(note)).reduce((sum, entry) => sum + entry.todos, 0), 0, 'typing must not render existing rows');
    await reset(note);
    await note.evaluate('document.querySelector(\'[aria-label="完成“测试待办 0”"]\').click();');
    await waitUntil(async () => (await loadNote(cal)).items[0].isCompleted, 'single-item completion');
    const toggles = await commits(note);
    assert.ok(toggles.some((entry) => entry.todos === 1), 'observer must see the changed row');
    assert.ok(toggles.every((entry) => entry.todos <= 1), 'completion must leave other rows alone');

    // Rows whose own props did not change must still delete/restore at the
    // current index after an earlier sibling disappears.
    for (const content of ['测试待办 0', '测试待办 1']) {
      await note.evaluate('document.querySelector(' + JSON.stringify('[aria-label="删除“' + content + '”"]') + ').click();');
      await waitUntil(async () => !(await loadNote(cal)).items.some((item) => item.content === content), 'deletion');
    }
    for (const content of ['测试待办 1', '测试待办 0']) {
      await note.evaluate('const status = [...document.querySelectorAll(\'[role="status"]\')].find(el => el.textContent.includes(' + JSON.stringify('已删除“' + content + '”') + ')); status.querySelector("button").click();');
      await waitUntil(async () => (await loadNote(cal)).items.some((item) => item.content === content), 'undo');
    }
    assert.deepEqual((await loadNote(cal)).items.slice(0, 3).map((item) => item.id), ['task_0', 'task_1', 'task_2']);

    const editor = await note.evaluate(body(async function () {
      [...document.querySelectorAll('[title="点击编辑"]')].find(el => el.textContent === '测试待办 1').click();
      await Promise.resolve();
      const input = document.querySelector('input[aria-label="编辑待办内容"]');
      return { focused: document.activeElement === input, selected: input?.selectionEnd - input?.selectionStart, length: input?.value.length };
    }));
    assert.equal(editor.focused, true, 'editing must focus in the commit, without a timer');
    assert.equal(editor.selected, editor.length, 'editing must immediately select the content');
    await note.evaluate(body(async function () {
      const input = document.querySelector('input[aria-label="编辑待办内容"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '中文输入中');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true }));
      await Promise.resolve();
    }));
    assert.equal(await note.evaluate('return Boolean(document.querySelector(\'input[aria-label="编辑待办内容"]\'));'), true, 'IME Enter must not submit');
    assert.equal((await loadNote(cal)).items[1].content, '测试待办 1');
    await note.evaluate('document.querySelector(\'input[aria-label="编辑待办内容"]\').dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));');
    await nextFrame(note);
    assert.equal((await loadNote(cal)).items[1].content, '测试待办 1', 'Escape must cancel the draft');

    // Changing focus between two memoized rows must save the first row before
    // the second editor mounts, without stealing the second editor's focus.
    await click(note, '[title="点击编辑"]', '测试待办 1');
    await fill(note, 'input[aria-label="编辑待办内容"]', '切换焦点前的草稿');
    await click(note, '[title="点击编辑"]', '测试待办 2');
    await waitUntil(async () => (await loadNote(cal)).items[1].content === '切换焦点前的草稿', 'blur save before switching rows');
    assert.equal(await note.evaluate('return document.activeElement?.value;'), '测试待办 2', 'second editor must retain focus');
    await key(note, 'Escape');
    assert.equal((await loadNote(cal)).items[2].content, '测试待办 2');

    await reset(cal);
    const title = await note.evaluate(body(async function () {
      document.querySelector('[role="button"][title*="F2"]').click();
      await Promise.resolve();
      const input = document.querySelector('input[aria-label="编辑独立便签标题"]');
      const ready = document.activeElement === input && input.selectionEnd === input.value.length && input.selectionStart === 0;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '标题已更新');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return ready;
    }));
    assert.equal(title, true, 'title selection must be immediate');
    await waitUntil(async () => (await loadNote(cal)).title === '标题已更新', 'title persistence');
    await nextFrame(cal);
    assert.equal((await commits(cal)).reduce((sum, entry) => sum + entry.dayCells, 0), 0, 'independent note changes must not redraw the calendar');

    await reset(cal);
    const chosenLabel = await cal.evaluate(body(function () {
      const cells = [...document.querySelectorAll('[role="gridcell"]')];
      const cell = cells.slice(14, 21).find(el => el.getAttribute('aria-selected') !== 'true');
      cell.click();
      return cell.getAttribute('aria-label');
    }));
    await nextFrame(cal);
    assert.equal(await cal.evaluate('return document.querySelector(\'[role="gridcell"][aria-selected="true"]\')?.getAttribute("aria-label");'), chosenLabel);
    const selectionRenders = (await commits(cal)).reduce((sum, entry) => sum + entry.dayCells, 0);
    assert.ok(selectionRenders >= 1 && selectionRenders <= 2, 'date change must update the selected cells, not the entire month');

    await reset(cal);
    const height = await cal.evaluate(body(async function () {
      const separator = document.querySelector('[role="separator"]');
      for (let i = 0; i < 8; i += 1) {
        separator.dispatchEvent(new KeyboardEvent('keydown', { key: i % 2 ? 'ArrowDown' : 'ArrowUp', bubbles: true }));
        await new Promise(requestAnimationFrame);
      }
      return Number(separator.getAttribute('aria-valuenow'));
    }));
    assert.equal((await commits(cal)).reduce((sum, entry) => sum + entry.dayCells, 0), 0, 'height changes must skip the calendar cells');

    // Use real CDP pointer events: pointer capture and a final pending rAF must
    // both preserve the last drag position when the pointer is released.
    await cal.call('Page.bringToFront');
    const point = await cal.evaluate('const r=document.querySelector(\'[role="separator"]\').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};');
    await cal.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await cal.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y - 32, button: 'left', buttons: 1 });
    await cal.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y - 32, button: 'left', clickCount: 1 });
    await nextFrame(cal);
    assert.equal(await cal.evaluate('return Number(document.querySelector(\'[role="separator"]\').getAttribute("aria-valuenow"));'), height + 32);
    assert.equal(await cal.evaluate('return Number(localStorage.getItem("oknote.calendarDockHeight"));'), height + 32);

    // A saved height can exceed a temporarily smaller window. Clicking the
    // separator without dragging must not restore that oversized preference.
    await cal.evaluate('document.querySelector(\'[role="separator"]\').dispatchEvent(new KeyboardEvent("keydown", {key:"End",bubbles:true}));');
    await nextFrame(cal);
    const preferredHeight = await cal.evaluate('return Number(localStorage.getItem("oknote.calendarDockHeight"));');
    await cal.call('Emulation.setDeviceMetricsOverride', { width: 900, height: 400, deviceScaleFactor: 1, mobile: false });
    await nextFrame(cal);
    const limitedHeight = await cal.evaluate('return Number(document.querySelector(\'[role="separator"]\').getAttribute("aria-valuenow"));');
    assert.ok(limitedHeight < preferredHeight, 'test requires a clamped saved height');
    await click(cal, '[role="separator"]');
    await nextFrame(cal);
    assert.equal(await cal.evaluate('return Number(document.querySelector(\'[role="separator"]\').getAttribute("aria-valuenow"));'), limitedHeight,
      'clicking without movement must keep the height within the smaller viewport');
    assert.equal(await cal.evaluate('return Number(localStorage.getItem("oknote.calendarDockHeight"));'), preferredHeight,
      'temporary viewport constraints must preserve the saved preference');
    await cal.call('Emulation.clearDeviceMetricsOverride');
    await nextFrame(cal);
    assert.equal(await cal.evaluate('return Number(document.querySelector(\'[role="separator"]\').getAttribute("aria-valuenow"));'), preferredHeight);
    await cal.evaluate('document.querySelector(\'[role="separator"]\').dispatchEvent(new KeyboardEvent("keydown", {key:"Home",bubbles:true}));');
    await nextFrame(cal);
    await cal.evaluate('document.querySelector(\'[role="separator"]\').dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowUp",bubbles:true}));');
    await nextFrame(cal);
    await cal.evaluate('document.querySelector(\'[role="separator"]\').dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowUp",bubbles:true}));');
    await nextFrame(cal);

    // A previously unrelated record must become visible when it is docked.
    const heightAfterLimitsTest = await cal.evaluate('return Number(document.querySelector(\'[role="separator"]\').getAttribute("aria-valuenow"));');
    await click(note, '[aria-label="打开便签菜单"]');
    await click(note, '[role="menuitem"]', '挂载到日历');
    await waitUntil(() => cal.evaluate('return Boolean(document.querySelector(\'.dock-main-strip [title*="F2"]\'));'), 'docked note');
    const dockTitle = await cal.evaluate(body(async function () {
      document.querySelector('.dock-main-strip [title*="F2"]').click();
      await Promise.resolve();
      const input = document.querySelector('input[aria-label="编辑挂载便签标题"]');
      const ready = document.activeElement === input && input.selectionEnd === input.value.length && input.selectionStart === 0;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return ready;
    }));
    assert.equal(dockTitle, true, 'docked title must focus/select immediately');
    if (process.env.OKNOTE_QA_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.OKNOTE_QA_SCREENSHOT_DIR, { recursive: true });
      const shot = await cal.call('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(process.env.OKNOTE_QA_SCREENSHOT_DIR, 'optimized-calendar.png'), Buffer.from(shot.data, 'base64'));
    }
    assert.deepEqual(session.errors, []);
    await session.stop();
    session = await startSession(root, executable, dataDir);
    await waitUntil(() => session.calendar.evaluate('return Boolean(document.querySelector(".dock-main-strip .docked-note-card"));'), 'docked note after restart');
    assert.equal(await session.calendar.evaluate('return Number(document.querySelector(\'[role="separator"]\').getAttribute("aria-valuenow"));'), heightAfterLimitsTest);
    assert.equal((await loadNote(session.calendar)).title, '标题已更新');
    assert.deepEqual(session.errors, []);
    console.log('PASS render regression: no whole-list typing, isolated checkbox/date updates, no calendar redraw on note/height changes.');
    console.log('PASS interaction regression: immediate selection, IME/Escape, blur between rows, current-index undo, pointer resize, viewport limits/preference restore, dock, persisted height and cold restart.');
  } finally {
    if (session) await session.stop();
    // Delete only the known temporary directory created by this run.
    const resolved = path.resolve(dataDir);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('oknote-render-qa-'));
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
