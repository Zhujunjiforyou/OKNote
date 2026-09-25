const { isDateKey, isPlainRecord } = require('./data-rules.cjs');

function normalizeCompletion(raw) {
  if (!isPlainRecord(raw)) return undefined;
  return {
    completed: raw.completed === true,
    occurrenceDates: [...new Set((Array.isArray(raw.occurrenceDates) ? raw.occurrenceDates : []).filter(isDateKey))].sort().slice(-20000),
  };
}

// The presence of completion is a migration marker, including an empty state.
// Keep legacy note data intact, but never let it re-complete an undone event.
function migrateEventCompletions(events, notes) {
  const keys = new Set(notes.filter((note) => note.noteType === 'daily')
    .flatMap((note) => note.dailyTodo?.completedEventOccurrences || []));
  const datesByEvent = new Map();
  for (const key of keys) {
    if (typeof key !== 'string' || key.slice(-12, -10) !== '__' || !isDateKey(key.slice(-10))) continue;
    const id = key.slice(0, -12);
    const dates = datesByEvent.get(id) || [];
    dates.push(key.slice(-10));
    datesByEvent.set(id, dates);
  }
  return events.map((event) => {
    if (!event || typeof event !== 'object') return event;
    const completion = normalizeCompletion(event.completion);
    if (completion) return { ...event, completion };
    return { ...event, completion: {
      completed: !event.recurrence && keys.has(event.id),
      occurrenceDates: event.recurrence ? (datesByEvent.get(event.id) || []).sort().slice(-20000) : [],
    } };
  });
}

function isEventCompleted(event) {
  return event.recurrence
    ? !!event.completion?.occurrenceDates?.includes(event.occurrenceDate || event.startDate)
    : event.completion?.completed === true;
}

function setEventCompletion(event, occurrenceDate, completed) {
  const completion = normalizeCompletion(event.completion) || { completed: false, occurrenceDates: [] };
  if (event.recurrence) {
    if (!isDateKey(occurrenceDate)) return null;
    const dates = new Set(completion.occurrenceDates);
    if (completed) dates.add(occurrenceDate);
    else dates.delete(occurrenceDate);
    completion.occurrenceDates = [...dates].sort().slice(-20000);
  } else completion.completed = completed;
  return { ...event, completion, updatedAt: new Date().toISOString() };
}

module.exports = { normalizeCompletion, migrateEventCompletions, isEventCompleted, setEventCompletion };
