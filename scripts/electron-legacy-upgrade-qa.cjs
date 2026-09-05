// Test startup against real OS-backed old-format files; never modifies source profiles.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startSession } = require('./lib/electron-qa-session.cjs');
const { stopChild } = require('./lib/electron-test-driver.cjs');
const { getNoteRevision } = require('../electron/note-persistence.cjs');
const root = path.join(__dirname, '..');
const runtime = process.env.OKNOTE_LEGACY_FIXTURE_ELECTRON || process.env.OKNOTE_ELECTRON_EXECUTABLE
  || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const executable = process.env.OKNOTE_ELECTRON_EXECUTABLE || runtime;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'oknote-legacy-upgrade-'));
const source = process.env.OKNOTE_UPGRADE_SOURCE_PROFILE;
const api = (client, method, ...args) => client.evaluate(`return await window.electronAPI.${method}(${args.map(arg => JSON.stringify(arg)).join(',')});`);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const omit = (value, keys) => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
function assertOldSettingsRetained(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) assertOldSettingsRetained(actual[key], value);
    else assert.deepEqual(actual[key], value, `old setting ${key} must be retained`);
  }
}

async function prepare() {
  if (source) {
    for (const name of ['Local State', 'data', 'settings.json', 'settings.json.bak', 'window-bounds.json', 'window-bounds.json.bak', 'Local Storage']) {
      const from = path.join(source, name);
      if (fs.existsSync(from)) fs.cpSync(from, path.join(profile, name), { recursive: true });
    }
  }
  const child = spawn(runtime, [path.join(__dirname, 'lib', 'legacy-profile-fixture.cjs'), profile,
    ...(source ? ['--inspect-existing'] : process.argv.includes('--plain') ? ['--plain'] : [])],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let diagnostics = '';
  child.stdout.on('data', data => { diagnostics += data; });
  child.stderr.on('data', data => { diagnostics += data; });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Legacy fixture preparation timed out')), 20_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Fixture failed: ${diagnostics}`)); });
    });
  } finally { await stopChild(child); }
}

