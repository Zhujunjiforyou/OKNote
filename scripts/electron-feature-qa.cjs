// Healthy-data complement to electron-stability-e2e.cjs. Never uses real user data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { delay } = require('./lib/electron-test-driver.cjs');
const { startSession, waitUntil, click, fill, key } = require('./lib/electron-qa-session.cjs');

const root = path.join(__dirname, '..');
const executable = process.env.OKNOTE_ELECTRON_EXECUTABLE || (process.platform === 'win32'
  ? path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(root, 'node_modules', '.bin', 'electron'));
const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const today = dateKey(new Date());
const yesterday = dateKey(new Date(Date.now() - 86400000));
const api = (client, method, ...args) => client.evaluate(`return await window.electronAPI.${method}(${args.map((arg) => JSON.stringify(arg)).join(',')});`);
const findNote = (client, predicate) => waitUntil(async () => (await api(client, 'getNoteSummaries')).find(predicate), 'note creation');
const loadNote = (client, id) => api(client, 'loadNote', id);
const label = (name) => `[aria-label=${JSON.stringify(name)}]`;

async function testCalendarItemTypes(session) {
  const cal = session.calendar;
  const eventIds = ['qa_type_event_a', 'qa_type_event_b'];
  for (const id of eventIds) {
    assert.equal((await api(cal, 'mutateEvent', { type: 'create', event: {
      id, title: `QA 类型事件 ${id}`, startDate: today, isAllDay: true, color: '#22C55E',
    } })).ok, true);
  }
  await api(cal, 'createNote', { noteType: 'daily', activeDate: today });
  const daily = await findNote(cal, (note) => note.noteType === 'daily');
  const dailyPage = await session.page(`#/note/${daily.id}`);
  await waitUntil(() => dailyPage.evaluate('return Boolean(document.querySelector("input[aria-label$=待办内容]"));'), 'daily type-test note ready');
  const original = await loadNote(cal, daily.id);
  const items = [0, 1, 2].map((index) => ({
    id: `qa_type_todo_${index}`, noteId: daily.id, content: `QA 类型待办 ${index}`,
    isCompleted: index === 2, todoDate: today, sortOrder: index,
  }));
  assert.equal((await api(dailyPage, 'saveNote', daily.id, { ...original, items })).ok, true);
  const snapshot = () => cal.evaluate(`
    const todo = document.querySelector('[aria-label="打开待办：QA 类型待办 0"]');
    const cell = todo?.closest('[role="gridcell"]');
    if (!cell) return null;
    const chip = cell.querySelector('.daily-calendar-chip');
    const events = [...cell.querySelectorAll('[aria-label^="打开事件："]')];
    return {
      todos: cell.querySelectorAll('.calendar-todo-preview').length, events: events.length,
      count: chip?.textContent.trim(), label: cell.getAttribute('aria-label'),
      todoIcons: cell.querySelectorAll('.calendar-todo-preview .calendar-todo-icon').length,
      countIcon: Boolean(chip?.querySelector('.calendar-todo-icon')),
      summary: document.querySelector('.view-event-count')?.textContent,
      distinct: events.length > 0 && getComputedStyle(todo).backgroundColor !== getComputedStyle(events[0]).backgroundColor,
    };
  `);
  await waitUntil(async () => (await snapshot())?.todos === 2, 'mixed calendar items');
  for (const mode of ['月视图', '周视图']) {
    await click(cal, `[title="${mode}"]`);
    const state = await snapshot();
    assert.equal(state.events, 2);
    assert.equal(state.todos, 2);
    assert.equal(state.count, '2', 'badge counts pending todos, not all visible rows');
    assert.equal(state.todoIcons, 2);
    assert.equal(state.countIcon, true);
    assert.equal(state.distinct, true, 'green events must still look different from todos');
    assert.match(state.label, /2 个事件，2 个未完成待办/);
    assert.equal(state.summary, '2 个事件 · 2 个待办');
  }
  await click(cal, '[aria-label="打开待办：QA 类型待办 0"]');
  await waitUntil(async () => !(await loadNote(cal, daily.id)).isHidden, 'todo preview opens daily note');
  assert.equal((await loadNote(cal, daily.id)).items[0].isCompleted, false, 'opening a preview must not complete it');
  for (const selector of ['.daily-calendar-chip', '[aria-label="打开待办：QA 类型待办 0"]']) {
    assert.equal((await api(cal, 'hideNoteById', daily.id)).ok, true);
    await cal.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus();`);
    await key(cal, ' ');
    await waitUntil(async () => !(await loadNote(cal, daily.id)).isHidden, 'Space opens daily note');
    assert.equal(await cal.evaluate('return Boolean(document.querySelector("[role=dialog]"));'), false);
  }
  const reopenedDaily = await session.page(`#/note/${daily.id}`);
  await click(reopenedDaily, label('完成“QA 类型待办 0”'));
  await waitUntil(() => cal.evaluate('return document.querySelector(".daily-calendar-chip")?.textContent.trim() === "1";'), 'one remaining todo');
  await click(reopenedDaily, label('完成“QA 类型待办 1”'));
  await waitUntil(() => cal.evaluate('return document.querySelectorAll(".calendar-todo-preview, .daily-calendar-chip").length === 0;'), 'completed todos leave calendar preview and count');
  assert.equal(await cal.evaluate(`return document.querySelectorAll('[aria-label^="打开事件：QA 类型事件"]').length;`), 2);
  assert.equal((await api(cal, 'deleteNote', daily.id)).ok, true);
  for (const id of eventIds) assert.equal((await api(cal, 'mutateEvent', { type: 'delete', id })).ok, true);
  await click(cal, '[title="月视图"]');
  console.log('PASS calendar item types: 2 events + 2 todos, matching count/icon, green event distinction, month/week, click/Space, completion');
}

async function testEvents(session) {
  const cal = session.calendar;
  assert.equal((await api(cal, 'saveTag', { id: 'qa_tag', name: 'QA 工作', color: '#FDE047' })).ok, true);
  assert.equal((await api(cal, 'saveTag', { id: 'qa_tag', name: 'QA 工作更新', color: '#FDE047' })).ok, true);
  assert.equal((await api(cal, 'getTags')).tags.find((tag) => tag.id === 'qa_tag').name, 'QA 工作更新');

  await click(cal, '.cal-action', '事件');
  await fill(cal, label('事件标题'), 'QA 界面创建事件');
  await key(cal, 'Enter');
  const created = await waitUntil(async () => (await api(cal, 'getEventsState')).events.find((event) => event.title === 'QA 界面创建事件'), 'UI event save');
  await click(cal, '[aria-label^="打开事件：QA 界面创建事件"]');
  await click(cal, '[role="dialog"] button', '编辑');
  await fill(cal, label('事件标题'), 'QA 界面编辑事件');
  await key(cal, 'Enter');
  await waitUntil(async () => (await api(cal, 'getEventsState')).events.find((event) => event.id === created.id)?.title === 'QA 界面编辑事件', 'UI event edit');
  const nextDate = dateKey(new Date(Date.now() + 2 * 86400000));
  const state = await api(cal, 'getEventsState');
  const updated = await api(cal, 'mutateEvent', { type: 'update', expectedRevision: state.revision, event: {
    ...created, title: 'QA 跨日循环事件', startDate: today, endDate: nextDate, isAllDay: false,
    startTime: '09:00', endTime: '10:00', tagId: 'qa_tag', description: '跨窗口持久化校验',
    recurrence: { freq: 'weekly', interval: 2, byWeekday: [new Date().getDay()] },
  } });
  assert.equal(updated.ok, true);
  assert.equal(updated.event.endDate, nextDate);
  const stale = await api(cal, 'mutateEvent', { type: 'delete', id: created.id, expectedRevision: state.revision });
  assert.equal(stale.code, 'conflict');
  assert.equal((await api(cal, 'getEventsByTag', 'qa_tag')).some((event) => event.id === created.id), true);
  for (const freq of ['daily', 'monthly', 'yearly']) {
    const result = await api(cal, 'mutateEvent', { type: 'create', event: { id: `qa_${freq}`, title: `QA ${freq}`, startDate: today, isAllDay: true, recurrence: { freq, interval: 1 } } });
    assert.equal(result.ok, true);
  }
  await waitUntil(() => cal.evaluate('return document.body.textContent.includes("QA 跨日循环事件");'), 'calendar event broadcast');
  console.log('PASS events: UI create, update, date/time ranges, recurrence, tag query, stale-write conflict');
  return created.id;
}

async function testCalendarNavigation(session) {
  const cal = session.calendar;
  const title = await cal.evaluate('return document.querySelector(".cal-month-title").textContent;');
  await click(cal, label('下一个月'));
  assert.notEqual(await cal.evaluate('return document.querySelector(".cal-month-title").textContent;'), title);
  await click(cal, '.cal-left-actions .cal-action-today');
  assert.equal(await cal.evaluate('return document.querySelector(".cal-month-title").textContent;'), title);
  await click(cal, '[title="周视图"]');
  assert.equal(await cal.evaluate('return document.querySelectorAll("[role=gridcell]").length;'), 7);
  await click(cal, label('上一周'));
  await click(cal, '.cal-left-actions .cal-action-today');
  await click(cal, '[title="月视图"]');
  assert.ok(await cal.evaluate('return document.querySelectorAll("[role=gridcell]").length >= 28;'));
  console.log('PASS navigation: month/week switch, previous/next, return to today');
}

async function testNotes(session) {
  const cal = session.calendar;
  await api(cal, 'createNote', { noteType: 'independent', title: 'QA 独立便签' });
  const summary = await findNote(cal, (note) => note.title === 'QA 独立便签');
  const note = await session.page(`#/note/${summary.id}`);
  await waitUntil(() => note.evaluate('return Boolean(document.querySelector("[aria-label=待办内容]"));'), 'note ready');
  await click(note, '[role="button"][title*="F2"]');
  await fill(note, label('编辑独立便签标题'), 'QA 标题修改');
  await key(note, 'Enter');
  await fill(note, label('待办内容'), 'QA 待办一');
  await key(note, 'Enter');
  await waitUntil(async () => (await loadNote(cal, summary.id)).items.length === 1, 'todo persisted');
  await click(note, label('完成“QA 待办一”'));
  await waitUntil(async () => (await loadNote(cal, summary.id)).items[0].isCompleted, 'todo completion');
  await click(note, label('将“QA 待办一”标记为未完成'));
  await click(note, '[title="点击编辑"]');
  await fill(note, label('编辑待办内容'), 'QA 待办已编辑');
  await key(note, 'Enter');
  await click(note, label('删除“QA 待办已编辑”'));
  await waitUntil(async () => (await loadNote(cal, summary.id)).items.length === 0, 'todo deletion');
  await click(note, 'button', '撤销');
  await waitUntil(async () => (await loadNote(cal, summary.id)).items[0]?.content === 'QA 待办已编辑', 'undo persistence');
  await click(note, label('打开便签菜单'));
  await click(note, '[role="menuitem"]', '挂载到日历');
  await waitUntil(async () => (await loadNote(cal, summary.id)).isDocked, 'dock note');
  await waitUntil(() => cal.evaluate(`
    const strip = document.querySelector('.dock-main-strip');
    if (!strip) return false;
    const rect = strip.getBoundingClientRect();
    return Math.abs(rect.width - strip.offsetWidth) < 0.75
      && Math.abs(rect.height - strip.offsetHeight) < 0.75;
  `), 'front docked notes render at layout size without perspective magnification');
  const docked = await loadNote(cal, summary.id);
  const saved = await api(cal, 'saveNote', summary.id, { ...docked, title: 'QA 挂载后修改' });
  assert.equal(saved.ok, true);
  assert.equal(saved.note.revision, docked.revision + 1);
  assert.equal((await api(cal, 'undockNote', summary.id, saved.note)).ok, true);
  await waitUntil(async () => !(await loadNote(cal, summary.id)).isDocked, 'undock note');
  assert.equal((await api(cal, 'hideNoteById', summary.id)).ok, true);
  assert.equal((await loadNote(cal, summary.id)).isHidden, true);
  assert.equal((await api(cal, 'showNote', summary.id)).ok, true);
  const stable = await loadNote(cal, summary.id);
  assert.equal(stable.items[0].content, 'QA 待办已编辑');
  console.log('PASS independent notes: title, todo CRUD/completion/undo, dock/edit/undock, hide/show');
  return summary.id;
}

async function testDailyAndEcho(session) {
  const cal = session.calendar;
  await api(cal, 'createNote', { noteType: 'daily', activeDate: today });
  const daily = await findNote(cal, (note) => note.noteType === 'daily');
  await api(cal, 'createNote', { noteType: 'daily', activeDate: today });
  assert.equal((await api(cal, 'getNoteSummaries')).filter((note) => note.noteType === 'daily').length, 1);
  const dailyPage = await session.page(`#/note/${daily.id}`);
  await waitUntil(() => dailyPage.evaluate('return Boolean(document.querySelector("input[aria-label$=待办内容]"));'), 'daily panel');
  await fill(dailyPage, 'input[aria-label$="待办内容"]', 'QA 每日内容');
  await key(dailyPage, 'Enter');
  await waitUntil(async () => (await loadNote(cal, daily.id)).items.some((item) => item.content === 'QA 每日内容' && item.todoDate === today), 'daily dated item');
  await click(dailyPage, '[title="点击输入日期"]');
  await fill(dailyPage, label('每日待办日期'), yesterday);
  await key(dailyPage, 'Enter');
  assert.equal(await dailyPage.evaluate('return document.body.textContent.includes("QA 每日内容");'), false);
  await api(cal, 'createNote', { noteType: 'daily', activeDate: today });
  await waitUntil(() => dailyPage.evaluate('return document.body.textContent.includes("QA 每日内容");'), 'return to daily date');
  await click(dailyPage, label('完成循环待办：QA daily'));
  await waitUntil(async () => (await loadNote(cal, daily.id)).dailyTodo.completedEventOccurrences?.length > 0, 'recurring occurrence completion');
  await click(dailyPage, label('恢复循环待办：QA daily'));

  await api(cal, 'createNote', { noteType: 'echo', echoTagId: 'qa_tag' });
  const echo = await findNote(cal, (note) => note.noteType === 'echo');
  await api(cal, 'createNote', { noteType: 'echo', echoTagId: 'qa_tag' });
  assert.equal((await api(cal, 'getNoteSummaries')).filter((note) => note.noteType === 'echo').length, 1);
  const echoPage = await session.page(`#/note/${echo.id}`);
  await waitUntil(() => echoPage.evaluate('return document.body.textContent.includes("QA 跨日循环事件");'), 'tag-view event sync');
  await click(echoPage, 'button', '新建事件');
  await fill(echoPage, label('事件标题'), 'QA 标签视图创建');
  await key(echoPage, 'Enter');
  const echoEvent = await waitUntil(async () => (await api(cal, 'getEventsState')).events.find((event) => event.title === 'QA 标签视图创建'), 'quick event save');
  assert.equal(echoEvent.tagId, 'qa_tag');
  await waitUntil(() => cal.evaluate('return document.body.textContent.includes("QA 标签视图创建");'), 'echo to calendar sync');
  console.log('PASS daily/echo notes: singleton, date isolation, return to history, tag filtering, event synchronization');
  return { dailyId: daily.id, echoId: echo.id };
}

async function testSettings(session) {
  const cal = session.calendar;
  await click(cal, label('打开设置'));
  const settings = await session.page('#/settings');
  await waitUntil(() => settings.evaluate('return Boolean(document.querySelector("[aria-label=全局字体]"));'), 'settings ready');
  await settings.call('Emulation.setDeviceMetricsOverride', { width: 500, height: 520, deviceScaleFactor: 1, mobile: false });
  await click(settings, label('全局字体'));
  const fontListBounds = await settings.evaluate(`
    const list = document.querySelector('[role="listbox"]').getBoundingClientRect();
    const viewport = document.querySelector('main').getBoundingClientRect();
    return { top: list.top, bottom: list.bottom, height: list.height, viewportTop: viewport.top, viewportBottom: Math.min(innerHeight, viewport.bottom) };
  `);
  assert.ok(fontListBounds.top >= fontListBounds.viewportTop && fontListBounds.bottom <= fontListBounds.viewportBottom, 'font list must stay inside the short scroll viewport');
  assert.ok(fontListBounds.height >= 150, 'font list should use the room above the input instead of showing a clipped sliver');
  await key(settings, 'Escape');
  await settings.call('Emulation.clearDeviceMetricsOverride');
  await fill(settings, label('全局字体'), 'Microsoft YaHei');
  await key(settings, 'Enter');
  await fill(settings, label('全局字号'), 20);
  await waitUntil(async () => (await api(settings, 'getSettings')).notes.fontSize === 20, 'global font propagation');
  const global = await api(settings, 'getSettings');
  assert.equal(global.calendar.fontSize, 20);
  assert.equal(global.notes.fontFamily, 'Microsoft YaHei');
  await click(settings, '.settings-nav-button', '日历');
  await fill(settings, label('窗口字体'), 'Arial');
  await key(settings, 'Enter');
  await fill(settings, label('字号'), 18);
  await fill(settings, label('不透明度'), 95);
  await waitUntil(async () => (await api(settings, 'getSettings')).calendar.backgroundOpacity === 0.95, 'calendar opacity');
  assert.equal((await api(settings, 'getSettings')).calendar.fontFamily, 'Arial');
  await click(settings, '.settings-nav-button', '便签');
  await fill(settings, label('窗口字体'), 'Arial');
  await key(settings, 'Escape');
  assert.equal((await api(settings, 'getSettings')).notes.fontFamily, 'Microsoft YaHei', 'Escape must cancel font search');
  await fill(settings, label('字号'), 22);
  await click(settings, '.settings-nav-button', '通用');
  await click(settings, 'button', '亮色');
  await waitUntil(async () => (await api(settings, 'getSettings')).themeMode === 'light', 'light theme');
  await api(settings, 'setSetting', 'global', 'hideNotificationContent', true);
  await api(settings, 'setSetting', 'calendar', 'edgeAutoHide', false);
  await api(settings, 'setSetting', 'calendar', 'showDockArea', false);
  await waitUntil(async () => (await api(settings, 'getSettings')).calendar.showDockArea === false, 'dock visibility setting');
  await api(settings, 'setSetting', 'calendar', 'showDockArea', true);
  await click(settings, '.settings-nav-button', '标签管理');
  await waitUntil(() => settings.evaluate('return document.body.textContent.includes("QA 工作更新");'), 'tag manager sync');
  await click(settings, '.settings-nav-button', '便签管理');
  await waitUntil(() => settings.evaluate('return document.body.textContent.includes("QA 挂载后修改");'), 'note manager sync');
  assert.ok((await api(settings, 'getSystemFonts')).length > 0);
  const beforeInvalidChanges = await api(settings, 'getSettings');
  for (const [scope, settingKey, value] of [
    ['theme', 'themeMode', 'system'],
    ['global', 'globalFontFamily', '  '],
    ['calendar', 'backgroundColor', '#fff'],
    ['notes', 'textColor', 'red'],
    ['calendar', 'backgroundOpacity', 'invalid'],
    ['notes', 'edgeAutoHide', true],
    ['unknown', 'fontSize', 30],
  ]) {
    await api(settings, 'setSetting', scope, settingKey, value);
    assert.deepEqual(await api(settings, 'getSettings'), beforeInvalidChanges, `invalid setting must not change state: ${scope}.${settingKey}`);
  }
  console.log('PASS settings: global/window fonts, keyboard cancel, sizes, opacity, theme, privacy, dock, managers, fonts, invalid IPC rejection');
}

async function testReminder(session) {
  const cal = session.calendar;
  const due = new Date(Date.now() - 60_000);
  const startTime = `${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`;
  assert.equal((await api(cal, 'mutateEvent', { type: 'create', event: {
    id: 'qa_due', title: 'QA 到期提醒', startDate: dateKey(due), startTime, isAllDay: false,
    reminder: { enabled: true, minutesBefore: 0, playSound: false },
  } })).ok, true);
  const history = await waitUntil(async () => (await api(cal, 'getReminderHistory')).find((record) => record.eventId === 'qa_due'), 'due reminder', 20_000);
  assert.equal(await api(cal, 'markReminderHistoryRead', history.id), true);
  assert.equal((await api(cal, 'getReminderHistory')).find((record) => record.id === history.id).read, true);
  await click(cal, '[aria-label^="提醒记录"]');
  await waitUntil(() => cal.evaluate('return Boolean(document.querySelector("[role=dialog]"));'), 'reminder center');
  await key(cal, 'Escape');
  console.log('PASS reminders: due scan, durable history, read state, reminder center');
  return history.id;
}

async function testTrashAndDelete(session, ids) {
  const cal = session.calendar;
  assert.equal((await api(cal, 'deleteNote', ids.noteId)).ok, true);
  const trashed = (await api(cal, 'listDeletedNotes')).find((entry) => entry.noteId === ids.noteId);
  assert.ok(trashed);
  assert.equal((await api(cal, 'restoreDeletedNote', trashed.trashId)).ok, true);
  assert.equal((await loadNote(cal, ids.noteId)).items[0].content, 'QA 待办已编辑');
  assert.equal((await api(cal, 'deleteTag', 'qa_tag')).ok, true);
  assert.equal((await api(cal, 'getEventsState')).events.find((event) => event.id === ids.eventId).tagId, undefined);
  assert.equal((await api(cal, 'getNoteSummaries')).some((note) => note.id === ids.echoId), false);
  const echoTrash = (await api(cal, 'listDeletedNotes')).find((entry) => entry.noteId === ids.echoId);
  assert.ok(echoTrash);
  assert.equal((await api(cal, 'permanentlyDeleteNote', echoTrash.trashId)).ok, true);
  assert.equal((await api(cal, 'listDeletedNotes')).some((entry) => entry.trashId === echoTrash.trashId), false);
  await click(cal, '[aria-label^="打开事件：QA yearly"]');
  await click(cal, '[role="dialog"] button', '删除系列');
  await click(cal, '[role="alertdialog"] button', '取消');
  assert.equal((await api(cal, 'getEventsState')).events.some((event) => event.id === 'qa_yearly'), true);
  await click(cal, '[role="dialog"] button', '删除系列');
  await click(cal, '[role="alertdialog"] button', '删除整个系列');
  await waitUntil(async () => !(await api(cal, 'getEventsState')).events.some((event) => event.id === 'qa_yearly'), 'confirmed series deletion');
  console.log('PASS cleanup: trash/restore preserves content, tag removal unlinks events and trashes view, permanent deletion');
}

async function run() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oknote-feature-qa-'));
  fs.mkdirSync(path.join(dataDir, 'data'));
  fs.writeFileSync(path.join(dataDir, 'window-bounds.json'), JSON.stringify({ calendar: { x: 200, y: 100, width: 800, height: 700 } }));
  // Persisted checkpoint makes late-reminder recovery deterministic in a brand-new profile.
  fs.writeFileSync(path.join(dataDir, 'data', 'reminder-state.json'), JSON.stringify({ fired: {}, lastCheckedAt: new Date(Date.now() - 5 * 60_000).toISOString() }));
  let session;
  let keepOpen = false;
  try {
    session = await startSession(root, executable, dataDir);
    await testCalendarItemTypes(session);
    const eventId = await testEvents(session);
    await testCalendarNavigation(session);
    const noteId = await testNotes(session);
    const { dailyId, echoId } = await testDailyAndEcho(session);
    await testSettings(session);
    const reminderId = await testReminder(session);
    await testTrashAndDelete(session, { eventId, noteId, echoId });
    assert.deepEqual(session.errors, [], 'no uncaught renderer exceptions');
    await session.stop();
    session = await startSession(root, executable, dataDir);
    const cal = session.calendar;
    assert.equal((await loadNote(cal, noteId)).items[0].content, 'QA 待办已编辑');
    assert.equal((await loadNote(cal, dailyId)).items.find((item) => item.content === 'QA 每日内容').todoDate, today);
    const settings = await api(cal, 'getSettings');
    assert.equal(settings.themeMode, 'light');
    assert.equal(settings.calendar.fontFamily, 'Arial');
    assert.equal(settings.notes.fontSize, 22);
    assert.equal(settings.hideNotificationContent, true);
    assert.equal((await api(cal, 'getEventsState')).events.find((event) => event.id === eventId).title, 'QA 跨日循环事件');
    const history = await api(cal, 'getReminderHistory');
    assert.equal(history.filter((record) => record.eventId === 'qa_due').length, 1);
    assert.equal(history.find((record) => record.id === reminderId).read, true);
    assert.equal((await api(cal, 'getTags')).tags.length, 0);
    assert.deepEqual(session.errors, []);
    console.log('PASS restart: events, both note types, settings, deleted tags, reminder read/deduplication');
    keepOpen = process.env.OKNOTE_QA_KEEP_OPEN === '1';
    if (keepOpen) console.log(`QA_NATIVE_SESSION ${JSON.stringify({ dataDir, port: session.port })}`);
  } catch (error) {
    let uiState = '';
    try {
      uiState = await session.calendar.evaluate(`return JSON.stringify([...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].map(el => ({ text: el.textContent, rect: el.getBoundingClientRect().toJSON() })));`);
    } catch {}
    throw new Error(`${error.stack}\nActive dialogs: ${uiState}\n${session?.diagnostics() || ''}`);
  } finally {
    if (!keepOpen) {
      if (session) await session.stop();
      await delay(600);
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  }
  console.log(`Electron feature QA passed (8 functional groups + cold restart; ${keepOpen ? 'native inspection session retained' : 'clean teardown'}).`);
}

run().catch((error) => { console.error(error.message); process.exitCode = 1; });
