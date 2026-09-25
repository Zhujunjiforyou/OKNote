const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '../..');
(async () => {
  if(process.platform !== 'darwin') throw new Error('This runner requires macOS.');
  const manifest = require('../../package.json');
  const runtime = process.env.OKNOTE_QA_APP || path.join(root, 'release', manifest.version, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'OKNote.app');
  if(!fs.existsSync(runtime)) throw new Error('Build the Mac app first, or set OKNOTE_QA_APP to a packaged OKNote.app.');
  const entry = path.resolve(root, process.argv[2] || 'scripts/electron-macos-window-qa.cjs');
  if(!entry.startsWith(path.join(root,'scripts')+path.sep) || !fs.existsSync(entry)) throw new Error('QA entry must be a project script.');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'oknote-branded-window-qa-'));
  try {
    const app = path.join(temporary, 'OKNote.app');
    execFileSync('ditto', [runtime, app]);
    const fixture = path.join(temporary, 'fixture');
    fs.mkdirSync(fixture);
    fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({name:'oknote',productName:'OKNote',version:manifest.version,main:'index.cjs'}));
    fs.writeFileSync(path.join(fixture, 'index.cjs'), `require(${JSON.stringify(entry)});\n`);
    const resources = path.join(app, 'Contents/Resources');
    await asar.createPackage(fixture, path.join(resources, 'app.asar'));
    const native = path.join(resources, 'native/desktop-window.node');
    fs.copyFileSync(path.join(root, `build/native/darwin-${process.arch}/desktop-window.node`), native);
    execFileSync('codesign', ['--force','--sign','-',native], {stdio:'ignore'});
    execFileSync('codesign', ['--force','--sign','-','--preserve-metadata=entitlements',app], {stdio:'ignore'});
    const result = spawnSync(path.join(app, 'Contents/MacOS/OKNote'), [], {stdio:'inherit'});
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    fs.rmSync(temporary, {recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
