// Read-only smoke check of the real native bridge. Never requests notification permission.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
if (!process.versions.electron || process.platform !== 'darwin') throw new Error('Run inside a macOS OKNote test runtime.');
const { app } = require('electron');
const { getBinding } = require('../electron/macos-desktop-window.cjs');
const { notificationSettingsState } = require('../electron/notification-settings.cjs');
app.whenReady().then(async () => {
  const raw = await getBinding().getNotificationSettings();
  const settings = notificationSettingsState(raw);
  assert.notEqual(settings.authorization, 'unknown', 'macOS must return a real authorization state');
  for (const key of ['alerts', 'alertStyle', 'notificationCenter', 'sound']) assert.notEqual(settings[key], 'unknown', key);
  const output = path.join(__dirname, '..', 'test-results');
  fs.mkdirSync(output, { recursive:true });
  fs.writeFileSync(path.join(output,'mac-notification-settings.json'), JSON.stringify({ checkedAt:new Date().toISOString(), electron:process.versions.electron, settings, permissionRequested:false },null,2)+'\n');
  console.log('PASS native notification settings read:', JSON.stringify(settings));
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
