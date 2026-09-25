const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const { startSession, waitUntil, click, fill, key } = require(path.join(root, 'scripts/lib/electron-qa-session.cjs'));
const { delay } = require(path.join(root, 'scripts/lib/electron-test-driver.cjs'));
const output = path.join(root, 'test-results/compact-layout');
const api = (page, name, ...args) => page.evaluate(`return await window.electronAPI.${name}(${args.map(value => JSON.stringify(value)).join(',')});`);

async function run() {
  fs.mkdirSync(output, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oknote-compact-'));
  let session;
  const results = [];
  try {
    session = await startSession(root, process.env.OKNOTE_ELECTRON_EXECUTABLE || require(path.join(root, 'node_modules/electron')), dataDir);
    const cal = session.calendar;
    await api(cal, 'setSetting', 'calendar', 'edgeAutoHide', false);
    await click(cal, '.cal-month-title');
    await fill(cal, 'input[aria-label="年份"]', '2026');
    await key(cal, 'Enter');
    await click(cal, '.calendar-date-picker button', '9月');
    for (let index = 0; index < 120; index++) {
      const result = await api(cal, 'mutateEvent', { type: 'create', event: {
        id: `compact-event-${index}`, title: `检查小窗口里的事项 ${index + 1}`, startDate: '2026-09-25', isAllDay: true, color: '#326991',
      } });
      assert.ok(result.ok);
    }
    await cal.evaluate(`document.querySelector('[role="gridcell"][aria-label^="2026年9月25日"]')?.click();`);
    for (const fontSize of [14, 28, 40, 60]) {
      await api(cal, 'setSetting', 'calendar', 'fontSize', fontSize);
      await waitUntil(() => cal.evaluate(`return Number.parseFloat(document.querySelector('.calendar-window').style.getPropertyValue('--calendar-requested-font-size')) === ${fontSize};`), 'font applied');
      for (const [width, height] of [[344, 284], [420, 620], [1080, 780]]) {
        await cal.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        await delay(200);
        await cal.evaluate('await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));');
        const geometry = await cal.evaluate(`
          const box = el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; };
          const sample = el => ({ text:el.textContent.trim(), label:el.getAttribute('aria-label'), box:box(el), display:getComputedStyle(el).display });
          const cell = [...document.querySelectorAll('[role="gridcell"]')].find(el => el.getAttribute('aria-label')?.startsWith('2026年9月25日'));
          const badge = cell.querySelector('.daily-calendar-chip');
          const b = badge.getBoundingClientRect();
          const visibleControls = [...document.querySelectorAll('.cal-titlebar button')].filter(el => el.getClientRects().length && !el.closest('[aria-hidden="true"]'));
          return { titlebar:box(document.querySelector('.cal-titlebar')), controls:visibleControls.map(sample), viewport:box(document.querySelector('.calendar-grid-scroll')), cell:box(cell), dayNumber:box(cell.querySelector('.calendar-day-number')), badge:box(badge), badgeLabel:badge.getAttribute('aria-label'), badgeHit:badge.contains(document.elementFromPoint(b.left+b.width/2,b.top+b.height/2)), dayHeader:box(cell.firstElementChild) };
        `);
        const name = `verified-${width}x${height}-font${fontSize}`;
        const shot = await cal.call('Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
        fs.writeFileSync(path.join(output, `${name}.png`), Buffer.from(shot.data,'base64'));
        results.push({ name, fontSize, width, height, ...geometry });
        fs.writeFileSync(path.join(output, 'verified.json'), JSON.stringify(results,null,2));
        const middle = box => box.y + box.height / 2;
        assert.ok(Math.abs(middle(geometry.dayNumber) - middle(geometry.badge)) < 1, `${name}: date and count share one row`);
        assert.ok(geometry.dayNumber.right <= geometry.badge.x + 1, `${name}: date and count do not overlap`);
        assert.ok(geometry.badge.right <= geometry.cell.right - 1, `${name}: three-digit count fits its cell`);
        assert.match(geometry.badgeLabel, /共 120 个未完成项/);
        assert.ok(geometry.badgeHit, `${name}: count remains visible and clickable after resizing`);
        assert.ok(geometry.dayHeader.y >= geometry.viewport.y - 1, `${name}: selected date header remains visible`);
        for (const [index, control] of geometry.controls.entries()) {
          assert.ok(control.box.x >= 0 && control.box.right <= width + 1, `${name}: toolbar control stays in viewport`);
          for (const other of geometry.controls.slice(index + 1)) {
            const overlapWidth = Math.min(control.box.right, other.box.right) - Math.max(control.box.x, other.box.x);
            const overlapHeight = Math.min(control.box.bottom, other.box.bottom) - Math.max(control.box.y, other.box.y);
            assert.ok(overlapWidth < 1 || overlapHeight < 1, `${name}: toolbar controls do not collide (${control.text || control.label}, ${other.text || other.label})`);
          }
        }
      }
    }
    await cal.call('Emulation.setDeviceMetricsOverride', { width:344, height:284, deviceScaleFactor:1, mobile:false });
    await delay(200);
    await cal.evaluate(`
      const cell = document.querySelector('[role="gridcell"][aria-selected="true"]');
      cell.focus();
      cell.dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowRight', bubbles:true }));
    `);
    await delay(100);
    await cal.evaluate(`
      document.querySelector('[role="gridcell"][aria-selected="true"]').dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowRight', bubbles:true }));
    `);
    await delay(100);
    const selected = await cal.evaluate(`
      const cell = document.querySelector('[role="gridcell"][aria-selected="true"]');
      const rect = cell.getBoundingClientRect();
      return { label:cell.getAttribute('aria-label'), left:rect.left, right:rect.right, width:innerWidth };
    `);
    assert.match(selected.label, /^2026年9月27日/);
    assert.ok(selected.left >= 0 && selected.right <= selected.width + 1, 'keyboard selection reveals the end of the week');
    await cal.evaluate(`document.querySelector('[role="gridcell"][aria-label^="2026年9月25日"]')?.click();`);
    await delay(100);
    await click(cal, '.daily-calendar-chip[aria-label^="打开 2026-09-25"]');
    const daily = await waitUntil(async () => (await api(cal, 'getNotesState')).find(note => note.noteType === 'daily' && note.dailyTodo?.activeDate === '2026-09-25'), 'compact count opens the correct daily note date');
    const dailyPage = await session.page(`#/note/${daily.id}`);
    await waitUntil(() => dailyPage.evaluate('return document.querySelectorAll(".daily-recurring-item").length === 120;'), 'daily note includes all counted events');
    console.log(`PASS compact layout: ${results.length} viewport/font combinations, three-digit counts, toolbar collision checks, selected-date visibility and count click.`);
  } finally {
    if (session) await session.stop();
    assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('oknote-compact-'));
    fs.rmSync(dataDir, { recursive:true, force:true, maxRetries:3, retryDelay:100 });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
