const { isPlainRecord, isDateKey } = require('./data-rules.cjs');

const RECURRENCE_INTERVAL_MAX = 99;

function normalizeRecurrenceInterval(value) {
  return Math.min(RECURRENCE_INTERVAL_MAX, Math.max(1, Math.floor(Number(value) || 1)));
}

function normalizeRecurrence(value, startDate) {
  if (!isPlainRecord(value) || !['daily', 'weekly', 'monthly', 'yearly'].includes(value.freq)) return undefined;
  const recurrence = {
    freq: value.freq,
    interval: normalizeRecurrenceInterval(value.interval),
  };
  if (value.freq === 'weekly') {
    const weekdays = [...new Set((Array.isArray(value.byWeekday) ? value.byWeekday : [])
      .map(Number)
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))];
    if (weekdays.length > 0) recurrence.byWeekday = weekdays;
  }
  if (value.freq === 'monthly') {
    const monthDays = [...new Set((Array.isArray(value.byMonthDay) ? value.byMonthDay : [])
      .map(Number)
      .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31))];
    if (monthDays.length > 0) recurrence.byMonthDay = monthDays;
  }
  if (isDateKey(value.until) && value.until >= startDate) recurrence.until = value.until;
  return recurrence;
}

function normalizeEventReminder(value) {
  if (!isPlainRecord(value) || value.enabled !== true) return undefined;
  return {
    enabled: true,
    minutesBefore: Math.min(525600, Math.max(0, Math.floor(Number(value.minutesBefore) || 0))),
    playSound: value.playSound === true,
  };
}

module.exports = { normalizeRecurrenceInterval, RECURRENCE_INTERVAL_MAX, normalizeRecurrence, normalizeEventReminder };
