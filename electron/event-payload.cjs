const { isDateKey, isSafeIdentifier, isTimeKey, safeHexColor } = require('./data-rules.cjs');
const { normalizeRecurrence, normalizeEventReminder } = require('./event-rules.cjs');

function sanitizeTagPayload(tag) {
  if (!tag || typeof tag !== 'object' || !isSafeIdentifier(tag.id)) return null;
  const name = typeof tag.name === 'string' ? tag.name.trim().slice(0, 50) : '';
  if (!name) return null;
  return {
    id: tag.id,
    name,
    color: safeHexColor(tag.color),
    createdAt: typeof tag.createdAt === 'string' ? tag.createdAt : new Date().toISOString(),
  };
}

function sanitizeEventPayload(eventData, existing = null) {
  if (!eventData || typeof eventData !== 'object' || !isSafeIdentifier(eventData.id)) return null;
  if (!isDateKey(eventData.startDate)) return null;
  const title = typeof eventData.title === 'string' ? eventData.title.trim().slice(0, 200) : '';
  if (!title) return null;
  const endDate = isDateKey(eventData.endDate) && eventData.endDate >= eventData.startDate ? eventData.endDate : undefined;
  const startTime = isTimeKey(eventData.startTime) ? eventData.startTime : undefined;
  const endTime = isTimeKey(eventData.endTime) ? eventData.endTime : undefined;
  const recurrence = normalizeRecurrence(eventData.recurrence, eventData.startDate);
  const reminder = normalizeEventReminder(eventData.reminder);
  const next = {
    ...(existing && typeof existing === 'object' ? existing : {}),
    id: eventData.id,
    title,
    description: typeof eventData.description === 'string' ? eventData.description.slice(0, 2000) : '',
    startDate: eventData.startDate,
    isAllDay: eventData.isAllDay === true,
    color: safeHexColor(eventData.color),
    createdAt: existing && typeof existing.createdAt === 'string'
      ? existing.createdAt
      : (typeof eventData.createdAt === 'string' ? eventData.createdAt : new Date().toISOString()),
    updatedAt: new Date().toISOString(),
  };
  for (const key of ['endDate', 'startTime', 'endTime', 'tagId', 'recurrence', 'reminder', 'occurrenceKey', 'occurrenceDate', 'seriesId']) {
    delete next[key];
  }
  if (endDate && endDate !== eventData.startDate) next.endDate = endDate;
  if (eventData.isAllDay !== true) {
    if (startTime) next.startTime = startTime;
    if (endTime) next.endTime = endTime;
  }
  if (isSafeIdentifier(eventData.tagId)) next.tagId = eventData.tagId;
  if (recurrence) next.recurrence = recurrence;
  if (reminder && (next.isAllDay || startTime)) next.reminder = reminder;
  return next;
}

module.exports = { sanitizeTagPayload, sanitizeEventPayload };
