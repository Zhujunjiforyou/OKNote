const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const executable = process.env.OKNOTE_ELECTRON_EXECUTABLE || (process.platform === 'win32'
  ? path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(root, 'node_modules', '.bin', 'electron'));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oknote-electron-smoke-'));
const readyMarker = path.join(dataDir, '.smoke-ready');

async function run() {
  let diagnostics = '';
  let exitInfo = null;
  const child = spawn(executable, ['.', '--hidden', `--user-data-dir=${dataDir}`], {
    cwd: root,
    env: { ...process.env, OKNOTE_DATA_DIR: dataDir, OKNOTE_SMOKE_TEST: '1', NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (chunk) => { diagnostics += chunk.toString(); });
  child.stderr.on('data', (chunk) => { diagnostics += chunk.toString(); });
  child.once('exit', (code, signal) => { exitInfo = { code, signal }; });
  const deadline = Date.now() + 20_000;
  while (!fs.existsSync(readyMarker) && Date.now() < deadline) {
    if (exitInfo) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!fs.existsSync(readyMarker)) {
    const exitDescription = exitInfo ? `, exit ${exitInfo.code ?? exitInfo.signal}` : '';
    const diagnosticTail = diagnostics.trim().slice(-4_000);
    console.error(`Electron smoke test did not reach ready state (pid ${child.pid || 'unknown'}${exitDescription}).${diagnosticTail ? `\n${diagnosticTail}` : ''}`);
    try { child.kill(); } catch { /* ignore */ }
    process.exitCode = 1;
    return;
  }
  console.log('  • Electron main process reached ready state and shut down cleanly');
  await new Promise((resolve) => setTimeout(resolve, 600));
}

run().catch((error) => {
  console.error(`Electron smoke test failed: ${error.message}`);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});
