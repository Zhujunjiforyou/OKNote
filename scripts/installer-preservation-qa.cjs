// Exercises the production NSIS hooks without touching the real installation,
// its registry key, shortcuts or user profile. Requires a local NSIS compiler.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const sourceRoot = path.resolve(__dirname, '..');
const compiler = process.env.OKNOTE_MAKENSIS;
if (!compiler) throw new Error('Set OKNOTE_MAKENSIS to a local makensis.exe');

for (const existingTarget of [false, true]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oknote-installer-compat-'));
  assert.equal(path.dirname(root), os.tmpdir());
  assert.ok(path.basename(root).startsWith('oknote-installer-compat-'));
  try {
    const old = path.join(root, 'old-install', 'user-data');
    const current = path.join(root, 'new-install', 'user-data');
    const documents = ['settings.json.bak', 'window-bounds.json.bak', 'Local State',
      'data/events.json', 'data/events.json.bak', 'data/note_old.json', 'data/.trash/trash_old.json'];
    for (const name of documents) {
      const file = path.join(old, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `old:${name}:中文`);
      if (existingTarget) {
        const target = path.join(current, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, `current:${name}:中文`);
      }
    }
    const build = spawnSync(compiler, ['/V2', `/DTEST_ROOT=${root}`, `/DTEST_ID=${randomUUID()}`,
      `/DSOURCE_ROOT=${sourceRoot}`, path.join(__dirname, 'fixtures', 'installer-preservation-test.nsi')],
    { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    assert.equal(build.status, 0, `Compile failed: ${build.stdout}\n${build.stderr}`);
    const run = spawnSync(path.join(root, 'preserve-test.exe'), [], { windowsHide: true, timeout: 30_000 });
    assert.equal(run.status, 0, `NSIS upgrade failed: ${run.error?.message || run.status}`);
    assert.equal(fs.existsSync(path.join(root, 'old-install')), false);
    const backups = fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()
      && entry.name !== 'new-install').map(entry => path.join(root, entry.name, 'user-data'));
    for (const name of documents) {
      assert.equal(fs.readFileSync(path.join(current, name), 'utf8'), `${existingTarget ? 'current' : 'old'}:${name}:中文`);
      assert.ok(backups.some(dir => fs.existsSync(path.join(dir, name))
        && fs.readFileSync(path.join(dir, name), 'utf8') === `old:${name}:中文`), 'original backup must survive the uninstaller');
    }
    console.log(`PASS installer compatibility: old directory removed, ${existingTarget ? 'existing destination unchanged' : 'changed install path restored'}, originals retained`);
    fs.rmSync(root, { recursive: true, force: true });
  } catch (error) {
    console.error(`Isolated installer diagnostics retained: ${root}`);
    throw error;
  }
}
