const { isPlainRecord, isSafeIdentifier, isDateKey, isTimeKey } = require('./data-rules.cjs');
const { normalizeRecurrence, normalizeEventReminder } = require('./event-rules.cjs');
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeReminderHistory(rawHistory, limit = 500) {
  if (rawHistory === null || rawHistory === undefined) return { entries: [], rejectedCount: 0 };
  if (!Array.isArray(rawHistory)) return { entries: [], rejectedCount: 1 };

  const entries = [];
  const seenIds = new Set();
  let rejectedCount = 0;
  for (const raw of rawHistory) {
    if (!isPlainRecord(raw)
      || !isSafeIdentifier(raw.id)
      || !isSafeIdentifier(raw.eventId)
      || !isDateKey(raw.startDate)
      || typeof raw.firedAt !== 'string'
      || !Number.isFinite(Date.parse(raw.firedAt))) {
      rejectedCount += 1;
      continue;
    }
    if (seenIds.has(raw.id)) {
      rejectedCount += 1;
      continue;
    }
    seenIds.add(raw.id);
    const title = typeof raw.title === 'string' && raw.title.trim()
      ? raw.title.trim().slice(0, 200)
      : '未命名事件';
    entries.push({
      id: raw.id,
      ...(typeof raw.key === 'string' && raw.key.length > 0 && raw.key.length <= 520 ? { key: raw.key } : {}),
      eventId: raw.eventId,
      title,
      startDate: raw.startDate,
      ...(isTimeKey(raw.startTime) ? { startTime: raw.startTime } : {}),
      isAllDay: raw.isAllDay === true,
      firedAt: new Date(raw.firedAt).toISOString(),
      read: raw.read === true,
      ...(raw.missed === true ? { missed: true } : {}),
      ...(typeof raw.scheduledFor === 'string' && Number.isFinite(Date.parse(raw.scheduledFor))
        ? { scheduledFor: new Date(raw.scheduledFor).toISOString() }
        : {}),
    });
  }
  return { entries: entries.slice(-Math.max(1, limit)), rejectedCount };
}


function normalizeReminderEvent(raw) {
  if (!isPlainRecord(raw) || !isSafeIdentifier(raw.id) || !isDateKey(raw.startDate)) return null;
  const isAllDay = raw.isAllDay === true;
  const startTime = !isAllDay && isTimeKey(raw.startTime)
    ? raw.startTime
    : undefined;
  const endTime = !isAllDay && isTimeKey(raw.endTime)
    ? raw.endTime
    : undefined;
  const endDate = isDateKey(raw.endDate) && raw.endDate >= raw.startDate ? raw.endDate : undefined;
  const recurrence = normalizeRecurrence(raw.recurrence, raw.startDate);
  const reminder = isAllDay || startTime ? normalizeEventReminder(raw.reminder) : undefined;
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : '';
  return {
    id: raw.id,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 200) : '未命名事件',
    description: typeof raw.description === 'string' ? raw.description.slice(0, 2000) : '',
    startDate: raw.startDate,
    ...(endDate && endDate !== raw.startDate ? { endDate } : {}),
    ...(startTime ? { startTime } : {}),
    ...(endTime ? { endTime } : {}),
    isAllDay,
    ...(typeof raw.color === 'string' ? { color: raw.color } : {}),
    ...(isSafeIdentifier(raw.tagId) ? { tagId: raw.tagId } : {}),
    ...(recurrence ? { recurrence } : {}),
    ...(reminder ? { reminder } : {}),
    createdAt,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : createdAt,
  };
}

function normalizeReminderEvents(rawEvents) {
  if (!Array.isArray(rawEvents)) return { events: [], rejectedCount: rawEvents == null ? 0 : 1, repairedCount: 0 };
  const byId = new Map();
  let rejectedCount = 0;
  let repairedCount = 0;
  for (const raw of rawEvents) {
    const event = normalizeReminderEvent(raw);
    if (!event) {
      rejectedCount += 1;
      continue;
    }
    const invalidEndDate = Object.prototype.hasOwnProperty.call(raw, 'endDate')
      && raw.endDate !== raw.startDate
      && !Object.prototype.hasOwnProperty.call(event, 'endDate');
    if (invalidEndDate
      || (Object.prototype.hasOwnProperty.call(raw, 'recurrence') && !Object.prototype.hasOwnProperty.call(event, 'recurrence'))
      || (isPlainRecord(raw.reminder) && raw.reminder.enabled === true && !Object.prototype.hasOwnProperty.call(event, 'reminder'))) {
      repairedCount += 1;
    }
    const existing = byId.get(event.id);
    if (!existing || String(event.updatedAt) >= String(existing.updatedAt)) byId.set(event.id, event);
    else rejectedCount += 1;
  }
  return { events: [...byId.values()], rejectedCount, repairedCount };
}

