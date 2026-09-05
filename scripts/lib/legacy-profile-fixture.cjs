// Test-only encoder. Production has no encryption/write counterpart.
const fs = require('node:fs');
const path = require('node:path');

const note = { id: 'upgrade_note', noteType: 'independent', title: '旧版便签', color: '#2563EB', revision: 5,
  isDocked: true, isHidden: false, items: [{ id: 'todo1', content: '旧待办内容', completed: false }],
  createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z' };
const event = (id) => ({ id, title: `旧事件 ${id}`, startDate: '2026-09-05', isAllDay: true });
const documents = {
  'data/events.json': [event('upgrade_a'), event('upgrade_b')],
  'data/events.json.bak': [event('upgrade_a'), event('upgrade_b'), event('previously_deleted')],
  'data/note_upgrade_note.json': note,
  'data/note_upgrade_note.json.bak': { ...note, revision: 4, title: '上一版便签' },
  'data/tags.json': [{ id: 'upgrade_tag', name: '旧标签', color: '#2563EB' }],
  'data/reminder-history.json': [{ id: 'upgrade_history', eventId: 'upgrade_a', startDate: '2026-09-05', firedAt: '2026-09-05T01:00:00Z', read: true }],
  'data/reminder-state.json': { fired: {}, lastCheckedAt: '2026-09-05T00:00:00Z' },
  'settings.json': { themeMode: 'light', globalFontFamily: 'Microsoft YaHei', globalFontSize: 18 },
  'window-bounds.json': { calendar: { x: 200, y: 150, width: 1000, height: 720 } },
};

{
  const { app, safeStorage } = require('electron');
  const profile = process.argv[2];
  const inspectOnly = process.argv.includes('--inspect-existing');
  const plain = process.argv.includes('--plain');
  app.setPath('userData', profile);
  app.whenReady().then(() => {
    let expected = documents;
    if (inspectOnly) {
      expected = {};
      const files = fs.readdirSync(path.join(profile, 'data')).filter(name => /\.json(\.bak)?$/.test(name))
        .map(name => `data/${name}`);
      files.push(...['settings.json', 'settings.json.bak', 'window-bounds.json', 'window-bounds.json.bak']
        .filter(name => fs.existsSync(path.join(profile, name))));
      for (const name of files) {
        const raw = JSON.parse(fs.readFileSync(path.join(profile, name), 'utf8'));
        if (raw?.__oknoteEncrypted === 'oknote-safe-storage') {
          expected[name] = JSON.parse(safeStorage.decryptString(Buffer.from(raw.payload, 'base64')));
        } else expected[name] = raw;
      }
    } else {
      for (const [relative, value] of Object.entries(documents)) {
        const file = path.join(profile, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(plain ? value : { __oknoteEncrypted: 'oknote-safe-storage', version: 1,
          payload: safeStorage.encryptString(JSON.stringify(value)).toString('base64') }));
      }
    }
    fs.writeFileSync(path.join(profile, '.upgrade-expected.json'), JSON.stringify(expected));
    console.log(`Prepared ${Object.keys(expected).length} old-format documents in isolated profile`);
    app.quit();
  }).catch(error => { console.error(error.message); app.exit(1); });
}
