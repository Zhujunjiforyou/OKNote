function buildReminderKey(event, minutesBefore) {
  return `${event.seriesId || event.id}|${event.startDate}|${event.startTime || 'all-day'}|${minutesBefore}`;
}

function eventStartMillis(event) {
  if (!event || typeof event !== 'object' || typeof event.startDate !== 'string') return null;
  const time = event.isAllDay === true ? '09:00' : event.startTime;
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const ms = new Date(`${event.startDate}T${time}:00`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function collectDueReminders(options) {
  const events = Array.isArray(options.events) ? options.events : [];
  const fired = options.fired && typeof options.fired === 'object' ? options.fired : {};
  const nowMs = Number(options.nowMs);
  const catchUpStartMs = Number(options.catchUpStartMs);
  const lateGraceMs = Math.max(0, Number(options.lateGraceMs) || 0);
  const getStartMillis = options.getStartMillis;
  if (!Number.isFinite(nowMs) || !Number.isFinite(catchUpStartMs) || typeof getStartMillis !== 'function') return [];
  const normalizedFiredKeys = new Set(Object.keys(fired).map((key) => key.split('|').slice(0, 4).join('|')));

  const due = [];
  for (const event of events) {
    const reminder = event && event.reminder;
    if (!reminder || reminder.enabled !== true) continue;
    const startMs = getStartMillis(event);
    if (!Number.isFinite(startMs)) continue;
    const minutesBefore = Math.max(0, Number(reminder.minutesBefore) || 0);
    const reminderMs = startMs - minutesBefore * 60 * 1000;
    if (reminderMs > nowMs || reminderMs < catchUpStartMs) continue;
    const key = buildReminderKey(event, minutesBefore);
    if (fired[key] || normalizedFiredKeys.has(key)) continue;
    due.push({
      event,
      key,
      reminderMs,
      missed: reminderMs < nowMs - lateGraceMs,
    });
  }
  return due;
}

module.exports = { buildReminderKey, collectDueReminders, eventStartMillis };