async function run() {
  await prepare();
  const expected = read(path.join(profile, '.upgrade-expected.json'));
  const originals = new Map(Object.keys(expected).map(relative => [relative, fs.readFileSync(path.join(profile, relative), 'utf8')]));
  let session;
  try {
    session = await startSession(root, executable, profile);
    for (const [relative, value] of Object.entries(expected)) {
      const file = path.join(profile, relative);
      const migrated = read(file);
      assert.equal(migrated?.__oknoteEncrypted, undefined, `${relative}: active file must be plain JSON`);
      // Window bounds and reminder cursors may legitimately advance at startup.
      if (relative === 'settings.json') {
        assertOldSettingsRetained(migrated, value); // Newly introduced defaults may be added.
      } else if (/^data\/note_.+\.json$/.test(relative) && ['echo', 'daily'].includes(value.noteType)) {
        // Existing startup housekeeping removes stale/duplicate echo bindings
        // and advances daily reset state. User content must remain identical.
        const housekeeping = ['revision', 'updatedAt', ...(value.noteType === 'echo' ? ['echoTagId', 'viewTagIds'] : ['dailyTodo'])];
        assert.deepEqual(omit(migrated, housekeeping), omit(value, housekeeping), `${relative}: all user content must survive`);
        if (value.noteType === 'daily') {
          assertOldSettingsRetained(migrated.dailyTodo, omit(value.dailyTodo || {}, ['lastResetDate']));
        } else {
          const validTags = new Set(expected['data/tags.json'].map(tag => tag.id));
          for (const id of [...(value.viewTagIds || []), value.echoTagId].filter(id => validTags.has(id))) {
            assert.ok(Object.keys(expected).filter(name => /^data\/note_.+\.json$/.test(name)).some(name => {
              const file = path.join(profile, name);
              if (!fs.existsSync(file)) return false;
              const note = read(file);
              return note.noteType === 'echo' && (note.viewTagIds || []).includes(id);
            }), 'every valid old echo tag must remain represented');
          }
        }
      } else if (!/^window-bounds\.json(\.bak)?$/.test(relative) && !/reminder-state\.json(\.bak)?$/.test(relative)) {
        assert.deepEqual(migrated, value, `${relative}: migration must preserve the complete document`);
      } else if (/reminder-state\.json(\.bak)?$/.test(relative)) {
        assert.deepEqual(migrated.fired, value.fired, 'reminder cursor updates must not reset deduplication data');
      }
      if (JSON.parse(originals.get(relative))?.__oknoteEncrypted) {
        const archiveDir = path.join(path.dirname(file), '.legacy-json');
        const archived = fs.readdirSync(archiveDir).filter(name => name.startsWith(`${path.basename(file)}.`))
          .some(name => fs.readFileSync(path.join(archiveDir, name), 'utf8') === originals.get(relative));
        assert.equal(archived, true, `${relative}: exact pre-conversion copy retained`);
      }
    }
    const state = await api(session.calendar, 'getEventsState');
    assert.equal(state.loadError, undefined);
    assert.deepEqual(state.events.map(item => item.id).sort(), expected['data/events.json'].map(item => item.id).sort());
    assert.equal((await api(session.calendar, 'getTags')).loadError, undefined);
    const summaries = await api(session.calendar, 'getNoteSummaries');
    for (const [relative, value] of Object.entries(expected)) {
      if (/^data\/note_.+\.json$/.test(relative)) assert.ok(summaries.some(note => note.id === value.id), 'old note must remain discoverable');
    }
    const current = state.events[0];
    assert.ok(current);
    const result = await api(session.calendar, 'mutateEvent', {
      type: 'update', expectedRevision: state.revision, event: { ...current, title: `${current.title}（升级测试）` },
    });
    assert.equal(result.ok, true, 'old data must be editable after migration');
    assert.ok(Array.isArray(read(path.join(profile, 'data', 'events.json'))));
    assert.ok(Array.isArray(read(path.join(profile, 'data', 'events.json.bak'))));
    const oldNoteEntry = Object.entries(expected).find(([relative, value]) => /^data\/note_.+\.json$/.test(relative)
      && (!value.noteType || value.noteType === 'independent'));
    assert.ok(oldNoteEntry, 'upgrade fixture must contain an independent note');
    const oldNote = await api(session.calendar, 'loadNote', oldNoteEntry[1].id);
    const savedNote = await api(session.calendar, 'saveNote', oldNote.id, { ...oldNote, title: `${oldNote.title}（升级测试）` });
    assert.equal(savedNote.ok, true, 'old note must be writable after migration');
    assert.equal(savedNote.note.revision, getNoteRevision(oldNote) + 1);
    assert.deepEqual(savedNote.note.items, oldNote.items);
    assert.equal(read(path.join(profile, oldNoteEntry[0])).__oknoteEncrypted, undefined);
    assert.deepEqual(session.errors, []);
    await session.stop(); session = null;
    session = await startSession(root, executable, profile);
    const restarted = await api(session.calendar, 'getEventsState');
    assert.equal(restarted.loadError, undefined);
    assert.ok(restarted.events.some(item => item.id === current.id && item.title === result.event.title));
    const restartedNote = await api(session.calendar, 'loadNote', oldNote.id);
    assert.equal(restartedNote.title, savedNote.note.title);
    assert.deepEqual(restartedNote.items, oldNote.items);
    assert.deepEqual(session.errors, []);
    console.log(`PASS legacy upgrade: ${Object.keys(expected).length} documents, exact archives, current/backup separation, IPC read/edit, plain saves and cold restart`);
  } finally { if (session) await session.stop(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (!process.exitCode) fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  else console.error(`Isolated diagnostics retained: ${profile}`);
});
