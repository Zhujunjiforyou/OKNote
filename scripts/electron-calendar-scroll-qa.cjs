// Real wheel input against an isolated profile; never reads the user's data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startSession, waitUntil, click, fill, key } = require('./lib/electron-qa-session.cjs');
const { delay } = require('./lib/electron-test-driver.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results/calendar-scroll');
const api = (page, name, ...args) => page.evaluate(`return window.electronAPI.${name}(${args.map(JSON.stringify).join(',')});`);
const cell = date => `[data-date="${date}"]`;

async function run() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'oknote-calendar-scroll-'));
  fs.mkdirSync(path.join(profile, 'data'));
  fs.mkdirSync(output, { recursive: true });
  const stamp = new Date().toISOString();
  const event = (id, startDate, extra = {}) => ({ id, title: `滚动验证 ${id}`, startDate, isAllDay: true, color: '#326991', createdAt: stamp, updatedAt: stamp, ...extra });
  fs.writeFileSync(path.join(profile, 'data/events.json'), JSON.stringify([
    ...Array.from({ length: 120 }, (_, i) => event(`dense_${i}`, '2026-09-25')),
    event('range', '2026-09-30', { endDate: '2026-10-03' }),
    event('recurring', '2026-10-02', { recurrence: { freq: 'weekly', interval: 1, byWeekday: [5] } }),
  ]));
  fs.writeFileSync(path.join(profile, 'window-bounds.json'), JSON.stringify({ calendar: { x: 50, y: 50, width: 1080, height: 780 } }));
  let session;
  const wheelInputs = [];
  try {
    session = await startSession(root, process.env.OKNOTE_ELECTRON_EXECUTABLE || require('electron'), profile);
    const page = session.calendar;
    await api(page, 'setSetting', 'calendar', 'edgeAutoHide', false);
    await page.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page.call('Emulation.setDeviceMetricsOverride', { width: 1080, height: 780, deviceScaleFactor: 1, mobile: false });
    const snapshot = () => page.evaluate(`
      const v = document.querySelector('.month-grid-body');
      return { top:v.scrollTop, height:v.clientHeight, row:parseFloat(document.querySelector('.month-grid').style.getPropertyValue('--calendar-week-height')),
        month:document.querySelector('.cal-month-title').textContent, summary:document.querySelector('.view-date-full')?.textContent,
        dates:[...document.querySelectorAll('[data-date]')].map(el => el.dataset.date) };
    `);
    const goMonth = async (year, month) => {
      await click(page, '.cal-month-title');
      await fill(page, 'input[aria-label="年份"]', String(year));
      await key(page, 'Enter');
      await click(page, '.calendar-date-picker button', `${month}月`);
      await waitUntil(async () => (await snapshot()).month === `${year}年${month}月`, 'month navigation');
      await delay(100);
    };
    const wheel = async (selector, deltaY, wait = 180) => {
      const point = await page.evaluate(`
        const el=document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('wheel target missing');
        const r=el.getBoundingClientRect(), v=document.querySelector('.month-grid-body').getBoundingClientRect(), h=document.querySelector('.calendar-grid-scroll').getBoundingClientRect();
        const left=Math.max(0,r.left,v.left,h.left), right=Math.min(innerWidth,r.right,v.right,h.right);
        const top=Math.max(0,r.top,v.top,h.top), bottom=Math.min(innerHeight,r.bottom,v.bottom,h.bottom);
        if(right<=left || bottom<=top) throw new Error('wheel target is outside the visible calendar: '+${JSON.stringify(selector)});
        for(const x of [(left+right)/2,left+Math.min(3,(right-left)/2),right-Math.min(3,(right-left)/2)]) {
          const y=top+Math.min(12,(bottom-top)/2), hit=document.elementFromPoint(x,y);
          if(hit && el.contains(hit) && !hit.closest('[inert]')) return {x,y,hit:{tag:hit.tagName,date:hit.closest('[data-date]')?.dataset.date,label:hit.getAttribute('aria-label')}};
        }
        throw new Error('wheel target is covered: '+${JSON.stringify(selector)});
      `);
      const { x, y, hit } = point;
      wheelInputs.push({ selector, deltaY, x, y, hit });
      await page.call('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
      await delay(wait);
    };
    const capture = async name => {
      if (process.env.OKNOTE_QA_CAPTURE !== '1') return;
      const shot = await page.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(output, `${name}.png`), Buffer.from(shot.data, 'base64'));
    };

    // Unlike the deterministic geometry checks below, exercise ordinary motion
    // with real wheel input and sample the visible position on every frame.
    await page.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await goMonth(2026, 9);
    await delay(350);
    const motionGeometry = await snapshot();
    const motionStart = motionGeometry.top;
    await page.evaluate(`document.querySelector('.month-grid').addEventListener('wheel',event=>{
      window.__motionInput={delta:event.deltaY,mode:event.deltaMode};
    },{once:true,capture:true});`);
    const sampling = page.evaluate(`return await new Promise(resolve => {
      const samples=[], start=performance.now(), v=document.querySelector('.month-grid-body');
      function sample(time) { samples.push({time:time-start,top:v.scrollTop}); if(time-start<550) requestAnimationFrame(sample); else resolve(samples); }
      requestAnimationFrame(sample);
    });`);
    await wheel(`${cell('2026-09-15')} .calendar-day-header`, 120);
    const samples = await sampling;
    const input = await page.evaluate('return window.__motionInput;');
    assert.equal(input.mode, 0);
    const snappedTarget = Math.round((motionStart + input.delta) / motionGeometry.row) * motionGeometry.row;
    fs.writeFileSync(path.join(output, 'motion.json'), JSON.stringify({ motionStart, input, snappedTarget, samples }, null, 2));
    const intermediate = samples.filter(sample => sample.top > motionStart + 1 && sample.top < motionStart + input.delta - 1);
    assert.ok(new Set(intermediate.map(sample => sample.top)).size >= 4, 'mouse notch moves through intermediate frames');
    assert.ok(Math.abs(samples.at(-1).top - snappedTarget) < 1, 'easing settles on the nearest complete week');
    assert.ok(samples.every((sample, i) => i === 0 || sample.top >= samples[i - 1].top - 0.7), 'one notch stays monotonic');
    const reverseStart = (await snapshot()).top;
    await wheel('.month-grid-body', 120);
    const reversePeak = (await snapshot()).top;
    await wheel('.month-grid-body', -120);
    await delay(350);
    const reverseEnd = (await snapshot()).top;
    assert.ok(reversePeak > reverseStart && reverseEnd < reversePeak - 100, 'reverse input cancels the old destination');
    assert.ok(Math.abs(reverseEnd / motionGeometry.row - Math.round(reverseEnd / motionGeometry.row)) < 0.01, 'reverse gesture also aligns a week');
    assert.ok(Math.abs(motionGeometry.height / motionGeometry.row - Math.round(motionGeometry.height / motionGeometry.row)) < 0.01, 'viewport fits complete weeks');
    const fineStart = (await snapshot()).top;
    for (let i = 0; i < 10; i++) await wheel('.month-grid-body', 10, 16);
    await delay(550);
    const fineEnd = (await snapshot()).top;
    assert.ok(fineEnd > fineStart + motionGeometry.row / 2, 'fine wheel input keeps accumulating during the gesture');
    assert.ok(Math.abs(fineEnd / motionGeometry.row - Math.round(fineEnd / motionGeometry.row)) < 0.01, 'fine gesture aligns after its final input');
    console.log('PASS smooth mouse motion: intermediate frames, coarse/fine week alignment and immediate reversal');
    await page.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

    await goMonth(2026, 9);
    await click(page, `${cell('2026-09-25')} .calendar-day-number`);
    const selected = await snapshot();
    assert.match(selected.summary, /9月25日/);
    const dense = `${cell('2026-09-25')} .day-event-list`;
    await wheel(dense, 120);
    assert.ok(await page.evaluate(`return document.querySelector(${JSON.stringify(dense)}).scrollTop > 0;`), 'dense list scrolls');
    assert.ok(Math.abs((await snapshot()).top - selected.top) < 1, 'inner wheel does not scroll calendar');
    await page.evaluate(`const el=document.querySelector(${JSON.stringify(dense)}); el.scrollTop=el.scrollHeight;`);
    await wheel(dense, 200);
    assert.ok(Math.abs((await snapshot()).top - selected.top) < 1, 'bottom boundary does not chain');
    await page.evaluate(`document.querySelector(${JSON.stringify(dense)}).scrollTop=0;`);
    await wheel(dense, -200);
    assert.ok(Math.abs((await snapshot()).top - selected.top) < 1, 'top boundary does not chain');
    await wheel(`${cell('2026-09-25')} .calendar-day-header`, selected.row * 3);
    await waitUntil(async () => (await snapshot()).month === '2026年10月', 'continuous month switch');
    const october = await snapshot();
    assert.equal(october.summary, selected.summary, 'scroll preserves selected date and summary');
    assert.equal(new Set(october.dates).size, october.dates.length, 'boundary week is not duplicated');
    assert.ok(october.dates.length <= 84, 'virtual DOM stays bounded');
    assert.ok(await page.evaluate(`return !document.querySelector('${cell('2026-10-01')}').hasAttribute('data-outside-month');`));
    assert.ok(await page.evaluate(`return document.querySelector('${cell('2026-09-30')}').hasAttribute('data-outside-month');`));
    await click(page, `${cell('2026-10-03')} .calendar-day-number`);
    assert.match((await snapshot()).summary, /10月3日/);
    await click(page, '[aria-label="下一个月"]');
    assert.equal((await snapshot()).month, '2026年11月');
    assert.match((await snapshot()).summary, /11月1日/);
    console.log('PASS continuous months, separate selection, nested real wheel input, spillover backgrounds, navigation');

    // Long jumps never create thousands of date elements or query years of recurrence.
    for (const [year, month] of [[1900, 1], [2024, 2], [2100, 12], [2026, 9]]) {
      await goMonth(year, month);
      const state = await snapshot();
      assert.ok(state.dates.length <= 84);
      if (year === 2024) assert.ok(state.dates.includes('2024-02-29'));
    }
    await click(page, `${cell('2026-09-25')} .calendar-day-number`);
    await click(page, `${cell('2026-09-25')} [role="button"]`);
    const beforeDialog = (await snapshot()).top;
    await wheel('[aria-labelledby="event-detail-title"]', 400);
    assert.equal((await snapshot()).top, beforeDialog, 'modal locks background scrolling');
    await key(page, 'Escape');

    for (const [theme, background] of [['light', '#f1f2f7'], ['dark', '#202020']]) {
      await api(page, 'setSetting', 'theme', 'themeMode', theme);
      await api(page, 'setSetting', 'calendar', 'backgroundColor', background);
      await goMonth(2026, 9);
      await click(page, `${cell('2026-09-25')} .calendar-day-number`);
      await capture(`desktop-${theme}`);
    }
    await api(page, 'setSetting', 'calendar', 'fontSize', 60);
    await page.call('Emulation.setDeviceMetricsOverride', { width: 344, height: 284, deviceScaleFactor: 1, mobile: false });
    await delay(250);
    await capture('compact-font60');
    const small = await snapshot();
    fs.writeFileSync(path.join(output, 'compact-state.json'), JSON.stringify(small, null, 2));
    assert.match(small.summary || '', /^$/); // Dock is hidden in the tiny layout.
    assert.ok(small.dates.length <= 42);
    await page.evaluate(`const el=document.querySelector('[data-date="2026-09-25"]'); el.focus(); el.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));`);
    await waitUntil(() => page.evaluate(`return document.activeElement?.dataset.date === '2026-10-02';`), 'keyboard navigation across virtual weeks');
    assert.match((await snapshot()).month, /9\/28.*10\/4/);
    await key(page, 'ArrowDown');
    await waitUntil(() => page.evaluate(`return document.activeElement?.dataset.date === '2026-10-09';`), 'next visible week');
    assert.ok(await page.evaluate(`return document.querySelector('[data-date="2026-10-05"] .calendar-day-meta [title="国庆节"]') !== null;`), 'visible week keeps its Monday holiday label after virtual buffering');
    assert.deepEqual(session.errors, [], 'no renderer exceptions');
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, october, small }, null, 2));
    console.log('PASS year limits, leap February, modal isolation, theme snapshots, tiny week layout and keyboard navigation');
  } finally {
    fs.writeFileSync(path.join(output, 'wheel-inputs.json'), JSON.stringify(wheelInputs, null, 2));
    if (session) await session.stop();
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(profile).startsWith('oknote-calendar-scroll-'));
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
