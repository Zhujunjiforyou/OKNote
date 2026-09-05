import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  canonicalNoteFileNames,
  canonicalTrashRecordNames,
  dataDocumentValidator,
  getReadOnlyDataTargets,
  isValidTrashRecord,
} = require('../electron/data-validation.cjs') as {
  canonicalNoteFileNames: (entries: string[]) => string[]
  canonicalTrashRecordNames: (entries: string[]) => string[]
  dataDocumentValidator: (fileName: string) => (value: unknown) => boolean | {
    valid: true
    degraded: true
    reason: string
    validEntries: number
    invalidEntries: number
  }
  getReadOnlyDataTargets: (changes: unknown[], loadErrors: Map<string, string>) => string[]
  isValidTrashRecord: (value: unknown) => boolean
}

describe('business JSON structure validation', () => {
  it('validates each persisted data family before accepting a primary or backup', () => {
    expect(dataDocumentValidator('events.json')([])).toBe(true)
    expect(dataDocumentValidator('events.json')({ events: [] })).toBe(false)
    expect(dataDocumentValidator('events.json')([null])).toBe(false)
    expect(dataDocumentValidator('events.json')([
      null,
      { id: 'legacy_event', startDate: '2025-05-01' },
    ])).toMatchObject({
      valid: true,
      degraded: true,
      validEntries: 1,
      invalidEntries: 1,
    })
    expect(dataDocumentValidator('settings.json')({ themeMode: 'dark' })).toBe(true)
    expect(dataDocumentValidator('settings.json')({})).toBe(false)
    expect(dataDocumentValidator('settings.json')([])).toBe(false)
    expect(dataDocumentValidator('window-bounds.json')({ calendar: { width: 800, height: 600 } })).toBe(true)
    expect(dataDocumentValidator('window-bounds.json')({ calendar: { width: 800 } })).toBe(false)
    expect(dataDocumentValidator('window-bounds.json')(null)).toBe(false)
    expect(dataDocumentValidator('note_note_1.json')({ id: 'note_1', items: [] })).toBe(true)
    expect(dataDocumentValidator('note_note_1.json')({ id: 'note_1' })).toBe(false)
    expect(dataDocumentValidator('note_note_1.json')([])).toBe(false)
    expect(dataDocumentValidator('reminder-history.json')([])).toBe(true)
    expect(dataDocumentValidator('reminder-history.json')([null])).toBe(false)
    expect(dataDocumentValidator('reminder-history.json')([
      null,
      { id: 'reminder_1', eventId: 'event_1', startDate: '2025-05-01', firedAt: '2025-05-01T01:00:00.000Z' },
    ])).toMatchObject({ valid: true, degraded: true, validEntries: 1, invalidEntries: 1 })
    expect(dataDocumentValidator('reminder-state.json')({ fired: {} })).toBe(true)
    expect(dataDocumentValidator('reminder-state.json')({
      fired: {
        good: '2025-05-01T01:00:00.000Z',
        bad: 'not-a-date',
      },
    })).toMatchObject({ valid: true, degraded: true, validEntries: 1, invalidEntries: 1 })
    expect(dataDocumentValidator('reminder-state.json')({})).toBe(false)
    expect(dataDocumentValidator('reminder-state.json')({ fired: [] })).toBe(false)
  })

  it('marks partially damaged notes and duplicate records as degraded instead of writable', () => {
    expect(dataDocumentValidator('note_note_1.json')({
      id: 'note_1',
      items: [
        { id: 'item_1', content: '保留' },
        null,
      ],
    })).toMatchObject({ valid: true, degraded: true, validEntries: 1, invalidEntries: 1 })
    expect(dataDocumentValidator('events.json')([
      { id: 'event_1', startDate: '2025-05-01' },
      { id: 'event_1', startDate: '2025-05-02' },
    ])).toMatchObject({ valid: true, degraded: true, duplicateEntries: 1 })
  })

  it('rejects malformed or duplicate tags so a valid backup can be tried', () => {
    const validate = dataDocumentValidator('tags.json')
    expect(validate([{ id: 'work', name: '工作' }])).toBe(true)
    expect(validate([{ id: 'work', name: '工作' }, { id: 'work', name: '重复' }])).toBe(false)
    expect(validate([{ id: 'bad id', name: '无效' }])).toBe(false)
  })

  it('accepts recognizable v1/v2 records that current normalizers can migrate', () => {
    expect(dataDocumentValidator('events.json')([{
      id: 'legacy_event',
      title: '旧事件',
      startDate: '2020-02-29',
      isAllDay: true,
      color: '#2563EB',
      createdAt: '2020-02-01T00:00:00.000Z',
      updatedAt: '2020-02-01T00:00:00.000Z',
    }])).toBe(true)
    expect(dataDocumentValidator('note_legacy_note.json')({
      id: 'legacy_note',
      title: '旧便签',
      color: '#2563EB',
      items: [{ id: 'legacy_item', noteId: 'legacy_note', content: '保留内容', isCompleted: false, sortOrder: 0 }],
      transparency: 0.8,
      fontFamily: 'Microsoft YaHei',
      fontSize: 14,
      isPinned: false,
      isArchived: false,
      createdAt: '2020-02-01T00:00:00.000Z',
      updatedAt: '2020-02-01T00:00:00.000Z',
    })).toBe(true)
    expect(dataDocumentValidator('settings.json')({
      themeMode: 'dark',
      autoLaunch: false,
      globalFontFamily: 'Microsoft YaHei',
      globalFontSize: 14,
      calendar: { fontFamily: 'Inter', fontSize: 14, backgroundColor: '#0D0D10', backgroundOpacity: 0.88, textColor: '#E2E8F0' },
      notes: { fontFamily: 'Inter', fontSize: 14, backgroundColor: '#0D0D10', backgroundOpacity: 0.88, textColor: '#E2E8F0' },
    })).toBe(true)
  })

  it('discovers notes and trash entries when only their backup remains', () => {
    expect(canonicalNoteFileNames([
      'note_primary.json',
      'note_backup_only.json.bak',
      'note_primary.json.bak',
      'ignore.txt',
    ])).toEqual(['note_backup_only.json', 'note_primary.json'])
    expect(canonicalTrashRecordNames([
      'trash_primary.json',
      'trash_backup_only.json.bak',
      'ignore.json',
    ])).toEqual(['trash_backup_only.json', 'trash_primary.json'])
  })

  it('validates recovered trash records before showing or restoring them', () => {
    expect(isValidTrashRecord({
      trashId: 'trash_1',
      noteId: 'note_1',
      deletedAt: '2025-05-01T01:00:00.000Z',
      note: { id: 'note_1', items: [] },
    })).toBe(true)
    expect(isValidTrashRecord({ trashId: 'trash_1', noteId: 'bad id', note: {} })).toBe(false)
  })

  it('finds every read-only target before a transaction starts', () => {
    const errors = new Map([
      ['reminder-history.json', 'damaged'],
      ['note_note_1.json', 'recovery write failed'],
    ])
    expect(getReadOnlyDataTargets([
      { fileName: 'reminder-state.json', data: { fired: {} } },
      { fileName: 'reminder-history.json', data: [] },
      { fileName: 'reminder-history.json', data: [] },
      { fileName: 'note_note_1.json', delete: true },
    ], errors)).toEqual(['reminder-history.json', 'note_note_1.json'])
  })
})
