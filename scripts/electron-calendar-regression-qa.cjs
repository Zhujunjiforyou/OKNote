// Rebuild current source into an isolated app. No installed app or user data is touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startSession, waitUntil, fill, key } = require('./lib/electron-qa-session.cjs');
const { delay } = require('./lib/electron-test-driver.cjs');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results/calendar-regression');
const api = (page, name, ...args) => page.evaluate(`return window.electronAPI.${name}(${args.map(JSON.stringify).join(',')});`);

async function buildIsolatedApp(stage) {
  const { build } = await import('vite');
  fs.cpSync(path.join(root, 'electron'), path.join(stage, 'electron'), { recursive: true });
  fs.cpSync(path.join(root, 'build/icons'), path.join(stage, 'build/icons'), { recursive: true });
  fs.copyFileSync(path.join(root, 'package.json'), path.join(stage, 'package.json'));
  await build({
    root,
    logLevel: 'warn',
    plugins: [{
      name: 'calendar-regression-diagnostics',
      transform(code, id) {
        if (path.resolve(id.split('?')[0]) !== path.join(root, 'src/main.tsx')) return null;
        // This diagnostic exists only in this temporary QA bundle. It never
        // ships in dist or changes a production component/store interface.
        return `${code}\nimport { useCalendarStore as qaStore } from './stores/calendar.store';\nwindow.__calendarQa = qaStore;`;
      },
    }],
    build: { outDir: path.join(stage, 'dist'), emptyOutDir: true },
  });
}

