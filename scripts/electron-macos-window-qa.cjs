// Exercise real application windows without the background/occlusion switches
// used by the general feature suite. Never open the user's application profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (process.platform !== 'darwin') {
  console.log('SKIP macOS native window checks on this platform');
} else if (!process.versions.electron) {
  require('./build-macos-native.cjs').buildMacNative();
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(require('electron'), [__filename], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else {
  const { app, BrowserWindow, Menu, Tray } = require('electron');
  const root = path.join(__dirname, '..');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'oknote-mac-windows-'));
  process.env.OKNOTE_E2E_TEST = '1';
  process.env.OKNOTE_DATA_DIR = profile;
  app.setPath('userData', profile);
  const { getBinding } = require('../electron/macos-desktop-window.cjs');
  const results = [];
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(check, label) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const result = await check();
      if (result) return result;
      await delay(50);
    }
    throw new Error(`Timed out: ${label}`);
  }
  function checkDesktop(win, stage) {
    const state = getBinding().inspect(win.getNativeWindowHandle());
    assert.equal(state.collectionBehavior & (4 | 8), 0, `${stage}: no Managed/Transient conflict`);
    assert.equal(state.collectionBehavior & (1 | 16 | 64), 1 | 16 | 64, `${stage}: desktop behavior`);
    assert.equal(state.level, -1, `${stage}: below ordinary applications`);
    assert.equal(state.nonactivatingPanel, true, `${stage}: takes input without activating the application`);
    assert.equal(state.nativeNonactivatingPanel, true, `${stage}: AppKit routes keyboard input as a panel`);
    assert.equal(state.preventsActivationTag, true, `${stage}: WindowServer mouse activation is disabled`);
    assert.equal(win.isFocusable(), true, `${stage}: keyboard input remains available`);
    assert.equal(state.ignoresMouseEvents, false, `${stage}: receives its own mouse events`);
    assert.equal(state.width, win.getBounds().width, `${stage}: native input width follows window bounds`);
    assert.equal(state.height, win.getBounds().height, `${stage}: native input height follows window bounds`);
    assert.equal(win.webContents.backgroundThrottling, false);
    results.push({ stage, ...state });
  }
  async function run() {
    // Observe the production tray menu without replacing its command callbacks.
    let trayMenu;
    const setContextMenu = Tray.prototype.setContextMenu;
    Tray.prototype.setContextMenu = function(menu) {
      trayMenu = menu;
      return setContextMenu.call(this, menu);
    };
    try {
      require('../electron/main.cjs');
      await app.whenReady();
      await until(() => trayMenu, 'production tray menu');
    } finally {
      Tray.prototype.setContextMenu = setContextMenu;
    }
    const cal = await until(() => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('#/calendar')), 'calendar window');
    await until(async () => !cal.webContents.isLoading() && cal.webContents.executeJavaScript('Boolean(document.querySelector(".cal-month-title"))'), 'calendar render');
    assert.equal((await cal.webContents.executeJavaScript('window.electronAPI.getSettings()')).calendar.edgeAutoHide, false);
    checkDesktop(cal, 'calendar startup');
    const bounds = cal.getBounds();
    cal.setBounds({ ...bounds, width: bounds.width + 2 });
    cal.setBounds(bounds);
    cal.hide();
    cal.showInactive();
    cal.focus();
    checkDesktop(cal, 'calendar after resize/hide/show/focus');

    // Check programmatic focus separately from WindowServer mouse activation.
    // This does not simulate a physical click during the system's Show Desktop.
    app.hide();
    await until(() => {
      const state = getBinding().inspect(cal.getNativeWindowHandle());
      return state.applicationHidden && !state.keyWindow;
    }, 'application hidden');
    cal.showInactive();
    await until(() => !getBinding().inspect(cal.getNativeWindowHandle()).applicationHidden, 'application unhidden without activation');
    const frontmost = getBinding().inspect(cal.getNativeWindowHandle()).frontmostProcess;
    cal.show();
    cal.focus();
    await until(() => getBinding().inspect(cal.getNativeWindowHandle()).keyWindow, 'calendar keyboard focus');
    const focused = getBinding().inspect(cal.getNativeWindowHandle());
    assert.equal(focused.applicationActive, false, 'calendar focus must not activate the application');
    assert.equal(focused.frontmostProcess, frontmost, 'calendar preserves the foreground application');
    assert.equal(focused.keyWindow, true, 'calendar can receive keyboard input while the application is inactive');
    checkDesktop(cal, 'calendar input while application inactive');

    await cal.webContents.executeJavaScript('window.electronAPI.createNote({title:"窗口验证",isDocked:false})');
    const note = await until(() => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('#/note/')), 'independent note');
    await until(() => !note.webContents.isLoading(), 'note render');
    checkDesktop(note, 'independent note');
    const focusWithoutActivation = async (win, stage) => {
      const before = getBinding().inspect(win.getNativeWindowHandle()).frontmostProcess;
      win.show();
      win.focus();
      await until(() => getBinding().inspect(win.getNativeWindowHandle()).keyWindow, `${stage}: keyboard focus`);
      const state = getBinding().inspect(win.getNativeWindowHandle());
      assert.equal(state.applicationActive, false, `${stage}: application stays inactive`);
      assert.equal(state.frontmostProcess, before, `${stage}: foreground application is preserved`);
      checkDesktop(win, stage);
    };
    await focusWithoutActivation(note, 'independent note focus');
    await until(() => note.webContents.executeJavaScript('Boolean(document.querySelector("input[aria-label=\\"待办内容\\"]"))'), 'independent note input');
    await note.webContents.executeJavaScript('document.querySelector("input[aria-label=\\"待办内容\\"]").focus()');
    note.webContents.sendInputEvent({ type: 'char', keyCode: 'a' });
    await until(() => note.webContents.executeJavaScript('document.querySelector("input[aria-label=\\"待办内容\\"]").value === "a"'), 'independent note receives keyboard input');
    note.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    note.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    const noteId = note.webContents.getURL().split('#/note/')[1].split('/')[0];
    await until(() => cal.webContents.executeJavaScript(`window.electronAPI.loadNote(${JSON.stringify(noteId)}).then(note => note.items.some(item => item.content === 'a'))`), 'independent note input saved');
    const movedBounds = { ...note.getBounds(), x: 24, y: 90, width: 300, height: 360 };
    note.setBounds(movedBounds);
    assert.deepEqual(note.getBounds(), movedBounds);
    checkDesktop(note, 'independent note moved and resized outside calendar');

    const beforePreview = getBinding().inspect(cal.getNativeWindowHandle()).frontmostProcess;
    await cal.webContents.executeJavaScript('window.electronAPI.beginDockDragPreview({id:"qa_preview",title:"拖拽验证"}, 160, 160, "qa_drag", {left:0,top:0,right:600,bottom:600})');
    const preview = await until(() => BrowserWindow.getAllWindows().find(win => win.getTitle().includes('便签预览')), 'drag preview');
    const previewState = getBinding().inspect(preview.getNativeWindowHandle());
    assert.equal(previewState.nonactivatingPanel, true);
    assert.equal(previewState.nativeNonactivatingPanel, true);
    // Input-transparent previews cannot activate through a click. AppKit does
    // not retain the activation tag on this non-focusable window on macOS 26.
    assert.equal(previewState.ignoresMouseEvents, true, 'drag preview cannot intercept clicks');
    assert.equal(preview.isFocusable(), false, 'drag preview cannot take keyboard input');
    assert.equal(previewState.applicationActive, false);
    assert.equal(previewState.frontmostProcess, beforePreview);
    assert.equal(previewState.collectionBehavior & (4 | 8), 0);
    results.push({ stage: 'drag preview does not intercept input or activate', ...previewState });
    await cal.webContents.executeJavaScript('window.electronAPI.endDockDragPreview("qa_drag")');
    await until(() => preview.isDestroyed(), 'drag preview closed');

    // Closing a free window on docking must remove that input surface; undocking
    // creates a fresh independent panel at its own position, outside the calendar.
    await note.webContents.executeJavaScript(`window.electronAPI.loadNote(${JSON.stringify(noteId)}).then(note => window.electronAPI.dockNote(note.id, note))`).catch(error => {
      if (!note.isDestroyed()) throw error;
    });
    await until(() => note.isDestroyed(), 'docked note releases its old window');
    const undocked = await cal.webContents.executeJavaScript(`window.electronAPI.undockNoteAt(${JSON.stringify(noteId)}, 24, 90)`);
    assert.equal(undocked.ok, true);
    const free = await until(() => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes(`#/note/${noteId}`)), 'undocked independent note');
    await until(() => !free.webContents.isLoading(), 'undocked note render');
    assert.equal(free.getBounds().x, 24);
    assert.equal(free.getBounds().y, 90);
    await focusWithoutActivation(free, 'undocked note focus outside calendar');
    await focusWithoutActivation(cal, 'calendar focus after undocking');

    const beforeSettings = getBinding().inspect(cal.getNativeWindowHandle()).frontmostProcess;
    await cal.webContents.executeJavaScript('window.electronAPI.openSettings()');
    const settings = await until(() => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('#/settings')), 'settings window');
    const checkSettings = async stage => {
      await until(() => getBinding().inspect(settings.getNativeWindowHandle()).keyWindow, `${stage}: input focus`);
      const state = getBinding().inspect(settings.getNativeWindowHandle());
      assert.equal(state.level, 0, 'settings stays at ordinary application level, not desktop level');
      assert.equal(settings.isAlwaysOnTop(), false);
      assert.equal(state.nonactivatingPanel, true);
      assert.equal(state.nativeNonactivatingPanel, true);
      assert.equal(state.preventsActivationTag, true, 'settings mouse input must not end Show Desktop');
      assert.equal(state.frontmostProcess, beforeSettings, 'settings preserves the foreground application');
      assert.equal(state.applicationActive, false);
      results.push({stage,...state});
    };
    await checkSettings('settings first open');
    settings.hide();
    await cal.webContents.executeJavaScript('window.electronAPI.openSettings()');
    await checkSettings('settings reopen');
    const fonts = await settings.webContents.executeJavaScript('window.electronAPI.getSystemFonts()');
    assert.ok(fonts.length > 0, 'system font candidates are available');
    assert.deepEqual(fonts.filter(font => font.replace(/\p{Bidi_Control}/gu, '').trim().startsWith('.')), [], 'private fonts including bidi-wrapped names are excluded');
    results.push({stage:'public font candidates',count:fonts.length,passed:true});
    await until(() => settings.webContents.executeJavaScript('Boolean(document.querySelector("input[role=combobox]"))'), 'settings font input');
    await settings.webContents.executeJavaScript('document.querySelector("input[role=combobox]").focus()');
    await until(() => settings.webContents.executeJavaScript('document.querySelector("input[role=combobox]").getAttribute("aria-expanded") === "true" && document.querySelector("input[role=combobox]").value === ""'), 'settings font search ready');
    settings.webContents.sendInputEvent({type:'char',keyCode:'a'});
    await until(() => settings.webContents.executeJavaScript('document.querySelector("input[role=combobox]").value === "a"'), 'settings receives keyboard input');
    settings.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
    settings.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    // A background desktop window must process a new animation frame without
    // Page.bringToFront or Chromium command-line overrides.
    await Promise.race([
      cal.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => resolve(true)))'),
      delay(2000).then(() => { throw new Error('Desktop calendar stopped rendering in the background'); }),
    ]);
    checkDesktop(cal, 'calendar behind settings');
    // Explicit presentation survives key-focus changes between our own panels.
    const windowMenu = Menu.getApplicationMenu().items.find(item => item.label === '窗口');
    windowMenu.submenu.items.find(item => item.label === '显示日历').click();
    await until(() => cal.isFocused(), 'explicit calendar focus');
    const presented = getBinding().inspect(cal.getNativeWindowHandle());
    assert.equal(presented.level, 0, 'explicit calendar opens at ordinary application level');
    assert.equal(presented.preventsActivationTag, true, 'explicit presentation preserves nonactivating mouse behavior');
    results.push({stage:'explicit calendar presentation',...presented});
    // Replay the r2 Dock trace through the production activate/hide handlers.
    // These are synthetic events, not a substitute for clicking the real Dock.
    app.emit('activate', {}, true);
    settings.emit('hide');
    cal.emit('hide');
    cal.emit('focus');
    settings.emit('show');
    await delay(100);
    const afterOcclusion = getBinding().inspect(cal.getNativeWindowHandle());
    assert.equal(afterOcclusion.level, 0, 'occlusion hide must not cancel explicit calendar presentation');
    results.push({stage:'replayed Dock occlusion events',syntheticEvents:true,...afterOcclusion});
    free.show(); free.focus();
    await until(() => free.isFocused(), 'free note focus during presentation');
    settings.show(); settings.focus();
    await until(() => settings.isFocused(), 'settings focus during presentation');
    await delay(100);
    assert.equal(getBinding().inspect(cal.getNativeWindowHandle()).level, 0, 'own-panel focus must not hide the event calendar');
    app.hide();
    await until(() => getBinding().inspect(cal.getNativeWindowHandle()).level === -1, 'calendar returns to desktop when app is hidden');
    checkDesktop(cal, 'calendar restored after explicit presentation');
    settings.showInactive(); settings.focus();
    await until(() => settings.isFocused(), 'settings focus before close');
    const closeItem = Menu.getApplicationMenu().items.find(item => item.label === '文件').submenu.items.find(item => item.role === 'close');
    assert.equal(closeItem.accelerator, 'Command+W');
    Menu.sendActionToFirstResponder('performClose:');
    await until(() => settings.isDestroyed(), 'standard Close Window action closes settings');
    results.push({stage:'Command+W close role',passed:true});

    // Invoke actual command callbacks with another application in front. This
    // tests native activation, but is not a physical tray-menu click or screenshot.
    for (const [label, selector] of [
      ['新建事件', '#event-form-title'],
      ['提醒记录', '#reminder-center-title'],
      ['显示/隐藏日历', null],
    ]) {
      app.hide();
      await until(() => {
        const state = getBinding().inspect(cal.getNativeWindowHandle());
        return state.applicationHidden && state.frontmostProcess !== process.pid;
      }, `${label}: another application is foreground`);
      if (selector) {
        cal.showInactive();
        await until(() => {
          const state = getBinding().inspect(cal.getNativeWindowHandle());
          return !state.applicationHidden && state.frontmostProcess !== process.pid;
        }, `${label}: desktop calendar visible behind another application`);
      }
      trayMenu.items.find(item => item.label === label).click();
      const foreground = await until(() => {
        const state = getBinding().inspect(cal.getNativeWindowHandle());
        return !state.applicationHidden && state.frontmostProcess === process.pid && state.keyWindow && state;
      }, `${label}: OKNote becomes the foreground application`);
      assert.equal(foreground.level, 0, `${label}: calendar is at ordinary application level`);
      assert.equal(cal.isAlwaysOnTop(), false, `${label}: no permanent topmost window`);
      if (selector) {
        await until(() => cal.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), `${label}: dialog opens`);
        cal.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
        cal.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
        await until(() => cal.webContents.executeJavaScript(`!document.querySelector(${JSON.stringify(selector)})`), `${label}: empty dialog closes`);
      }
      results.push({stage:`tray callback: ${label}`,programmaticCallback:true,...foreground});
      app.hide();
      await until(() => getBinding().inspect(cal.getNativeWindowHandle()).level === -1, `${label}: hide returns calendar to desktop`);
    }

    const ordinary = new BrowserWindow({show:false});
    assert.throws(() => getBinding().configure(ordinary.getNativeWindowHandle()), /nonactivating panel/);
    ordinary.destroy();
    assert.throws(() => getBinding().configure(Buffer.alloc(8)), /no longer available/);
    assert.throws(() => getBinding().configure(Buffer.alloc(1)), /native window handle/);

    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    fs.writeFileSync(path.join(root, 'test-results', 'macos-window-qa.json'), JSON.stringify({
      version: require('../package.json').version, createdAt: new Date().toISOString(),
      arch: process.arch, electron: process.versions.electron, passed: true, specialChromiumSwitches: false, results,
    }, null, 2) + '\n');
    console.log('PASS native desktop and WindowServer activation flags, nonactivating focus/input, free notes, dock/undock, settings first/reopen/input/close, presentation across own-panel focus and app hide, tray callback application activation, and background rendering');
  }
  run().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
}
