// Electron 44/macOS emits 'show' when the system accepts the request. It does
// not prove banner visibility or that the user read it; system policy may suppress it.
// A missing acknowledgement still follows the existing timeout/failure path.
function waitForNativeNotification(notification, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (delivered) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      notification.removeListener('show', shown);
      notification.removeListener('click', clicked);
      notification.removeListener('failed', failed);
      notification.removeListener('close', failed);
      if (!delivered) {
        try { notification.close(); } catch {}
      }
      resolve(delivered);
    };
    const shown = () => finish(true);
    const clicked = () => finish(true);
    const failed = () => finish(false);
    const deadline = setTimeout(failed, timeoutMs);
    notification.on('show', shown);
    notification.on('click', clicked);
    notification.on('failed', failed);
    notification.on('close', failed);
    try { notification.show(); } catch { finish(false); }
  });
}

module.exports = { waitForNativeNotification };