async function run() {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'oknote-calendar-regression-app-'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'oknote-calendar-regression-data-'));
  const evidence = { passed: false, inputs: [], scenarios: {} };
  fs.mkdirSync(path.join(profile, 'data'));
  fs.mkdirSync(output, { recursive: true });
  const stamp = '2026-10-02T12:00:00.000Z';
  const events = [{
    id: 'daily-buffer', title: '缓冲日期 Tab 回归', startDate: '2026-09-01',
    isAllDay: true, color: '#326991', recurrence: { freq: 'daily', interval: 1 },
    createdAt: stamp, updatedAt: stamp,
  }, {
    id: 'sync-delete', title: '同步删除详情回归', startDate: '2026-10-03',
    isAllDay: true, color: '#326991', createdAt: stamp, updatedAt: stamp,
  }, ...Array.from({ length: 120 }, (_, index) => ({
    id: `dense-${index}`, title: `格内中断 ${index}`, startDate: '2026-10-16',
    isAllDay: true, color: '#326991', createdAt: stamp, updatedAt: stamp,
  }))];
  fs.writeFileSync(path.join(profile, 'data/events.json'), JSON.stringify(events));
  fs.writeFileSync(path.join(profile, 'window-bounds.json'), JSON.stringify({ calendar: { x: 50, y: 50, width: 1080, height: 780 } }));
  let session;
  let diagnostic;
  try {
    evidence.sourceBuildAt = new Date().toISOString();
    await buildIsolatedApp(stage);
    session = await startSession(stage, process.env.OKNOTE_ELECTRON_EXECUTABLE || require('electron'), profile);
    const page = session.calendar;
    // A renderer-only clock makes the midnight assertion independent of wall
    // time; performance.now and the OS/main-process clock keep running normally.
    await page.evaluate(`
      const RealDate = Date;
      window.__qaNow = new RealDate(2026, 9, 2, 23, 59, 55).getTime();
      window.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [window.__qaNow])); }
        static now() { return window.__qaNow; }
      };
      window.dispatchEvent(new Event('focus'));
      if (new Date().getTime() !== window.__qaNow) throw new Error('renderer-only Date override did not install');
    `);
    await waitUntil(() => page.evaluate('return Boolean(window.__calendarQa && document.querySelector(".month-grid-body"));'), 'diagnostic bundle ready');
    await api(page, 'setSetting', 'calendar', 'edgeAutoHide', false);
    await page.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

    const resize = async (width, height) => {
      await page.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await delay(250);
    };
    const snapshot = () => page.evaluate(`
      const store = window.__calendarQa.getState(), v = document.querySelector('.month-grid-body');
      const horizontal = document.querySelector('.calendar-grid-scroll');
      const dateKey = date => [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
      const active = document.activeElement, bounds = v.getBoundingClientRect(), clipped = horizontal.getBoundingClientRect();
      const rect = active?.getBoundingClientRect();
      return {
        top: v.scrollTop, left: horizontal.scrollLeft, row: parseFloat(document.querySelector('.month-grid').style.getPropertyValue('--calendar-week-height')),
        height: v.clientHeight, month: document.querySelector('.cal-month-title').textContent,
        mode: document.querySelector('.month-grid').getAttribute('aria-label'), summary: document.querySelector('.view-date-full')?.textContent,
        currentDate: dateKey(store.currentDate), browseDate: dateKey(store.browseDate), followToday: store.followToday,
        selectedEventId: store.selectedEventId, selectedEventOccurrenceDate: store.selectedEventOccurrenceDate,
        detail: document.querySelector('#event-detail-title')?.textContent || null,
        active: { tag: active?.tagName, label: active?.getAttribute('aria-label'), date: active?.closest('[data-date]')?.dataset.date,
          visible: !!rect && Math.min(rect.right, bounds.right, clipped.right, innerWidth) > Math.max(rect.left, bounds.left, clipped.left, 0)
            && Math.min(rect.bottom, bounds.bottom, clipped.bottom, innerHeight) > Math.max(rect.top, bounds.top, clipped.top, 0) },
      };
    `);
    diagnostic = () => page.evaluate(`
      const state=window.__calendarQa.getState();
      return { now: new Date().toString(), fakeNow:window.__qaNow, followToday:state.followToday,
        currentDate:state.currentDate.toString(), browseDate:state.browseDate.toString(),
        selectedEventId:state.selectedEventId, summary:document.querySelector('.view-date-full')?.textContent,
        today:[...document.querySelectorAll('.calendar-day-number.bg-primary')].map(el=>el.closest('[data-date]').dataset.date),
        visibility:document.visibilityState, focus:document.hasFocus() };
    `);
    const targetPoint = async (selector, text) => {
      // Reject offscreen centers and unexpected hit targets. Do not reveal a
      // control with scrollIntoView or clamp its coordinates into the viewport.
      const point = await waitUntil(() => page.evaluate(`
        const candidates = [...document.querySelectorAll(${JSON.stringify(selector)})];
        for (const el of candidates) {
          if (el.closest('[aria-hidden="true"]') || !el.getClientRects().length
            || (${JSON.stringify(text)} !== undefined && el.textContent.trim() !== ${JSON.stringify(text)})) continue;
          const r = el.getBoundingClientRect(), x = r.left+r.width/2, y = r.top+r.height/2;
          if (x <= 0 || x >= innerWidth || y <= 0 || y >= innerHeight) continue;
          const hit = document.elementFromPoint(x,y);
          if (!hit || !el.contains(hit)) continue;
          return { x, y, hit: { tag: hit.tagName, className: hit.getAttribute('class'), label: hit.getAttribute('aria-label'),
            date: hit.closest('[data-date]')?.dataset.date, text: hit.textContent.trim().slice(0,100) } };
        }
        return null;
      `), `visible input target: ${selector}${text ? ` / ${text}` : ''}`, 3000);
      assert.ok(point, `visible input target missing: ${selector}${text ? ` / ${text}` : ''}`);
      return point;
    };
    const clickVisible = async (selector, text) => {
      await page.call('Page.bringToFront');
      const point = await targetPoint(selector, text);
      evidence.inputs.push({ kind: 'click', selector, text, ...point });
      const { x, y } = point;
      await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      await delay(80);
    };
    const wheelVisible = async (selector, deltaX, deltaY, wait = 350) => {
      await page.call('Page.bringToFront');
      const point = await targetPoint(selector);
      const input = { kind: 'wheel', selector, deltaX, deltaY, ...point };
      evidence.inputs.push(input);
      await page.evaluate(`
        window.__qaWheel = null;
        document.addEventListener('wheel', event => {
          const hit=event.target;
          window.__qaWheel={trusted:event.isTrusted,selectorMatch:!!hit.closest(${JSON.stringify(selector)}),
            deltaX:event.deltaX,deltaY:event.deltaY,tag:hit.tagName,label:hit.getAttribute('aria-label'),
            date:hit.closest('[data-date]')?.dataset.date,text:hit.textContent.trim().slice(0,100)};
        },{capture:true,once:true});
      `);
      const { x, y } = point;
      await page.call('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY });
      await delay(wait);
      input.actual = await page.evaluate('return window.__qaWheel;');
      assert.ok(input.actual?.trusted && input.actual.selectorMatch, `real wheel hit the requested target: ${selector}`);
    };
    const goMonth = async (year, month) => {
      await clickVisible('.cal-month-title');
      await fill(page, 'input[aria-label="年份"]', String(year));
      await key(page, 'Enter');
      await clickVisible('.calendar-date-picker button', `${month}月`);
      await waitUntil(async () => (await snapshot()).month === `${year}年${month}月`, 'month navigation');
      await delay(250);
    };

    await resize(1080, 780);
    await goMonth(2026, 10);
    await page.evaluate('document.querySelector(".month-grid").focus({preventScroll:true});');
    const beforeTab = await snapshot();
    await key(page, 'Tab');
    const afterTab = await snapshot();
    evidence.scenarios.tab = { before: beforeTab, after: afterTab };
    evidence.inputs.push({ kind: 'key', key: 'Tab', active: afterTab.active });
    assert.ok(afterTab.active.date, 'Tab enters a calendar date control');
    assert.ok(afterTab.active.visible, 'Tab does not stop in an offscreen buffer row or column');
    assert.ok(Math.abs(afterTab.top - beforeTab.top) < 1, 'Tab does not pull the viewport back to buffered dates');
    assert.equal(afterTab.month, '2026年10月', 'Tab preserves the correctly aligned October heading');
    assert.equal(afterTab.currentDate, beforeTab.currentDate, 'Tab itself does not change selection');
    console.log('PASS real Tab enters visible dates without buffer scroll or stale heading');

    await api(page, 'setSetting', 'calendar', 'fontSize', 60);
    await resize(420, 620);
    await goMonth(2026, 10);
    await page.evaluate('document.querySelector(".calendar-grid-scroll").scrollLeft=0;');
    // The first October week is 9/28-10/4. A real tiny wheel marks this as
    // browsing while settling on that same row, rather than spoofing a scroll event.
    await wheelVisible('[role="columnheader"]', 0, 1);
    const visibleAreas = () => page.evaluate(`
      const v=document.querySelector('.month-grid-body').getBoundingClientRect(), h=document.querySelector('.calendar-grid-scroll').getBoundingClientRect();
      const clip={left:Math.max(0,v.left,h.left),right:Math.min(innerWidth,v.right,h.right),top:Math.max(0,v.top,h.top),bottom:Math.min(innerHeight,v.bottom,h.bottom)};
      const areas={}, cells=[];
      for(const el of document.querySelectorAll('[data-date]')) {
        const r=el.getBoundingClientRect(), area=Math.max(0,Math.min(r.right,clip.right)-Math.max(r.left,clip.left))*Math.max(0,Math.min(r.bottom,clip.bottom)-Math.max(r.top,clip.top));
        if(!area) continue;
        const month=el.dataset.date.slice(0,7); areas[month]=(areas[month]||0)+area; cells.push({date:el.dataset.date,area});
      }
      const total=Object.values(areas).reduce((a,b)=>a+b,0);
      return {areas,total,cells};
    `);
    const leftAreas = await visibleAreas(), leftState = await snapshot();
    assert.ok(leftAreas.areas['2026-09'] > leftAreas.total * 0.55, 'left columns visibly belong mostly to September');
    assert.equal(leftState.month, '2026年9月', 'clipped-out October columns do not influence the left-column heading');
    await wheelVisible('.calendar-grid-scroll', 2400, 0);
    const rightAreas = await visibleAreas(), rightState = await snapshot();
    evidence.scenarios.horizontal = { left: { ...leftState, ...leftAreas }, right: { ...rightState, ...rightAreas } };
    assert.ok(rightState.left > leftState.left + 10, 'real horizontal wheel moves the date columns');
    assert.ok(rightAreas.areas['2026-10'] > rightAreas.total * 0.55, 'right columns visibly belong mostly to October');
    assert.equal(rightState.month, '2026年10月', 'horizontal browsing refreshes the actual-area month heading');
    assert.equal(rightState.currentDate, leftState.currentDate, 'horizontal browsing preserves selection');
    console.log('PASS actual clipped date-cell area controls the month and updates on horizontal wheel');

    await api(page, 'setSetting', 'calendar', 'fontSize', 14);
    await resize(1080, 780);
    await clickVisible('.cal-left-actions .cal-action-today');
    const beforeResize = await snapshot();
    assert.ok(beforeResize.followToday);
    assert.equal(beforeResize.currentDate, '2026-10-02');
    await resize(360, 300);
    const weekState = await snapshot();
    assert.equal(weekState.mode, '周日历');
    assert.ok(weekState.followToday, 'responsive week mode preserves Today follow');
    await resize(1080, 780);
    const monthState = await snapshot();
    assert.equal(monthState.mode, '月日历');
    assert.ok(monthState.followToday, 'restoring month mode preserves Today follow');
    evidence.scenarios.today = { beforeResize, weekState, monthState };
    await page.evaluate('window.__qaNow=new Date(2026,9,3,0,0,1).getTime(); window.dispatchEvent(new Event("focus"));');
    await waitUntil(async () => (await snapshot()).currentDate === '2026-10-03', 'Today selection follows renderer midnight');
    const afterMidnight = await snapshot();
    evidence.scenarios.today = { beforeResize, weekState, monthState, afterMidnight };
    assert.ok(afterMidnight.followToday);
    assert.match(afterMidnight.summary, /10月3日/, 'lower-left summary follows midnight too');
    assert.ok(await page.evaluate('return document.querySelector("[data-date=\\"2026-10-03\\"] .calendar-day-number")?.classList.contains("bg-primary");'), 'today marker advances to October 3');
    console.log('PASS Today follow survives responsive modes and selection/summary advance at renderer midnight');

    await goMonth(2026, 10);
    await clickVisible('[data-date="2026-10-03"] [aria-label="打开事件：同步删除详情回归"]');
    await waitUntil(async () => (await snapshot()).detail === '同步删除详情回归', 'event detail opens');
    const lockedState = await snapshot();
    await wheelVisible('[aria-labelledby="event-detail-title"]', 0, 400);
    assert.ok(Math.abs((await snapshot()).top - lockedState.top) < 1, 'open detail locks the background');
    const deletion = await api(page, 'mutateEvent', { type: 'delete', id: 'sync-delete' });
    assert.ok(deletion.ok, 'direct IPC deletion succeeds in the isolated profile');
    await waitUntil(async () => !(await snapshot()).detail, 'synchronized event disappearance closes detail');
    const unlockedState = await snapshot();
    assert.equal(unlockedState.selectedEventId, null, 'synchronized deletion clears stale event selection');
    assert.equal(unlockedState.selectedEventOccurrenceDate, null, 'synchronized deletion clears stale occurrence');
    await wheelVisible('[role="columnheader"]', 0, 400);
    const afterDeleteWheel = await snapshot();
    evidence.scenarios.syncDelete = { lockedState, unlockedState, afterDeleteWheel };
    assert.ok(afterDeleteWheel.top > unlockedState.top + 100, 'calendar scrolling resumes after synchronized deletion');
    await key(page, 'Escape');
    console.log('PASS external IPC deletion clears detail selection and restores calendar wheel scrolling');

    // Interrupt an ordinary coarse-wheel animation with genuine inner-list
    // input and with a picker overlay. Both interruptions must settle again
    // after their blocking condition ends; inner scrolling itself stays free.
    await page.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await api(page, 'setSetting', 'calendar', 'fontSize', 30);
    await delay(250);
    const aligned = state => Math.abs(state.top / state.row - Math.round(state.top / state.row)) < 0.01;
    const beginPartialWheel = async () => {
      await goMonth(2026, 10);
      const before = await waitUntil(async () => {
        const state = await snapshot();
        return aligned(state) ? state : null;
      }, 'navigation settles before the interrupting wheel');
      await wheelVisible('[role="columnheader"]', 0, 40, 16);
      const partial = await waitUntil(async () => {
        const state = await snapshot();
        return state.top > before.top + 2 && !aligned(state) ? state : null;
      }, 'ordinary animation reaches a partial week', 1000);
      return { before, partial };
    };
    const innerMotion = await beginPartialWheel();
    const denseSelector = '[data-date="2026-10-16"] .day-event-list';
    const innerBefore = await page.evaluate(`return document.querySelector(${JSON.stringify(denseSelector)}).scrollTop;`);
    await wheelVisible(denseSelector, 0, 120, 550);
    const innerAfter = await page.evaluate(`return document.querySelector(${JSON.stringify(denseSelector)}).scrollTop;`);
    const settledInner = await snapshot();
    evidence.scenarios.interruption = { inner: { ...innerMotion, innerBefore, innerAfter, settled: settledInner } };
    assert.ok(innerAfter > innerBefore, 'real inner wheel still scrolls dense events');
    assert.ok(aligned(settledInner), 'outer week alignment resumes after inner input cancels the animation');
    const overlayMotion = await beginPartialWheel();
    await clickVisible('.cal-month-title');
    const overlayOpen = await snapshot();
    assert.ok(await page.evaluate('return Boolean(document.querySelector(".calendar-date-picker"));'), 'month picker opens during the animation');
    await delay(220);
    assert.ok(Math.abs((await snapshot()).top - overlayOpen.top) < 1, 'picker holds the interrupted background still');
    await key(page, 'Escape');
    await waitUntil(() => page.evaluate('return !document.querySelector(".calendar-date-picker");'), 'month picker closes');
    await delay(550);
    const settledOverlay = await snapshot();
    evidence.scenarios.interruption.overlay = { ...overlayMotion, overlayOpen, settled: settledOverlay };
    assert.ok(aligned(settledOverlay), 'outer week alignment resumes after the overlay closes');
    assert.deepEqual(session.errors, [], 'no renderer exceptions');
    evidence.passed = true;
    console.log('PASS normal-motion interruption by inner wheel and picker restores week alignment');
  } catch (error) {
    evidence.error = error.stack || String(error);
    if (diagnostic) { try { evidence.failureState = await diagnostic(); } catch {} }
    throw error;
  } finally {
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(evidence, null, 2));
    if (session) await session.stop();
    for (const [directory, prefix] of [[profile, 'oknote-calendar-regression-data-'], [stage, 'oknote-calendar-regression-app-']]) {
      assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
      assert.ok(path.basename(directory).startsWith(prefix));
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