function dateKeyToUtcDay(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return Math.floor(date.getTime() / DAY_MS);
}

function formatUtcDateKey(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function addDaysKey(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return formatUtcDateKey(date);
}

function diffDateKeys(startDate, endDate) {
  return dateKeyToUtcDay(endDate) - dateKeyToUtcDay(startDate);
}

function weekdayFromKey(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCDay();
}

function startOfWeekKey(dateStr) {
  const weekday = weekdayFromKey(dateStr);
  return addDaysKey(dateStr, weekday === 0 ? -6 : 1 - weekday);
}

function dateKeyForParts(year, month, day) {
  const candidate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isDateKey(candidate) ? candidate : null;
}

function alignForward(distance, interval) {
  return Math.max(0, Math.ceil(Math.max(0, distance) / interval) * interval);
}

function recurrenceCandidates(event, firstCandidate, rangeEnd, maxExpansionDays) {
  const recurrence = event.recurrence;
  if (!recurrence) return [];
  const interval = Math.max(1, Math.floor(recurrence.interval || 1));
  const until = isDateKey(recurrence.until) && recurrence.until < rangeEnd ? recurrence.until : rangeEnd;
  const cappedEnd = addDaysKey(firstCandidate, maxExpansionDays - 1);
  const lastCandidate = until < cappedEnd ? until : cappedEnd;
  if (lastCandidate < firstCandidate) return [];
  const candidates = [];

  if (recurrence.freq === 'daily') {
    let offset = alignForward(diffDateKeys(event.startDate, firstCandidate), interval);
    for (let dateStr = addDaysKey(event.startDate, offset); dateStr <= lastCandidate; offset += interval, dateStr = addDaysKey(event.startDate, offset)) {
      if (dateStr >= firstCandidate) candidates.push(dateStr);
    }
    return candidates;
  }

  if (recurrence.freq === 'weekly') {
    const startWeek = startOfWeekKey(event.startDate);
    const firstWeek = startOfWeekKey(firstCandidate);
    const firstWeekDistance = Math.floor(diffDateKeys(startWeek, firstWeek) / 7);
    const weekdayOffsets = [...new Set(
      (Array.isArray(recurrence.byWeekday) && recurrence.byWeekday.length > 0
        ? recurrence.byWeekday
        : [weekdayFromKey(event.startDate)])
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
        .map((day) => day === 0 ? 6 : day - 1),
    )].sort((a, b) => a - b);
    for (let weekOffset = alignForward(firstWeekDistance, interval); ; weekOffset += interval) {
      const weekStart = addDaysKey(startWeek, weekOffset * 7);
      if (weekStart > lastCandidate) break;
      for (const dayOffset of weekdayOffsets) {
        const dateStr = addDaysKey(weekStart, dayOffset);
        if (dateStr >= event.startDate && dateStr >= firstCandidate && dateStr <= lastCandidate) candidates.push(dateStr);
      }
    }
    return candidates;
  }

  if (recurrence.freq === 'monthly') {
    const [startYear, startMonth] = event.startDate.split('-').map(Number);
    const [firstYear, firstMonth] = firstCandidate.split('-').map(Number);
    const firstMonthDistance = (firstYear - startYear) * 12 + (firstMonth - startMonth);
    const days = [...new Set(
      (Array.isArray(recurrence.byMonthDay) && recurrence.byMonthDay.length > 0
        ? recurrence.byMonthDay
        : [Number(event.startDate.slice(8, 10))])
        .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31),
    )].sort((a, b) => a - b);
    for (let monthOffset = alignForward(firstMonthDistance, interval); ; monthOffset += interval) {
      const absoluteMonth = startYear * 12 + startMonth - 1 + monthOffset;
      const year = Math.floor(absoluteMonth / 12);
      const month = absoluteMonth % 12 + 1;
      const monthStart = dateKeyForParts(year, month, 1);
      if (!monthStart || monthStart > lastCandidate) break;
      for (const day of days) {
        const dateStr = dateKeyForParts(year, month, day);
        if (dateStr && dateStr >= event.startDate && dateStr >= firstCandidate && dateStr <= lastCandidate) candidates.push(dateStr);
      }
    }
    return candidates;
  }

  const [startYear, startMonth, startDay] = event.startDate.split('-').map(Number);
  const firstYearDistance = Number(firstCandidate.slice(0, 4)) - startYear;
  for (let yearOffset = alignForward(firstYearDistance, interval); ; yearOffset += interval) {
    const year = startYear + yearOffset;
    const yearStart = dateKeyForParts(year, 1, 1);
    if (!yearStart || yearStart > lastCandidate) break;
    const dateStr = dateKeyForParts(year, startMonth, startDay);
    if (!dateStr) continue;
    if (dateStr > lastCandidate) break;
    if (dateStr >= event.startDate && dateStr >= firstCandidate) candidates.push(dateStr);
  }
  return candidates;
}

