// Exercises the real renderer/IPC/disk chain in an isolated profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startSession, waitUntil, click, fill, key } = require('./lib/electron-qa-session.cjs');
const { delay } = require('./lib/electron-test-driver.cjs');
const root = path.resolve(__dirname, '..');
const executable = process.env.OKNOTE_ELECTRON_EXECUTABLE || require('electron');
const api = (page, method, ...args) => page.evaluate(`return await window.electronAPI.${method}(${args.map(JSON.stringify).join(',')});`);
const label = (text) => `[aria-label=${JSON.stringify(text)}]`;
const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const today = dateKey(new Date());
const offsetDay = (offset) => { const date = new Date(); date.setDate(date.getDate() + offset); return dateKey(date); };
const yesterday = offsetDay(-1);
const tomorrow = offsetDay(1);
const cell = (date) => { const [y, m, d] = date.split('-').map(Number); return `[role="gridcell"][aria-label^="${y}年${m}月${d}日"]`; };
const count = (page, date = today) => page.evaluate(`return Number(document.querySelector(${JSON.stringify(cell(date) + ' .daily-calendar-chip-count')})?.textContent || 0);`);
async function dayDetails(page, date = today) {
  await page.evaluate(`const cell = document.querySelector(${JSON.stringify(cell(date))}); cell.click(); cell.focus();`);
  await key(page, 'Enter');
  await waitUntil(() => page.evaluate('return !!document.querySelector("#day-events-title");'), 'day details open');
}
async function setDate(page, title, value) {
  await click(page, label(`更改日期：${title}`));
  await page.evaluate(`const input = document.querySelector('input[type="date"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles:true })); input.dispatchEvent(new Event('change', { bubbles:true }));`);
  await click(page, '.todo-date-editor button', '确定日期');
}

