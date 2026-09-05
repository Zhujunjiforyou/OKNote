const { isSafeIdentifier } = require('./data-rules.cjs');

function eventsByTag(events, tagId, loadError = null) {
  if (!isSafeIdentifier(tagId)) return [];
  if (loadError) throw new Error(String(loadError));
  if (!Array.isArray(events)) throw new Error('事件数据响应不是列表');
  return events.filter((event) => event
    && typeof event === 'object'
    && !Array.isArray(event)
    && event.tagId === tagId);
}

module.exports = { eventsByTag };