function expandReminderEventsInRange(events, rangeStart, rangeEnd, maxExpansionDays = 4020) {
  if (!Array.isArray(events) || !isDateKey(rangeStart) || !isDateKey(rangeEnd) || rangeEnd < rangeStart) return [];
  const expanded = [];
  for (const event of events) {
    if (!isPlainRecord(event) || !isDateKey(event.startDate)) continue;
    const durationDays = isDateKey(event.endDate) && event.endDate > event.startDate
      ? Math.max(0, diffDateKeys(event.startDate, event.endDate))
      : 0;
    if (!event.recurrence) {
      const endDate = durationDays > 0 ? event.endDate : event.startDate;
      if (endDate >= rangeStart && event.startDate <= rangeEnd) expanded.push(event);
      continue;
    }
    const rangeCandidate = addDaysKey(rangeStart, -durationDays);
    const firstCandidate = event.startDate > rangeCandidate ? event.startDate : rangeCandidate;
    for (const occurrenceStart of recurrenceCandidates(event, firstCandidate, rangeEnd, maxExpansionDays)) {
      const occurrenceEnd = addDaysKey(occurrenceStart, durationDays);
      if (occurrenceEnd < rangeStart || occurrenceStart > rangeEnd) continue;
      expanded.push({
        ...event,
        startDate: occurrenceStart,
        endDate: durationDays > 0 ? occurrenceEnd : undefined,
        seriesId: event.id,
        occurrenceDate: occurrenceStart,
        occurrenceKey: `${event.id}__${occurrenceStart}`,
      });
    }
  }
  return expanded;
}

function localDateKeyFromMillis(timestamp) {
  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function expandReminderStartCandidates(events, rangeStart, rangeEnd, maxExpansionDays) {
  if (!Array.isArray(events) || !isDateKey(rangeStart) || !isDateKey(rangeEnd) || rangeEnd < rangeStart) return [];
  const expanded = [];
  const rangeDays = Math.max(1, Math.min(maxExpansionDays, diffDateKeys(rangeStart, rangeEnd) + 1));
  for (const event of events) {
    if (!isPlainRecord(event) || !isDateKey(event.startDate)) continue;
    if (!event.recurrence) {
      if (event.startDate >= rangeStart && event.startDate <= rangeEnd) expanded.push(event);
      continue;
    }
    const durationDays = isDateKey(event.endDate) && event.endDate > event.startDate
      ? Math.max(0, diffDateKeys(event.startDate, event.endDate))
      : 0;
    const firstCandidate = event.startDate > rangeStart ? event.startDate : rangeStart;
    for (const occurrenceStart of recurrenceCandidates(event, firstCandidate, rangeEnd, rangeDays)) {
      expanded.push({
        ...event,
        startDate: occurrenceStart,
        endDate: durationDays > 0 ? addDaysKey(occurrenceStart, durationDays) : undefined,
        seriesId: event.id,
        occurrenceDate: occurrenceStart,
        occurrenceKey: `${event.id}__${occurrenceStart}`,
      });
    }
  }
  return expanded;
}

function expandReminderEventsForDueWindow(events, catchUpStartMs, nowMs, maxExpansionDays = 4020) {
  if (!Array.isArray(events)
    || !Number.isFinite(catchUpStartMs)
    || !Number.isFinite(nowMs)
    || catchUpStartMs > nowMs) return [];

  const byLeadMinutes = new Map();
  for (const event of events) {
    if (!isPlainRecord(event) || !isPlainRecord(event.reminder) || event.reminder.enabled !== true) continue;
    const leadMinutes = Math.min(525600, Math.max(0, Math.floor(Number(event.reminder.minutesBefore) || 0)));
    const group = byLeadMinutes.get(leadMinutes);
    if (group) group.push(event);
    else byLeadMinutes.set(leadMinutes, [event]);
  }

  const candidates = [];
  for (const [leadMinutes, groupedEvents] of byLeadMinutes) {
    const leadMs = leadMinutes * 60 * 1000;
    const rangeStart = localDateKeyFromMillis(catchUpStartMs + leadMs);
    const rangeEnd = localDateKeyFromMillis(nowMs + leadMs);
    const expanded = expandReminderStartCandidates(groupedEvents, rangeStart, rangeEnd, maxExpansionDays);
    for (const occurrence of expanded) candidates.push(occurrence);
  }
  return candidates;
}

module.exports = {
  expandReminderEventsForDueWindow,
  expandReminderEventsInRange,
  normalizeReminderEvents,
  normalizeReminderHistory,
};
