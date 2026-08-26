const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  dismissReminderToast: () => ipcRenderer.send('dismiss-reminder-toast'),
});
