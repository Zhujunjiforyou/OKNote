// Real renderer + main-process drag lifecycle tests with isolated note data.
// Native button/cursor state is controlled so lost mouseup is reproducible.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
if (!process.versions.electron) {
  if (process.platform === 'darwin') require('./build-macos-native.cjs').buildMacNative();
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {stdio:'inherit'});
  process.exitCode = result.status ?? 1;
} else {
  const { app, BrowserWindow, screen, dialog } = require('electron');
  const root = path.resolve(__dirname, '..');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'oknote-dock-drag-'));
  const data = path.join(profile, 'data');
  fs.mkdirSync(data);
  const stamp = new Date().toISOString();
  const note = {id:'drag_qa',title:'周末买点东西',color:'#F6E7AF',noteType:'independent',isDocked:true,isHidden:false,dockedOrder:0,createdAt:stamp,updatedAt:stamp,
    items:[{id:'item_qa',noteId:'drag_qa',content:'鸡蛋和牛奶',isCompleted:false,sortOrder:0}]};
  fs.writeFileSync(path.join(data,'note_drag_qa.json'),JSON.stringify(note));
  fs.writeFileSync(path.join(profile,'window-bounds.json'),JSON.stringify({calendar:{x:400,y:70,width:1000,height:760}}));
  process.env.OKNOTE_E2E_TEST='1'; process.env.OKNOTE_DATA_DIR=profile; process.env.NODE_ENV='production';
  app.setPath('userData',profile);
  let down = true, cursor = {x:600,y:600};
  if (process.platform === 'darwin') {
    const mac = require('../electron/macos-desktop-window.cjs');
    const binding = mac.getBinding();
    mac.getBinding = () => ({configure:binding.configure,inspect:binding.inspect,isPrimaryMouseButtonDown:()=>down});
  }
  const results=[];
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function until(fn,label) {
    const deadline=Date.now()+7000;
    while(Date.now()<deadline){const result=await fn();if(result)return result;await delay(20)}
    throw Error('Timed out: '+label);
  }
  const previews=()=>BrowserWindow.getAllWindows().filter(w=>w.getTitle().includes('便签预览'));
  const stored=()=>JSON.parse(fs.readFileSync(path.join(data,'note_drag_qa.json'),'utf8'));
  let cal;
  const js=code=>Promise.race([cal.webContents.executeJavaScript(code),delay(5000).then(()=>{throw Error('Renderer evaluation timed out: '+code.slice(0,120))})]);
  async function mouse(type,x,y,held=type!=='mouseReleased') {
    cursor={x:cal.getBounds().x+x,y:cal.getBounds().y+y};
    await cal.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',buttons:held?1:0,clickCount:type==='mouseMoved'?0:1});
  }
  async function ready() {
    await until(()=>js('!!document.querySelector(".docked-note-card[data-note-id=drag_qa]")'),'docked card');
    await js(`window.__dragPointer=0;document.addEventListener('pointerdown',e=>window.__dragPointer=e.pointerId,{once:true});`);
  }
  async function start() {
    down=true;
    await ready();
    const point=await js(`(()=>{
      const card=document.querySelector('.docked-note-card[data-note-id=drag_qa]');const header=card.firstElementChild;const r=header.getBoundingClientRect();
      for(let x=r.left+8;x<r.right-8;x+=6){const y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);if(header.contains(hit)&&!hit.closest('button,input,textarea,[data-no-card-drag]'))return{x,y};}
      throw Error('No exposed drag handle');
    })()`);
    await mouse('mousePressed',point.x,point.y);
    await mouse('mouseMoved',point.x+20,point.y+6);
    await until(()=>previews().length===1,'drag preview opens');
    assert.equal(await js('!!document.querySelector(".docked-note-card-dragging")'),true);
    return {x:point.x+20,y:point.y+6};
  }
  async function clean(label, docked=true) {
    await until(()=>previews().length===0,label+': preview closed');
    await until(()=>js('!document.querySelector(".docked-note-card-dragging")'),label+': pointer state cleared');
    assert.equal(stored().isDocked,docked,label+': expected dock state');
    assert.deepEqual(stored().items,note.items,label+': original content preserved');
    results.push(label); console.log('PASS '+label);
  }
  async function release(point) { await mouse('mouseReleased',point.x,point.y,false); }
  async function run() {
    require('../electron/main.cjs'); await app.whenReady();
    // This replacement is local to this test process, never the user's cursor.
    screen.getCursorScreenPoint=()=>({...cursor});
    cal=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#/calendar')),'calendar');
    await until(()=>!cal.webContents.isLoading()&&js('!!document.querySelector(".cal-month-title")'),'calendar rendered');
    cal.webContents.debugger.attach('1.3');
    await js(`window.electronAPI.setSetting('calendar','edgeAutoHide',false);localStorage.setItem('oknote.calendarDockHeight','260');`);
    cal.webContents.reload();
    await delay(200); await ready();
    cal.showInactive(); cal.focus();

    let p=await start(); await release(p); await clean('release halfway inside dock');
    p=await start();
    await js(`window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:window.__dragPointer,bubbles:true}));`);
    await release(p); await clean('pointercancel retains docked note');
    p=await start();
    await js(`document.querySelector('.docked-note-card[data-note-id=drag_qa]').firstElementChild.releasePointerCapture(window.__dragPointer);`);
    await mouse('mouseMoved',p.x+2,p.y+2); await release(p); await clean('lost pointer capture cancels drag');
    p=await start();
    await cal.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await release(p); await clean('Escape cancels drag');
    p=await start(); await js(`window.dispatchEvent(new Event('blur'));`); await release(p); await clean('window blur cancels drag');
    p=await start(); await js(`window.electronAPI.setSetting('calendar','showDockArea',false);`); await clean('unmount removes preview'); await release(p);
    await js(`window.electronAPI.setSetting('calendar','showDockArea',true);`); await ready();
    p=await start(); cal.hide(); await clean('hidden owner removes preview'); await release(p); cal.showInactive(); cal.focus();
    p=await start(); cal.webContents.reload(); await delay(200); await clean('renderer reload removes preview'); await ready();

    // A confirmation may cancel the undock. Its preview must already be gone.
    let prompts=0;
    const originalPrompt=dialog.showMessageBoxSync;
    dialog.showMessageBoxSync=()=>{prompts++;assert.equal(previews().length,0,'preview removed before confirmation');return 0};
    await js(`window.electronAPI.setWindowDraftState([{key:'drag_qa:new',kind:'new-todo',noteId:'drag_qa'}]);`);
    await delay(50); p=await start(); await mouse('mouseReleased',p.x,50,false);
    await until(()=>prompts===1,'draft confirmation'); await clean('canceling draft confirmation retains note and clears preview');
    await js('window.electronAPI.setWindowDraftState([])'); await delay(50); dialog.showMessageBoxSync=originalPrompt;

    // No final pointermove: release location must decide the drop.
    p=await start(); await mouse('mouseReleased',p.x,50,false);
    await until(()=>stored().isDocked===false,'outside release creates free note'); await clean('release outside without final move undocks once',false);
    let free=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('#/note/drag_qa')),'free note');
    await until(()=>!free.webContents.isLoading(),'free renderer');
    void free.webContents.executeJavaScript(`window.electronAPI.loadNote('drag_qa').then(n=>window.electronAPI.dockNote('drag_qa',n))`).catch(()=>{}); await until(()=>free.isDestroyed(),'free note docks and closes'); await ready();

    if(process.platform==='darwin') {
      // Deliberately omit renderer mouseup. The main process observes release.
      p=await start(); cursor={x:cal.getBounds().x+p.x,y:cal.getBounds().y+40}; down=false;
      await until(()=>stored().isDocked===false,'native release fallback'); await clean('native release with missing renderer mouseup clears preview and undocks',false);
      await release(p);
      free=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('#/note/drag_qa')),'recovered free note');
      await until(()=>!free.webContents.isLoading(),'recovered free renderer');
      void free.webContents.executeJavaScript(`window.electronAPI.loadNote('drag_qa').then(n=>window.electronAPI.dockNote('drag_qa',n))`).catch(()=>{}); await until(()=>free.isDestroyed(),'free note docks and closes'); await ready();
    }

    down=true;
    await js(`window.electronAPI.beginDockDragPreview({id:'drag_qa',title:'旧拖动'},600,600,'old_drag',{left:400,top:400,right:1000,bottom:800});window.electronAPI.beginDockDragPreview({id:'drag_qa',title:'新拖动'},600,600,'new_drag',{left:400,top:400,right:1000,bottom:800});window.electronAPI.endDockDragPreview('old_drag');`);
    await until(()=>previews().length===1,'new drag survives old cleanup');
    await delay(200); assert.equal(previews().length,1);
    await js(`window.electronAPI.endDockDragPreview('new_drag')`); await clean('stale drag cleanup cannot close a newer preview');
    p=await start(); await release(p); await clean('subsequent drag remains usable');
    await start(); cal.destroy(); await until(()=>previews().length===0,'closing owner removes preview');
    assert.deepEqual(stored().items,note.items); results.push('closing owner removes preview without losing note contents');
    fs.writeFileSync(path.join(root,'test-results/dock-drag-qa.json'),JSON.stringify({passed:true,createdAt:new Date().toISOString(),platform:process.platform,controlledNativeButtonState:true,results},null,2)+'\n');
    console.log('PASS '+results.length+' dock drag lifecycle scenarios');
  }
  run().then(()=>app.exit(0),error=>{
    down=false;
    console.error(error);
    app.exit(1);
  });
}
