// Verifies the original dock geometry and navigation with synthetic data only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startSession, waitUntil, click, fill } = require('./lib/electron-qa-session.cjs');
const { delay } = require('./lib/electron-test-driver.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results/dock');
const api = (page, method, ...args) => page.evaluate(`return await window.electronAPI.${method}(${args.map(JSON.stringify).join(',')});`);
async function clickCandidate(page, selector) {
  await page.call('Page.bringToFront');
  // Only the exposed part of a perspective candidate is clickable; its center can sit behind a front card.
  const point = await waitUntil(() => page.evaluate(`
    const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null;
    const r = el.getBoundingClientRect();
    for (let x = Math.max(1,r.left + 4); x < Math.min(innerWidth,r.right)-4; x += 6)
      for (let y = Math.max(1,r.top+4); y < Math.min(innerHeight,r.bottom)-4; y += 10)
        if (el.contains(document.elementFromPoint(x,y))) return {x,y};
    return null;
  `), 'exposed perspective candidate');
  await page.call('Input.dispatchMouseEvent', {type:'mousePressed',...point,button:'left',clickCount:1});
  await page.call('Input.dispatchMouseEvent', {type:'mouseReleased',...point,button:'left',clickCount:1});
}
async function run() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'oknote-dock-restoration-'));
  const data = path.join(profile, 'data');
  fs.mkdirSync(data);
  fs.mkdirSync(output, { recursive: true });
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const stamp = now.toISOString();
  for (let i = 0; i < 6; i++) fs.writeFileSync(path.join(data, `note_dock_${i}.json`), JSON.stringify({
    id: `dock_${i}`, title: ['本周计划', '项目进展', '随手记', '阅读清单', '购物清单', '下周安排'][i],
    color: ['#FDE047','#BBF7D0','#BFDBFE','#FECDD3','#DDD6FE','#FED7AA'][i], noteType:'independent', isHidden:false, isDocked:true, dockedOrder:i,
    createdAt:stamp, updatedAt:stamp, items:Array.from({length:3}, (_,j) => ({id:`item_${i}_${j}`, noteId:`dock_${i}`, content:['整理会议纪要','核对方案细节','准备下次讨论'][j], isCompleted:false, sortOrder:j, ...(i === 0 && j === 0 ? {todoDate:today} : {})})),
  }));
  fs.writeFileSync(path.join(data, 'events.json'), JSON.stringify(Array.from({length:4}, (_,i) => ({
    id:`event_${i}`, title:['提交项目方案','沟通下一步安排','评审设计稿','整理进度反馈'][i], startDate:today, startTime:`${10+i}:00`, isAllDay:false, color:'#326991', createdAt:stamp, updatedAt:stamp,
  }))));
  let session;
  try {
    session = await startSession(root, process.env.OKNOTE_ELECTRON_EXECUTABLE || require('electron'), profile);
    const cal = session.calendar;
    await api(cal, 'setSetting', 'calendar', 'edgeAutoHide', false);
    await api(cal, 'setSetting', 'calendar', 'backgroundOpacity', 1);
    await api(cal, 'setSetting', 'calendar', 'fontSize', 14);
    await api(cal, 'setSetting', 'notes', 'fontSize', 14);
    await cal.evaluate('localStorage.setItem("oknote.calendarDockHeight", "220");');
    await cal.call('Page.reload');
    await waitUntil(() => cal.evaluate('return !!document.querySelector(".dock-peek-right");'), 'saved dock height and cards restored');
    const results = [];
    for (const [width,height] of [[1080,780],[700,620],[420,620],[344,284]]) {
      await cal.call('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:false});
      await delay(500);
      await cal.evaluate('await document.fonts.ready;');
      const geometry = await cal.evaluate(`
        const dock = document.querySelector('[data-dock-area]');
        const panel = document.querySelector('.view-note-panel');
        const rect = el => {const r = el.getBoundingClientRect(); return {width:r.width,height:r.height,top:r.top,bottom:r.bottom};};
        const list = panel?.lastElementChild;
        return { dock:dock ? rect(dock) : null, panel:panel ? rect(panel) : null, list:list ? rect(list) : null,
          main:rect(document.querySelector('.cal-main-content')),
          peeks:[...document.querySelectorAll('.dock-peek')].map(el => ({label:el.getAttribute('aria-label'),transform:getComputedStyle(el).transform})),
          perspective:document.querySelector('.dock-board') ? getComputedStyle(document.querySelector('.dock-board')).perspective : null,
          addedControls:document.querySelectorAll('.agenda-composer,.agenda-add-event,.dock-panel-switch,.dock-workspace').length,
          eventRows:panel?.querySelectorAll('.view-event-item').length || 0, todoRows:panel?.querySelectorAll('.view-todo-item').length || 0 };
      `);
      fs.writeFileSync(path.join(output, `geometry-${width}x${height}.json`), JSON.stringify(geometry,null,2));
      const shot = await cal.call('Page.captureScreenshot', {format:'png',captureBeyondViewport:false});
      fs.writeFileSync(path.join(output, `dock-${width}x${height}.png`), Buffer.from(shot.data,'base64'));
      assert.equal(geometry.addedControls, 0, 'unsolicited workspace and add controls are absent');
      if (width >= 400) {
        assert.equal(geometry.eventRows, 4);
        assert.equal(geometry.todoRows, 1);
        assert.ok(geometry.dock.height < 260, 'normal type uses the original dock height');
        assert.ok(geometry.list.height >= geometry.panel.height * .55, 'content retains the majority of the echo panel');
        assert.ok(geometry.peeks.length >= 1, 'side candidates are visible');
        assert.ok(geometry.peeks.every(peek => peek.transform.startsWith('matrix3d')), 'side candidates retain perspective');
        assert.equal(geometry.perspective, '820px');
      } else {
        assert.equal(geometry.dock, null, 'tiny windows preserve the original calendar space');
        assert.ok(geometry.main.height > height / 2);
      }
      results.push({width,height,...geometry});
    }
    await cal.call('Emulation.setDeviceMetricsOverride', {width:1080,height:780,deviceScaleFactor:1,mobile:false});
    await delay(200);
    const before = await cal.evaluate('return document.querySelector(".dock-main-strip").textContent;');
    await clickCandidate(cal, '.dock-peek-right');
    await waitUntil(() => cal.evaluate(`return document.querySelector('.dock-main-strip').textContent !== ${JSON.stringify(before)};`), 'right candidate advances the carousel');
    await delay(300);
    await clickCandidate(cal, '.dock-peek-left');
    await waitUntil(() => cal.evaluate(`return document.querySelector('.dock-main-strip').textContent === ${JSON.stringify(before)};`), 'left candidate restores the previous cards');
    const divider = '[role="separator"][aria-orientation="vertical"]';
    const panelWidth = () => cal.evaluate('return document.querySelector(".view-note-panel").offsetWidth;');
    const initialWidth = await panelWidth();
    const dragWidth = async delta => {
      const point = await cal.evaluate(`const r=document.querySelector(${JSON.stringify(divider)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};`);
      await cal.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
      await cal.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+delta,y:point.y,button:'left',buttons:1});
      await cal.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x+delta,y:point.y,button:'left',clickCount:1});
      await delay(120);
    };
    await dragWidth(140);
    const wide = initialWidth + 140;
    await waitUntil(async () => await panelWidth() === wide,'drag reallocates panel width');
    assert.equal(await cal.evaluate('return Number(localStorage.getItem("oknote.calendarSummaryWidth"));'),wide);
    assert.equal(await cal.evaluate('return document.body.classList.contains("resizing-dock-width");'),false);
    await cal.call('Emulation.setDeviceMetricsOverride',{width:420,height:620,deviceScaleFactor:1,mobile:false});
    await waitUntil(async () => await panelWidth() === 164,'narrow window keeps space for a usable note card');
    await click(cal,divider);
    assert.equal(await cal.evaluate('return Number(localStorage.getItem("oknote.calendarSummaryWidth"));'),wide,'clicking a constrained divider preserves the preferred width');
    await cal.call('Emulation.setDeviceMetricsOverride',{width:1080,height:780,deviceScaleFactor:1,mobile:false});
    await waitUntil(async () => await panelWidth() === wide,'wide window restores the preferred width');
    const widthKey = async key => {
      await cal.evaluate(`const el=document.querySelector(${JSON.stringify(divider)}); el.focus(); el.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true}));`);
      await delay(80);
    };
    await widthKey('ArrowLeft');
    assert.equal(await panelWidth(),wide-16,'keyboard resizes in the expected direction');
    await delay(300); // Wait for exiting carousel cards before choosing a live input.
    await cal.evaluate(`const input=[...document.querySelectorAll('.dock-main-strip input[aria-label="待办内容"]')].filter(el=>el.getClientRects().length && !el.closest('[aria-hidden="true"]')).at(-1); input.dataset.widthQa='true'; window.__widthQaInput=input;`);
    await fill(cal,'input[data-width-qa="true"]','调整宽度期间保留草稿');
    await delay(150);
    assert.equal(await cal.evaluate('return window.__widthQaInput.value;'),'调整宽度期间保留草稿');
    await dragWidth(1000);
    assert.equal(await panelWidth(),824,'maximum keeps 248px for the carousel');
    const contentRetained = () => cal.evaluate(`const saved=(await window.electronAPI.getNotesState()).flatMap(note=>note.items).filter(item=>item.content==='调整宽度期间保留草稿').length; return {saved,draft:window.__widthQaInput.isConnected && window.__widthQaInput.value==='调整宽度期间保留草稿'};`);
    await waitUntil(async () => {const state=await contentRetained();return state.draft || state.saved===1;},'shrinking carousel preserves input or its existing blur-save');
    await dragWidth(-1000);
    assert.equal(await panelWidth(),150,'minimum protects the summary');
    const retained=await contentRetained();
    assert.ok(retained.draft || retained.saved===1);
    assert.ok(retained.saved<=1,'resizing never duplicates the auto-saved item');
    await cal.evaluate(`const input=window.__widthQaInput; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,''); input.dispatchEvent(new Event('input',{bubbles:true}));`);
    await widthKey('ArrowRight');
    await api(cal,'setSetting','calendar','fontSize',28);
    await waitUntil(() => cal.evaluate('return Number.parseFloat(document.querySelector(".calendar-window").style.getPropertyValue("--calendar-requested-font-size")) === 28;'),'large font applied');
    assert.equal(await panelWidth(),166,'custom width overrides large-type defaults');
    await api(cal,'setSetting','calendar','fontSize',14);
    const resizedShot=await cal.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    fs.writeFileSync(path.join(output,'dock-width-adjusted.png'),Buffer.from(resizedShot.data,'base64'));
    await click(cal, '.view-note-panel [aria-label="完成事件：提交项目方案"]');
    await waitUntil(async () => (await api(cal,'getEventsState')).events.find(e=>e.id==='event_0').completion?.completed, 'completion remains functional in restored echo panel');
    assert.equal(await cal.evaluate('return !!document.querySelector(".view-note-panel .view-event-title.task-completed");'),true);
    assert.deepEqual(session.errors, []);
    await session.stop();
    session = await startSession(root,process.env.OKNOTE_ELECTRON_EXECUTABLE || require('electron'),profile);
    await session.calendar.call('Emulation.setDeviceMetricsOverride',{width:1080,height:780,deviceScaleFactor:1,mobile:false});
    await waitUntil(() => session.calendar.evaluate('return document.querySelector(".view-note-panel")?.offsetWidth === 166;'),'width survives a full application restart');
    const loopPage = session.calendar;
    const frontIds = () => loopPage.evaluate('return [...document.querySelectorAll(".dock-main-strip .dock-board-item:not([aria-hidden=true]) [data-note-id]")].map(el=>el.dataset.noteId);');
    for (const [count,width,capacity] of [[3,800,2],[2,420,1]]) {
      for (let i=count;i<6;i++) assert.ok((await api(loopPage,'hideNoteById',`dock_${i}`)).ok);
      await loopPage.call('Emulation.setDeviceMetricsOverride',{width,height:620,deviceScaleFactor:1,mobile:false});
      await waitUntil(async () => (await frontIds()).length===capacity,'front cards settle after changing capacity');
      assert.equal(await loopPage.evaluate('return document.querySelectorAll(".dock-peek").length;'),2,`${count} notes with ${capacity} front cards must show both candidates`);
      let start=Number((await frontIds())[0].slice(5));
      for (const direction of [-1,1]) for (let step=0;step<count+1;step++) {
        await clickCandidate(loopPage,direction<0?'.dock-peek-left':'.dock-peek-right');
        start=(start+direction+count)%count;
        const expected=Array.from({length:capacity},(_,i)=>`dock_${(start+i)%count}`);
        await waitUntil(async () => JSON.stringify(await frontIds())===JSON.stringify(expected),'candidate click wraps through the first and last note');
        assert.equal(await loopPage.evaluate('return document.querySelectorAll(".dock-peek").length;'),2,'neither direction disappears after rotating');
      }
      const shot=await loopPage.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      fs.writeFileSync(path.join(output,`circular-${count}-notes.png`),Buffer.from(shot.data,'base64'));
    }
    assert.deepEqual(session.errors, []);
    fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({passed:true,checkedAt:new Date().toISOString(),geometry:results},null,2));
    console.log('PASS restored 3D candidates and bidirectional switching; compact echo, original dock sizing, no added controls, and preserved event completion.');
    console.log('PASS width divider: pointer and keyboard, viewport clamping, saved preference, input preservation, large type and cold restart.');
    console.log('PASS circular candidates: 2 notes/1 front card and 3 notes/2 front cards retain both sides through repeated backward and forward wraps.');
  } finally {
    if (session) await session.stop();
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(profile).startsWith('oknote-dock-restoration-'));
    fs.rmSync(profile, {recursive:true,force:true,maxRetries:20,retryDelay:250});
  }
}
run().catch(error => {console.error(error); process.exitCode=1;});
