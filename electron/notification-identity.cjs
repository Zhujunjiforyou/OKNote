const path = require('node:path');
const { execFile } = require('node:child_process');

const APP_NAME = 'OKNote';
const APP_ID = 'com.oknote.app';

function notificationIdentity(packaged) {
  return { id: packaged ? APP_ID : `${APP_ID}.development`, name: packaged ? APP_NAME : `${APP_NAME} 开发版` };
}

// Toast content icons do not control Windows' source header. Register those
// assets separately, before the first reminder. Leave Electron's COM activator
// and the installer's shortcut intact so notification clicks still reach it.
async function registerNotificationIdentity(identity, iconsDir, { platform = process.platform, run = execFile } = {}) {
  if (platform !== 'win32') return true;
  const key = `HKCU\\Software\\Classes\\AppUserModelId\\${identity.id}`;
  for (const [name, value] of [['DisplayName', identity.name], ['IconUri', path.join(iconsDir, 'app-64.png')]]) {
    await new Promise((resolve, reject) => run('reg.exe', ['add', key, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'],
      { windowsHide: true, timeout: 5000 }, (error) => error ? reject(error) : resolve()));
  }
  return true;
}

module.exports = { APP_NAME, APP_ID, notificationIdentity, registerNotificationIdentity };
