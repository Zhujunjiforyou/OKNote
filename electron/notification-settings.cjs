// Values returned by Apple's public UNNotificationSettings enums.
function notificationSettingsState(raw = {}) {
  const setting = (value) => ['not-supported', 'disabled', 'enabled'][value] || 'unknown';
  return {
    authorization: ['not-determined', 'denied', 'authorized', 'provisional'][raw.authorizationStatus] || 'unknown',
    alerts: setting(raw.alertSetting),
    alertStyle: ['none', 'banner', 'alert'][raw.alertStyle] || 'unknown',
    notificationCenter: setting(raw.notificationCenterSetting),
    sound: setting(raw.soundSetting),
  };
}

function suppressNotificationFallback(settings) {
  return settings?.authorization === 'denied' || settings?.authorization === 'provisional'
    || (settings?.authorization === 'authorized'
      && (settings.alerts === 'disabled' || settings.alertStyle === 'none'));
}

module.exports = { notificationSettingsState, suppressNotificationFallback };
