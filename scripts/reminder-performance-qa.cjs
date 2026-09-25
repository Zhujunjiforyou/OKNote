// Run after Vitest workers have exited; keep the original 10,000-event / 500 ms budget.
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { normalizeReminderEvents, expandReminderEventsForDueWindow } = require('../electron/reminder-data.cjs');

const events = Array.from({ length: 10_000 }, (_, index) => ({
  id: `event_${index}`, title: `循环事件 ${index}`, startDate: '2016-01-01', isAllDay: true,
  recurrence: { freq: 'daily', interval: 1 },
  reminder: { enabled: true, minutesBefore: 525_600 },
}));
const nowMs = new Date(2026, 7, 30, 10, 0, 0, 0).getTime();
const catchUpStartMs = nowMs - 3 * 60 * 60 * 1000;
const startedAt = performance.now();
const normalized = normalizeReminderEvents(events);
const expanded = expandReminderEventsForDueWindow(normalized.events, catchUpStartMs, nowMs);
const elapsedMs = performance.now() - startedAt;

assert.equal(normalized.rejectedCount, 0);
assert.equal(expanded.length, 10_000);
assert.equal(new Set(expanded.map(event => event.seriesId)).size, 10_000);
assert.ok(elapsedMs < 500, `Reminder performance: ${elapsedMs.toFixed(2)} ms exceeds the 500 ms budget. Run without a concurrent build.`);
console.log(`PASS reminder performance: 10,000 events in ${elapsedMs.toFixed(2)} ms (budget: 500 ms)`);
