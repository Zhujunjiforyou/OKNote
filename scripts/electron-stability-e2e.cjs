const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');
const executable = process.env.OKNOTE_ELECTRON_EXECUTABLE || (process.platform === 'win32'
  ? path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(root, 'node_modules', '.bin', 'electron'));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oknote-electron-e2e-'));
const appDataDir = path.join(dataDir, 'data');
const { delay, allocatePort, waitForPage, DevToolsClient, stopChild } = require('./lib/electron-test-driver.cjs');

async function run() {
  if (typeof WebSocket !== 'function') throw new Error('Node.js 22.12 or newer is required for the Electron E2E test');
  fs.mkdirSync(appDataDir, { recursive: true });
  const timestamp = '2026-08-30T00:00:00.000Z';
  const now = new Date();
  const currentDateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  fs.writeFileSync(path.join(appDataDir, 'note_note_e2e.json'), `${JSON.stringify({
    id: 'note_e2e',
    title: '挂载前',
    color: '#FDE047',
    noteType: 'independent',
    items: [],
    revision: 5,
    isHidden: true,
    isDocked: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(appDataDir, 'note_note_failure.json'), `${JSON.stringify({
    id: 'note_failure',
    title: '写入失败回滚',
    noteType: 'independent',
    items: [],
    revision: 2,
    isHidden: true,
    isDocked: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(appDataDir, 'note_daily_boundary.json'), `${JSON.stringify({
    id: 'daily_boundary',
    title: '日期边界待办',
    color: '#2563EB',
    noteType: 'daily',
    items: [],
    dailyTodo: { activeDate: '2100-12-31', lastResetDate: currentDateKey },
    revision: 1,
    isHidden: true,
    isDocked: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(appDataDir, 'note_echo_menu.json'), `${JSON.stringify({
    id: 'echo_menu',
    title: '小窗口菜单验证',
    color: '#7C3AED',
    noteType: 'echo',
    items: [],
    viewTagIds: ['tag_delete'],
    revision: 1,
    isHidden: false,
    isDocked: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(appDataDir, 'note_backup_only.json.bak'), `${JSON.stringify({
    id: 'backup_only',
    title: '仅备份便签',
    noteType: 'independent',
    items: [],
    revision: 3,
    isHidden: true,
    isDocked: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  }, null, 2)}\n`);
  const reminderHistoryPath = path.join(appDataDir, 'reminder-history.json');
  const reminderHistoryPrimary = `${JSON.stringify([{
    id: 'reminder_newer',
    eventId: 'event_newer',
    title: '保留的新提醒',
    startDate: '2026-08-30',
    firedAt: timestamp,
    read: false,
  }, null], null, 2)}\n`;
  const reminderHistoryBackup = `${JSON.stringify([{
    id: 'reminder_older',
    eventId: 'event_older',
    title: '完整备份提醒一',
    startDate: '2026-08-29',
    firedAt: timestamp,
    read: false,
  }, {
    id: 'reminder_oldest',
    eventId: 'event_oldest',
    title: '完整备份提醒二',
    startDate: '2026-08-28',
    firedAt: timestamp,
    read: false,
  }], null, 2)}\n`;
  fs.writeFileSync(reminderHistoryPath, reminderHistoryPrimary);
  fs.writeFileSync(`${reminderHistoryPath}.bak`, reminderHistoryBackup);
  fs.writeFileSync(path.join(appDataDir, 'tags.json'), '{"tags":[]}\n');
  fs.writeFileSync(path.join(appDataDir, 'tags.json.bak'), `${JSON.stringify([{
    id: 'tag_delete', name: '待删除标签', color: '#FDE047', createdAt: timestamp,
  }], null, 2)}\n`);
  fs.writeFileSync(path.join(appDataDir, 'events.json'), '{"events":[]}\n');
  fs.writeFileSync(path.join(appDataDir, 'events.json.bak'), `${JSON.stringify([{
    id: 'event_2100',
    title: '2100 年末边界',
    startDate: '2100-12-31',
    isAllDay: true,
    color: '#3b82f6',
    createdAt: timestamp,
    updatedAt: timestamp,
  }], null, 2)}\n`);
  fs.writeFileSync(path.join(dataDir, 'settings.json.bak'), '{"themeMode":"light","globalFontSize":14}\n');
  fs.writeFileSync(path.join(dataDir, 'window-bounds.json'), '[]\n');
  fs.writeFileSync(path.join(dataDir, 'window-bounds.json.bak'), '{}\n');

  const port = await allocatePort();
  let diagnostics = '';
  const child = spawn(executable, ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${dataDir}`], {
    cwd: root,
    env: { ...process.env, OKNOTE_DATA_DIR: dataDir, OKNOTE_E2E_TEST: '1', NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (chunk) => { diagnostics += chunk.toString(); });
  child.stderr.on('data', (chunk) => { diagnostics += chunk.toString(); });

  let client;
  let noteClient;
  let settingsClient;
  let dailyClient;
  try {
    const calendarPage = await waitForPage(port, '#/calendar');
    client = new DevToolsClient(calendarPage.webSocketDebuggerUrl);
    await client.connect();
    await client.evaluate(`
      const deadline = Date.now() + 10000;
      while (!window.electronAPI && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
      if (!window.electronAPI) throw new Error('preload API did not become ready');
      return true;
    `);

    const backupOnlyNote = await client.evaluate(`return await window.electronAPI.loadNote('backup_only');`);
    assert.equal(backupOnlyNote.title, '仅备份便签', 'a backup-only note must be discovered and restored');
    assert.equal(fs.existsSync(path.join(appDataDir, 'note_backup_only.json')), true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(appDataDir, 'events.json'), 'utf8'))[0].id, 'event_2100');
    assert.equal(JSON.parse(fs.readFileSync(path.join(appDataDir, 'tags.json'), 'utf8'))[0].id, 'tag_delete');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8')).themeMode, 'light');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'window-bounds.json'), 'utf8')), {});

    const history = await client.evaluate('return await window.electronAPI.getReminderHistory();');
    assert.equal(history.length, 1, 'a malformed reminder-history sibling must be isolated');
    assert.equal(history[0].id, 'reminder_newer');
    const blockedHistoryWrite = await client.evaluate(`return await window.electronAPI.markReminderHistoryRead('reminder_newer');`);
    assert.equal(blockedHistoryWrite, false, 'mixed-validity reminder history must remain read-only');
    assert.equal(fs.readFileSync(reminderHistoryPath, 'utf8'), reminderHistoryPrimary, 'degraded primary must remain untouched');
    assert.equal(fs.readFileSync(`${reminderHistoryPath}.bak`, 'utf8'), reminderHistoryBackup, 'the complete backup must remain untouched');
    const calendarText = await client.evaluate(`
      const deadline = Date.now() + 10000;
      while (!document.body.innerText.includes('今天') && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return document.body.innerText;
    `);
    assert.ok(calendarText.includes('今天'), 'calendar renderer must remain usable after reminder recovery');

    const menuTabFocus = await client.evaluate(`
      const trigger = document.querySelector('.cal-action-note[aria-haspopup="menu"]:not([aria-hidden="true"])')
        || document.querySelector('[aria-label="更多新建操作"]');
      if (!trigger) throw new Error('calendar menu trigger was not rendered');
      trigger.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const menu = document.querySelector('[role="menu"]');
      const firstItem = menu?.querySelector('[role="menuitem"]');
      if (!firstItem) throw new Error('calendar menu item was not rendered');
      firstItem.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Tab', code: 'Tab', bubbles: true, cancelable: true,
      }));
      await new Promise((resolve) => setTimeout(resolve, 80));
      return {
        menuClosed: !document.querySelector('[role="menu"]'),
        focusStayedInDocument: document.activeElement !== document.body && document.activeElement !== null,
      };
    `);
    assert.equal(menuTabFocus.menuClosed, true, 'Tab must close a titlebar menu');
    assert.equal(menuTabFocus.focusStayedInDocument, true, 'Tab must move focus instead of dropping it on body');

    const retainedEchoDraft = await client.evaluate(`
      const card = document.querySelector('[data-note-id="echo_menu"]');
      const createButton = [...(card?.querySelectorAll('button') || [])]
        .find((button) => button.textContent.trim() === '+ 新建事件');
      if (!createButton) throw new Error('Echo quick-event action was not rendered');
      createButton.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const titleInput = card.querySelector('[aria-label="事件标题"]');
      if (!titleInput) throw new Error('Echo quick-event title was not rendered');
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      valueSetter.call(titleInput, '保留挂载区的测试草稿');
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 80));
      return true;
    `);
    assert.equal(retainedEchoDraft, true);

    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 320,
      height: 240,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const compactPicker = await client.evaluate(`
      document.querySelector('.cal-month-title')?.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const dialog = document.querySelector('.calendar-date-picker');
      if (!dialog) throw new Error('date picker was not rendered at 320×240');
      const monthButtons = [...dialog.querySelectorAll('button')]
        .filter((button) => /月$/.test(button.textContent.trim()));
      dialog.scrollTop = dialog.scrollHeight;
      await new Promise((resolve) => setTimeout(resolve, 50));
      const lastMonth = monthButtons.at(-1);
      const dialogRect = dialog.getBoundingClientRect();
      const lastMonthRect = lastMonth?.getBoundingClientRect();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        dialogBottom: dialogRect.bottom,
        scrollable: dialog.scrollHeight > dialog.clientHeight,
        monthCount: monthButtons.length,
        lastMonthVisible: Boolean(lastMonthRect && lastMonthRect.top >= dialogRect.top && lastMonthRect.bottom <= dialogRect.bottom),
      };
    `);
    assert.deepEqual(compactPicker.viewport, { width: 320, height: 240 });
    assert.ok(compactPicker.dialogBottom <= 240, 'date picker must remain inside the compact viewport');
    assert.equal(compactPicker.scrollable, true, 'date picker must scroll when its content exceeds 320×240');
    assert.equal(compactPicker.monthCount, 12, 'all month actions must remain rendered');
    assert.equal(compactPicker.lastMonthVisible, true, 'December must be reachable by scrolling');
    const echoMenuPosition = await client.evaluate(`
      await new Promise((resolve) => setTimeout(resolve, 80));
      const card = document.querySelector('[data-note-id="echo_menu"]');
      const menuButton = card?.querySelector('[aria-label="打开便签菜单"]');
      if (!menuButton) throw new Error('Echo dock menu trigger was not rendered at 320×240');
      menuButton.click();
      const deadline = Date.now() + 2000;
      let menu;
      while (!(menu = document.querySelector('[role="menu"][aria-label="便签操作"]')) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (!menu) {
        throw new Error('Echo dock menu was not rendered; aria-expanded=' + menuButton.getAttribute('aria-expanded'));
      }
      const top = menu.getBoundingClientRect().top;
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      return { top, viewportHeight: window.innerHeight };
    `);
    assert.equal(echoMenuPosition.viewportHeight, 240);
    assert.ok(echoMenuPosition.top >= 8, `Echo dock menu top must stay inside the viewport, got ${echoMenuPosition.top}`);
    await client.call('Emulation.clearDeviceMetricsOverride');
    await client.evaluate(`
      const card = document.querySelector('[data-note-id="echo_menu"]');
      const titleInput = card?.querySelector('[aria-label="事件标题"]');
      if (titleInput) {
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        valueSetter.call(titleInput, '');
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 80));
        card.querySelector('[aria-label="关闭快速事件表单"]')?.click();
      }
      return true;
    `);

    const shownDaily = await client.evaluate(`return await window.electronAPI.showNote('daily_boundary');`);
    assert.equal(shownDaily.ok, true, 'daily note must open for boundary verification');
    const dailyPage = await waitForPage(port, '#/note/daily_boundary');
    dailyClient = new DevToolsClient(dailyPage.webSocketDebuggerUrl);
    await dailyClient.connect();
    const dailyBoundary = await dailyClient.evaluate(`
      const deadline = Date.now() + 10000;
      let dateButton;
      while (!(dateButton = document.querySelector('[title="点击输入日期"]')) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!dateButton) throw new Error('daily date button was not rendered');
      const nextButton = document.querySelector('[aria-label="已到支持范围上限"]');
      dateButton.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      let dateInput = document.querySelector('[aria-label="每日待办日期"]');
      if (!dateInput) throw new Error('daily date input was not rendered');
      const attributes = {
        min: dateInput.min,
        max: dateInput.max,
        nextDisabled: nextButton?.disabled === true,
      };
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      valueSetter.call(dateInput, '2101-01-01');
      dateInput.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 30));
      dateInput.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', bubbles: true, cancelable: true,
      }));
      await new Promise((resolve) => setTimeout(resolve, 80));
      dateButton = document.querySelector('[title="点击输入日期"]');
      dateButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 50));
      dateInput = document.querySelector('[aria-label="每日待办日期"]');
      return { ...attributes, valueAfterInvalidCommit: dateInput?.value };
    `);
    assert.deepEqual(dailyBoundary, {
      min: '1900-01-01',
      max: '2100-12-31',
      nextDisabled: true,
      valueAfterInvalidCommit: '2100-12-31',
    });
    await dailyClient.evaluate('window.electronAPI.closeWindow(); return true;');
    dailyClient.close();
    dailyClient = null;

    await client.evaluate('window.electronAPI.openSettings(); return true;');
    const settingsPage = await waitForPage(port, '#/settings');
    settingsClient = new DevToolsClient(settingsPage.webSocketDebuggerUrl);
    await settingsClient.connect();
    const settingsContrast = await settingsClient.evaluate(`
      const deadline = Date.now() + 10000;
      while (!document.querySelector('.settings-window') && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const background = document.querySelector('.settings-window-bg');
      if (!background) throw new Error('settings background was not rendered');
      const parseRgb = (value) => (value.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
      const luminance = (value) => {
        const [r, g, b] = parseRgb(value).map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratio = (foreground, surface) => {
        const first = luminance(foreground);
        const second = luminance(surface);
        return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
      };
      const surfaceColor = getComputedStyle(background).backgroundColor;
      const clickTab = async (label) => {
        const button = [...document.querySelectorAll('.settings-nav-button')]
          .find((candidate) => candidate.textContent.trim() === label);
        if (!button) throw new Error('settings tab not found: ' + label);
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 80));
      };
      await clickTab('便签管理');
      const noteTitle = [...document.querySelectorAll('.settings-content .text-xs.font-medium.truncate')]
        .find((candidate) => candidate.textContent.trim() === '挂载前');
      if (!noteTitle) throw new Error('yellow note title was not rendered in settings');
      const noteRatio = ratio(getComputedStyle(noteTitle).color, surfaceColor);
      await clickTab('标签管理');
      const tagTitle = [...document.querySelectorAll('.settings-content span')]
        .find((candidate) => candidate.textContent.trim() === '待删除标签');
      if (!tagTitle) throw new Error('yellow tag title was not rendered in settings');
      const tagRatio = ratio(getComputedStyle(tagTitle).color, surfaceColor);
      return { noteRatio, tagRatio };
    `);
    assert.ok(settingsContrast.noteRatio >= 4.5, `note title contrast must be readable, got ${settingsContrast.noteRatio}`);
    assert.ok(settingsContrast.tagRatio >= 4.5, `tag title contrast must be readable, got ${settingsContrast.tagRatio}`);

    const tagResult = await client.evaluate(`return await window.electronAPI.deleteTag('tag_delete');`);
    assert.equal(tagResult.ok, true, 'tag deletion must complete through IPC');
    const tagsPath = path.join(appDataDir, 'tags.json');
    const tagsBackupPath = `${tagsPath}.bak`;
    assert.deepEqual(JSON.parse(fs.readFileSync(tagsPath, 'utf8')), []);

    fs.writeFileSync(tagsPath, '{broken-primary');
    fs.writeFileSync(tagsBackupPath, '{broken-backup');
    const damagedTags = await client.evaluate('return await window.electronAPI.getTags();');
    assert.ok(damagedTags.loadError, 'damaged tags must enter an explicit read-only state');
    const blockedTagSave = await client.evaluate(`
      return await window.electronAPI.saveTag({ id: 'blocked_tag', name: '不应写入', color: '#3b82f6' });
    `);
    assert.equal(blockedTagSave.ok, false);
    assert.equal(fs.readFileSync(tagsPath, 'utf8'), '{broken-primary');
    assert.equal(fs.readFileSync(tagsBackupPath, 'utf8'), '{broken-backup');

    const shown = await client.evaluate(`return await window.electronAPI.showNote('note_e2e');`);
    assert.equal(shown.ok, true, 'show-note must return a persistence result');
    assert.equal(shown.note.revision, 6, 'show-note must return the committed revision');
    const notePage = await waitForPage(port, '#/note/note_e2e');
    noteClient = new DevToolsClient(notePage.webSocketDebuggerUrl);
    await noteClient.connect();
    await noteClient.evaluate(`
      const deadline = Date.now() + 10000;
      while (!window.electronAPI && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
      if (!window.electronAPI) throw new Error('note preload API did not become ready');
      return true;
    `);
    const imeResult = await noteClient.evaluate(`
      const deadline = Date.now() + 10000;
      let titleTrigger;
       while (!(titleTrigger = document.querySelector('.note-window-title[role="button"]')) && Date.now() < deadline) {
         await new Promise((resolve) => setTimeout(resolve, 50));
       }
       if (!titleTrigger) throw new Error('note title trigger was not rendered');
       titleTrigger.focus();
       const spacePrevented = !titleTrigger.dispatchEvent(new KeyboardEvent('keydown', {
         key: ' ', code: 'Space', bubbles: true, cancelable: true,
       }));
      let titleInput;
      while (!(titleInput = document.querySelector('[aria-label="编辑独立便签标题"]')) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!titleInput) throw new Error('note title input was not rendered');
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      valueSetter.call(titleInput, '中文候选词');
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
      titleInput.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, isComposing: true,
      }));
      await new Promise((resolve) => setTimeout(resolve, 150));
      const stillEditing = Boolean(document.querySelector('[aria-label="编辑独立便签标题"]'));
      if (stillEditing) {
        const input = document.querySelector('[aria-label="编辑独立便签标题"]');
        valueSetter.call(input, '挂载前');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 50));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      }
       return { stillEditing, spacePrevented };
     `);
    assert.equal(imeResult.stillEditing, true, 'IME candidate confirmation must not submit a note title');
    assert.equal(imeResult.spacePrevented, true, 'Space must activate title editing without scrolling');
    await noteClient.evaluate(`
      void window.electronAPI.dockNote('note_e2e', ${JSON.stringify(shown.note)});
      return true;
    `);
    const docked = await client.evaluate(`
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const notes = await window.electronAPI.getNotesState();
        const note = notes.find((candidate) => candidate.id === 'note_e2e' && candidate.isDocked === true);
        if (note) return { ok: true, note };
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return { ok: false, message: 'docked note did not reach the calendar state' };
    `);
    assert.equal(docked.ok, true, `dock-note must succeed: ${JSON.stringify(docked)}`);
    assert.equal(docked.note.revision, 7, 'dock-note must broadcast and return its committed revision');

    const dockedTitleKeyboard = await client.evaluate(`
      const card = document.querySelector('[data-note-id="note_e2e"]');
      const titleTrigger = card?.querySelector('[role="button"]');
      if (!titleTrigger) throw new Error('docked note title trigger was not rendered');
      titleTrigger.focus();
      const spacePrevented = !titleTrigger.dispatchEvent(new KeyboardEvent('keydown', {
        key: ' ', code: 'Space', bubbles: true, cancelable: true,
      }));
      await new Promise((resolve) => setTimeout(resolve, 80));
      const titleInput = card.querySelector('[aria-label="编辑挂载便签标题"]');
      const opened = Boolean(titleInput);
      titleInput?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      return { opened, spacePrevented };
    `);
    assert.deepEqual(dockedTitleKeyboard, { opened: true, spacePrevented: true });

    const edited = await client.evaluate(`
      return await window.electronAPI.saveNote('note_e2e', {
        ...${JSON.stringify(docked.note)},
        title: '挂载后立即编辑'
      });
    `);
    assert.equal(edited.ok, true, 'an immediate post-dock edit must not conflict');
    assert.equal(edited.note.revision, 8);
    const diskNote = JSON.parse(fs.readFileSync(path.join(appDataDir, 'note_note_e2e.json'), 'utf8'));
    assert.equal(diskNote.title, '挂载后立即编辑');
    assert.equal(diskNote.revision, 8);

    const yearBoundary = await client.evaluate(`
      document.querySelector('.cal-month-title')?.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const yearInput = document.querySelector('input[aria-label="年份"]');
      if (!yearInput) throw new Error('year input was not rendered');
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      valueSetter.call(yearInput, '2100');
      yearInput.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 80));
      const monthButton = [...document.querySelectorAll('[role="dialog"] button')]
        .find((button) => button.textContent.trim() === '12月');
      if (!monthButton) throw new Error('December picker button was not rendered');
      monthButton.click();
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const eventButton = document.querySelector('[aria-label^="打开事件：2100 年末边界"]');
        if (eventButton) {
          const overflowCells = [...document.querySelectorAll('[role="gridcell"]')]
            .filter((cell) => cell.getAttribute('aria-label')?.startsWith('2101年'));
          return {
            title: document.querySelector('.cal-month-title')?.textContent,
            hasEvent: true,
            nextDisabled: document.querySelector('.cal-chevron-right')?.disabled === true,
            overflowDisabled: overflowCells.length > 0
              && overflowCells.every((cell) => cell.getAttribute('aria-disabled') === 'true' && cell.tabIndex === -1),
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return { title: document.querySelector('.cal-month-title')?.textContent, hasEvent: false };
    `);
    assert.ok(yearBoundary.title.includes('2100'), 'calendar must navigate to year 2100');
    assert.equal(yearBoundary.hasEvent, true, 'the 2100-12-31 event must remain visible when the grid spills into 2101');
    assert.equal(yearBoundary.nextDisabled, true, 'the next-month button must be disabled at December 2100');
    assert.equal(yearBoundary.overflowDisabled, true, '2101 overflow dates must expose disabled, non-focusable semantics');

    const failurePath = path.join(appDataDir, 'note_note_failure.json');
    const preservedFailurePath = `${failurePath}.e2e-preserved`;
    fs.renameSync(failurePath, preservedFailurePath);
    fs.mkdirSync(failurePath);
    let failedShow;
    try {
      failedShow = await client.evaluate(`return await window.electronAPI.showNote('note_failure');`);
    } finally {
      fs.rmdirSync(failurePath);
      fs.renameSync(preservedFailurePath, failurePath);
    }
    assert.equal(failedShow.ok, false, 'show-note must report a disk failure instead of changing visible UI state');
    const failureNote = JSON.parse(fs.readFileSync(failurePath, 'utf8'));
    assert.equal(failureNote.isHidden, true);
    assert.equal(failureNote.revision, 2);

    console.log('  • Electron stability E2E passed: backup recovery and all critical window paths');
  } catch (error) {
    const tail = diagnostics.trim().slice(-4_000);
    throw new Error(`${error.message}${tail ? `\nElectron output:\n${tail}` : ''}`);
  } finally {
    if (client) {
      try { await client.evaluate('return await window.electronAPI.finishIsolatedTest();'); } catch {}
    }
    if (noteClient) noteClient.close();
    if (settingsClient) settingsClient.close();
    if (dailyClient) dailyClient.close();
    if (client) client.close();
    await stopChild(child);
    await delay(600);
  }
}

run().catch((error) => {
  console.error(`Electron stability E2E failed: ${error.message}`);
  process.exitCode = 1;
}).finally(() => {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  } catch (error) {
    console.warn(`Could not remove Electron E2E temp directory: ${error.message}`);
  }
});