async function run() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oknote-task-completion-'));
  const storageDir = path.join(dataDir, 'data');
  fs.mkdirSync(storageDir);
  const output = path.join(root, 'test-results/task-completion');
  fs.mkdirSync(output, { recursive: true });
  const seedEvent = (id, title, extra = {}) => ({ id, title, description: '', startDate: today, isAllDay: true, color: '#326991', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...extra });
  fs.writeFileSync(path.join(storageDir, 'events.json'), JSON.stringify([
    seedEvent('legacy', '已交付的设计稿'), seedEvent('single', '提交项目方案'),
    seedEvent('repeat', '每日复盘', { recurrence: { freq:'daily', interval:1 } }),
    seedEvent('range', '产品评审', { endDate: offsetDay(2) }),
  ]));
  fs.writeFileSync(path.join(storageDir, 'note_daily.json'), JSON.stringify({
    id:'daily', title:'每日待办', color:'#f7f4ec', noteType:'daily', items:[], isHidden:true,
    dailyTodo:{ activeDate:today, lastResetDate:today, completedEventOccurrences:['legacy'] },
    createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
  }));
  let session;
  let noteId;
  try {
    session = await startSession(root, executable, dataDir);
    const cal = session.calendar;
    await api(cal, 'setSetting', 'calendar', 'edgeAutoHide', false);
    await cal.call('Emulation.setDeviceMetricsOverride', { width:1080, height:780, deviceScaleFactor:1, mobile:false });
    const state = () => api(cal, 'getEventsState');
    await waitUntil(async () => (await state()).events.find(event => event.id === 'legacy')?.completion?.completed, 'legacy completion migration');
    assert.ok(JSON.parse(fs.readFileSync(path.join(storageDir, 'events.json'), 'utf8')).find(event => event.id === 'legacy').completion.completed, 'migration is persisted before deleting any source note');

    await click(cal, `${cell(today)} ${label('打开事件：提交项目方案')}`);
    await click(cal, '[aria-labelledby="event-detail-title"] ' + label('完成事件：提交项目方案'));
    await waitUntil(async () => (await state()).events.find(event => event.id === 'single').completion.completed, 'event detail completion saved');
    assert.ok(await cal.evaluate(`return document.querySelector(${JSON.stringify(cell(today) + ' ' + label('打开事件：提交项目方案'))}).classList.contains('calendar-event-completed');`));
    await click(cal, label('关闭事件详情'));
    await dayDetails(cal);
    await click(cal, '[aria-labelledby="day-events-title"] ' + label('完成事件：每日复盘'));
    await click(cal, '[aria-labelledby="day-events-title"] ' + label('完成事件：产品评审'));
    await waitUntil(async () => (await state()).events.find(event => event.id === 'repeat').completion.occurrenceDates.includes(today), 'occurrence completion saved');
    assert.equal((await state()).events.find(event => event.id === 'repeat').completion.occurrenceDates.includes(tomorrow), false);
    await click(cal, '[aria-labelledby="day-events-title"] ' + label('恢复事件：提交项目方案'));
    await click(cal, label('关闭当日日程'));
    for (const date of [today, tomorrow, offsetDay(2)]) {
      assert.ok(await cal.evaluate(`return document.querySelector(${JSON.stringify(cell(date) + ' ' + label('打开事件：产品评审'))})?.classList.contains('calendar-event-completed');`));
    }
    console.log('PASS event detail/day list/calendar: complete, undo, repeated occurrence, multi-day state');

    await api(cal, 'saveTag', { id:'work', name:'工作', color:'#326991' });
    assert.ok((await api(cal, 'mutateEvent', { type:'update', event:{ ...(await state()).events.find(event => event.id === 'legacy'), tagId:'work' } })).ok);
    await api(cal, 'createNote', { noteType:'echo', echoTagId:'work' });
    const echoSummary = await waitUntil(async () => (await api(cal, 'getNoteSummaries')).find(note => note.noteType === 'echo'), 'tag view created');
    const echo = await session.page(`#/note/${echoSummary.id}`);
    await click(echo, label('恢复事件：已交付的设计稿'));
    await waitUntil(async () => !(await state()).events.find(event => event.id === 'legacy').completion.completed, 'tag view undo');
    await click(echo, label('完成事件：已交付的设计稿'));
    await waitUntil(async () => (await state()).events.find(event => event.id === 'legacy').completion.completed, 'tag view completion');
    await click(cal, '.view-note-panel ' + label('完成事件：提交项目方案'));
    await waitUntil(async () => (await state()).events.find(event => event.id === 'single').completion.completed, 'fixed panel completion');
    await click(cal, '.view-note-panel ' + label('恢复事件：提交项目方案'));
    console.log('PASS tag view and fixed panel completion controls');
    await waitUntil(async () => (await count(cal)) === 1, 'only unfinished event is counted');

    await api(cal, 'createNote', { noteType:'daily', activeDate:today });
    const daily = await session.page('#/note/daily');
    await api(cal, 'createNote', { noteType:'independent', title:'项目准备' });
    const summary = await waitUntil(async () => (await api(cal, 'getNoteSummaries')).find(note => note.noteType === 'independent'), 'independent note created');
    noteId = summary.id;
    const note = await session.page(`#/note/${noteId}`);
    await fill(note, 'input[aria-label="待办内容"]', '整理访谈资料');
    await key(note, 'Enter');
    await waitUntil(async () => (await api(cal, 'loadNote', noteId)).items.length === 1, 'todo created');
    assert.equal(await cal.evaluate('return document.querySelectorAll(".calendar-todo-preview").length;'), 0, 'undated todo stays in source');
    await click(note, label('安排到日历：整理访谈资料'));
    await click(note, '.todo-date-editor button', '确定日期');
    await waitUntil(async () => (await api(cal, 'loadNote', noteId)).items[0].todoDate === today, 'assigned date saved');
    await waitUntil(() => cal.evaluate(`return !!document.querySelector(${JSON.stringify(cell(today) + ' ' + label('打开待办：整理访谈资料'))});`), 'independent todo visible in calendar');
    await waitUntil(() => daily.evaluate(`return !!document.querySelector(${JSON.stringify(label('完成“整理访谈资料”'))});`), 'daily panel includes dated source todo');
    assert.equal(await count(cal), 2, 'dated source todo joins pending count');
    await dayDetails(cal);
    await click(cal, '[aria-labelledby="day-events-title"] ' + label('完成“整理访谈资料”'));
    await waitUntil(() => note.evaluate(`return document.querySelector(${JSON.stringify(label('将“整理访谈资料”标记为未完成'))})?.getAttribute('aria-checked') === 'true';`), 'completion broadcast to original note');
    await waitUntil(() => daily.evaluate(`return !!document.querySelector(${JSON.stringify(label('将“整理访谈资料”标记为未完成'))});`), 'completion broadcast to daily panel');
    assert.equal(await count(cal), 1, 'completed todo leaves pending count');
    await click(note, label('将“整理访谈资料”标记为未完成'));
    await waitUntil(() => cal.evaluate(`return !!document.querySelector('[aria-labelledby="day-events-title"] ' + ${JSON.stringify(label('完成“整理访谈资料”'))});`), 'source undo updates open day details');
    await click(cal, label('关闭当日日程'));
    await click(cal, `${cell(today)} ${label('打开待办：整理访谈资料')}`);
    await waitUntil(() => note.evaluate('return !!document.querySelector(".note-window-root");'), 'todo preview opens its source note');
    assert.equal(await cal.evaluate('return !!document.querySelector("#day-events-title");'), false, 'todo preview keeps its original source navigation');
    assert.equal((await api(cal, 'loadNote', noteId)).isHidden, false);
    assert.equal((await api(cal, 'getNotesState')).reduce((sum, note) => sum + note.items.filter(item => item.content === '整理访谈资料').length, 0), 1, 'no duplicate task');
    console.log('PASS dated independent todo: source/calendar/daily panel synchronization and undo');

    await setDate(note, '整理访谈资料', yesterday);
    await waitUntil(() => cal.evaluate(`return document.querySelector(${JSON.stringify(cell(yesterday) + ' ' + label('打开待办：整理访谈资料'))})?.classList.contains('task-overdue');`), 'past todo is muted');
    assert.equal((await api(cal, 'loadNote', noteId)).items[0].isCompleted, false);
    await click(note, label('更改日期：整理访谈资料'));
    await click(note, '.todo-date-editor button', '移出日历');
    await waitUntil(() => cal.evaluate('return document.querySelectorAll(".calendar-todo-preview").length === 0;'), 'remove date removes calendar entry');
    assert.equal((await api(cal, 'loadNote', noteId)).items.length, 1);
    await click(note, label('安排到日历：整理访谈资料'));
    await click(note, '.todo-date-editor button', '确定日期');
    await waitUntil(async () => (await api(cal, 'loadNote', noteId)).items[0].todoDate === today, 'rescheduled');
    console.log('PASS date changes/removal: overdue state remains unfinished and source record remains intact');

    await api(cal, 'setSetting', 'theme', 'themeMode', 'light');
    await waitUntil(() => cal.evaluate('return document.documentElement.classList.contains("light");'), 'light theme applied');
    await api(cal, 'setSetting', 'calendar', 'fontSize', 28);
    await dayDetails(cal);
    for (const [width, height] of [[560,680], [344,284]]) {
      await cal.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor:1, mobile:false });
      await delay(180);
      const geometry = await cal.evaluate(`const dialog = document.querySelector('[aria-labelledby="day-events-title"]'); const box = dialog.getBoundingClientRect(); return { left:box.left, right:box.right, top:box.top, bottom:box.bottom, scrollWidth:dialog.scrollWidth, clientWidth:dialog.clientWidth };`);
      assert.ok(geometry.left >= 0 && geometry.right <= width && geometry.top >= 0 && geometry.bottom <= height);
      assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, 'day list has no horizontal overflow');
      assert.ok(await cal.evaluate(`const body = document.querySelector('.day-agenda-body'); return body.clientHeight > 90 && body.scrollWidth <= body.clientWidth + 1;`), 'list content remains accessible in a tiny window');
      assert.ok(await cal.evaluate(`const dialog = document.querySelector('.day-agenda'); const r = document.querySelector('.day-agenda-header').getBoundingClientRect(); return [20,r.width/2,r.width-20].every(x => dialog.contains(document.elementFromPoint(r.left+x,r.top+5)));`), 'day dialog covers the underlying window toolbar');
      const shot = await cal.call('Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
      fs.writeFileSync(path.join(output, `day-list-${width}x${height}.png`), Buffer.from(shot.data, 'base64'));
    }
    assert.deepEqual(session.errors, []);
    await session.stop(); session = null;
    session = await startSession(root, executable, dataDir);
    const saved = (await api(session.calendar, 'getEventsState')).events;
    assert.equal(saved.find(event => event.id === 'legacy').completion.completed, true);
    assert.equal(saved.find(event => event.id === 'single').completion.completed, false);
    assert.deepEqual(saved.find(event => event.id === 'repeat').completion.occurrenceDates, [today]);
    assert.equal(saved.find(event => event.id === 'range').completion.completed, true);
    assert.equal((await api(session.calendar, 'loadNote', noteId)).items[0].todoDate, today);
    assert.deepEqual(session.errors, []);
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ passed:true, checkedAt:new Date().toISOString(), checks:['event completion and undo','legacy migration','recurring and multi-day events','three-window todo sync','date assignment and removal','overdue styling','narrow layout','cold restart'] }, null, 2));
    console.log('PASS cold restart and narrow layout; task completion QA passed');
  } catch (error) {
    throw new Error(`${error.stack}\n${session?.diagnostics() || ''}`);
  } finally {
    if (session) await session.stop();
    const owned = path.resolve(dataDir);
    assert.equal(path.dirname(owned), path.resolve(os.tmpdir()));
    assert.ok(path.basename(owned).startsWith('oknote-task-completion-'));
    fs.rmSync(owned, { recursive:true, force:true, maxRetries:20, retryDelay:250 });
  }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
