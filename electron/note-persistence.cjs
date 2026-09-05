const { isPlainRecord } = require('./data-rules.cjs');

function getNoteRevision(note) {
  return isPlainRecord(note) && Number.isInteger(note.revision) && note.revision >= 0
    ? note.revision
    : 0;
}

function commitNoteSnapshot(options) {
  const {
    noteId,
    existing,
    snapshot,
    expectedRevision,
    write,
    cache,
    now = () => new Date().toISOString(),
  } = options || {};

  if (typeof noteId !== 'string' || !noteId || typeof write !== 'function') {
    return { ok: false, code: 'invalid', message: '便签保存请求无效' };
  }

  const current = isPlainRecord(existing) ? existing : null;
  const patch = isPlainRecord(snapshot) ? snapshot : {};
  const currentRevision = getNoteRevision(current);
  if (Number.isInteger(expectedRevision) && expectedRevision !== currentRevision) {
    return {
      ok: false,
      code: 'conflict',
      message: '这张便签已在另一个窗口中更新；当前窗口内容未覆盖磁盘数据。',
      ...(current ? { note: { ...current, id: noteId } } : {}),
    };
  }

  const next = {
    ...(current || {}),
    ...patch,
    id: noteId,
    revision: currentRevision + 1,
    updatedAt: now(),
  };

  let saved = false;
  try {
    saved = write(next) === true;
  } catch (error) {
    return {
      ok: false,
      code: 'save_failed',
      message: error instanceof Error ? error.message : '便签写入失败',
    };
  }
  if (!saved) return { ok: false, code: 'save_failed', message: '便签未能写入磁盘' };

  if (cache && typeof cache.set === 'function') cache.set(noteId, next);
  return { ok: true, note: next };
}

module.exports = { commitNoteSnapshot, getNoteRevision };
