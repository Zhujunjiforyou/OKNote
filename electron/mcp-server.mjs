import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, renameSync } from 'fs';
import { join, resolve } from 'path';

// ── Data directory resolution (no Electron dependency) ──

function resolveDataDir() {
  const envDir = process.env.OKNOTE_DATA_DIR ? resolve(process.env.OKNOTE_DATA_DIR) : null;
  if (envDir) {
    const dataDir = join(envDir, 'data');
    mkdirSync(dataDir, { recursive: true });
    return dataDir;
  }
  const appData = process.env.APPDATA || (process.platform === 'darwin'
    ? join(process.env.HOME, 'Library', 'Application Support')
    : join(process.env.HOME, '.config'));
  const defaultDataDir = join(appData, 'OKNote', 'data');
  mkdirSync(defaultDataDir, { recursive: true });
  return defaultDataDir;
}

let DATA_DIR = resolveDataDir();

// ── Data persistence helpers ──

function ensureDataDir() {
  try { if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true }); } catch { /* ignore */ }
}

function saveAppData(fileName, data) {
  ensureDataDir();
  const filePath = join(DATA_DIR, fileName);
  const tmpPath = filePath + '.tmp';
  try {
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    renameSync(tmpPath, filePath);
    return true;
  } catch (e) {
    console.error('saveAppData failed:', fileName, e.message);
    try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* ignore */ }
    return false;
  }
}

function loadAppData(fileName) {
  const filePath = join(DATA_DIR, fileName);
  try {
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, 'utf-8'));
    }
  } catch (e) {
    console.error('loadAppData failed:', fileName, e.message);
  }
  return null;
}

function loadEvents() {
  return loadAppData('events.json') || [];
}

function saveEvents(events) {
  return saveAppData('events.json', events);
}

function loadTags() {
  return loadAppData('tags.json') || [];
}

function saveTags(tags) {
  return saveAppData('tags.json', tags);
}

function loadNote(noteId) {
  return loadAppData(`note_${noteId}.json`);
}

function saveNote(noteId, note) {
  return saveAppData(`note_${noteId}.json`, { ...note, id: noteId, updatedAt: new Date().toISOString() });
}

function deleteNoteFile(noteId) {
  const fp = join(DATA_DIR, `note_${noteId}.json`);
  try { if (existsSync(fp)) unlinkSync(fp); } catch (e) { console.error('deleteNoteFile failed:', e.message); }
}

function listNoteFiles() {
  ensureDataDir();
  try {
    return readdirSync(DATA_DIR).filter(f => f.startsWith('note_') && f.endsWith('.json'));
  } catch { return []; }
}

function loadAllNotes() {
  const files = listNoteFiles();
  const notes = [];
  for (const f of files) {
    const noteId = f.replace(/\.json$/, '').replace(/^note_/, '');
    const data = loadNote(noteId);
    if (data && typeof data === 'object') notes.push(data);
  }
  return notes;
}

// ── Validation helpers ──

function isValidDate(str) {
  return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str);
}

function isValidTime(str) {
  return typeof str === 'string' && /^\d{2}:\d{2}$/.test(str);
}

function normalizeHexColor(c) {
  if (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) return c;
  return '#2563EB';
}

// ── Tool definitions ──

const TOOLS = [
  {
    name: 'list_events',
    description: '列出事件（代办事项），可按日期范围或标签筛选',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: '筛选开始日期 (YYYY-MM-DD)' },
        endDate: { type: 'string', description: '筛选结束日期 (YYYY-MM-DD)' },
        tagId: { type: 'string', description: '按标签 ID 筛选' },
        query: { type: 'string', description: '按标题关键词搜索' },
      },
    },
  },
  {
    name: 'get_event',
    description: '获取单个事件的完整详情',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: '事件 ID' },
      },
      required: ['eventId'],
    },
  },
  {
    name: 'create_event',
    description: '新建日历事件、代办事项、简要提醒',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '事件标题 (必填，最多200字符)' },
        startDate: { type: 'string', description: '开始日期 (YYYY-MM-DD)' },
        endDate: { type: 'string', description: '结束日期 (YYYY-MM-DD)，用于跨日事件' },
        startTime: { type: 'string', description: '开始时间 (HH:mm)' },
        endTime: { type: 'string', description: '结束时间 (HH:mm)' },
        isAllDay: { type: 'boolean', description: '是否全天事件' },
        color: { type: 'string', description: '颜色 (#RRGGBB)' },
        tagId: { type: 'string', description: '标签 ID' },
        description: { type: 'string', description: '事件描述，最多2000字符' },
        reminder: { type: 'boolean', description: '是否开启提醒' },
        reminderMinutes: { type: 'number', description: '提前提醒分钟数' },
        reminderPlaySound: { type: 'boolean', description: '是否播放提示音' },
      },
      required: ['title', 'startDate'],
    },
  },
  {
    name: 'update_event',
    description: '更新已有事件、代办事项（只传需要修改的字段）',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: '事件 ID (必填)' },
        title: { type: 'string', description: '新标题' },
        startDate: { type: 'string', description: '新开始日期 (YYYY-MM-DD)' },
        endDate: { type: 'string', description: '新结束日期' },
        startTime: { type: 'string', description: '新开始时间 (HH:mm)' },
        endTime: { type: 'string', description: '新结束时间 (HH:mm)' },
        isAllDay: { type: 'boolean', description: '是否全天' },
        color: { type: 'string', description: '颜色 (#RRGGBB)' },
        tagId: { type: 'string', description: '标签 ID' },
        description: { type: 'string', description: '描述' },
        reminder: { type: 'boolean', description: '是否开启提醒' },
        reminderMinutes: { type: 'number', description: '提前提醒分钟数' },
        reminderPlaySound: { type: 'boolean', description: '是否播放提示音' },
      },
      required: ['eventId'],
    },
  },
  {
    name: 'delete_event',
    description: '删除事件、代办事项',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: '事件 ID' },
      },
      required: ['eventId'],
    },
  },
  {
    name: 'list_notes',
    description: '列出所有便签，可按类型筛选',
    inputSchema: {
      type: 'object',
      properties: {
        noteType: { type: 'string', enum: ['independent', 'daily', 'echo', 'view'], description: '便签类型' },
      },
    },
  },
  {
    name: 'get_note',
    description: '获取单个便签的完整信息（含待办列表）',
    inputSchema: {
      type: 'object',
      properties: {
        noteId: { type: 'string', description: '便签 ID' },
      },
      required: ['noteId'],
    },
  },
  {
    name: 'create_note',
    description: '新建便签',
    inputSchema: {
      type: 'object',
      properties: {
        noteType: { type: 'string', enum: ['independent', 'daily', 'echo'], description: '便签类型' },
        title: { type: 'string', description: '便签标题' },
        color: { type: 'string', description: '颜色 (#RRGGBB)' },
        echoTagId: { type: 'string', description: '视图便签的关联标签 ID（仅 echo 类型）' },
      },
      required: ['noteType'],
    },
  },
  {
    name: 'update_note',
    description: '更新便签属性',
    inputSchema: {
      type: 'object',
      properties: {
        noteId: { type: 'string', description: '便签 ID' },
        title: { type: 'string', description: '新标题' },
        color: { type: 'string', description: '颜色 (#RRGGBB)' },
        isPinned: { type: 'boolean' },
        isArchived: { type: 'boolean' },
      },
      required: ['noteId'],
    },
  },
  {
    name: 'delete_note',
    description: '删除便签',
    inputSchema: {
      type: 'object',
      properties: {
        noteId: { type: 'string', description: '便签 ID' },
      },
      required: ['noteId'],
    },
  },
  {
    name: 'add_todo_item',
    description: '向便签添加待办项',
    inputSchema: {
      type: 'object',
      properties: {
        noteId: { type: 'string', description: '便签 ID' },
        content: { type: 'string', description: '待办内容' },
        todoDate: { type: 'string', description: '待办日期 (YYYY-MM-DD)，仅 daily 便签使用' },
      },
      required: ['noteId', 'content'],
    },
  },
  {
    name: 'toggle_todo_item',
    description: '切换待办项的完成状态',
    inputSchema: {
      type: 'object',
      properties: {
        noteId: { type: 'string', description: '便签 ID' },
        itemId: { type: 'string', description: '待办项 ID' },
      },
      required: ['noteId', 'itemId'],
    },
  },
  {
    name: 'list_tags',
    description: '列出所有标签',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_daily_overview',
    description: '获取某天的所有事件和未完成待办',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: '日期 (YYYY-MM-DD)，默认今天' },
      },
    },
  },
];

// ── Tool handler ──

const server = new Server(
  { name: 'oknote-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

function mcpText(text) {
  return { content: [{ type: 'text', text }] };
}

function mcpError(msg) {
  return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // ── Event tools ──
      case 'list_events': {
        let events = loadEvents();
        if (args.startDate) events = events.filter(e => e.startDate >= args.startDate);
        if (args.endDate) events = events.filter(e => (e.endDate || e.startDate) <= args.endDate);
        if (args.tagId) events = events.filter(e => e.tagId === args.tagId);
        if (args.query) {
          const q = args.query.toLowerCase();
          events = events.filter(e => (e.title || '').toLowerCase().includes(q) || (e.description || '').toLowerCase().includes(q));
        }
        return mcpText(JSON.stringify(events, null, 2));
      }
      case 'get_event': {
        const events = loadEvents();
        const event = events.find(e => e.id === args.eventId || e.seriesId === args.eventId);
        if (!event) return mcpError(`事件 ${args.eventId} 未找到`);
        return mcpText(JSON.stringify(event, null, 2));
      }
      case 'create_event': {
        const trimmedTitle = (args.title || '').trim();
        if (!trimmedTitle) return mcpError('请输入事件标题');
        if (trimmedTitle.length > 200) return mcpError('标题不能超过200个字符');
        if (!args.startDate || !isValidDate(args.startDate)) return mcpError('请输入有效的开始日期 (YYYY-MM-DD)');
        if (args.endDate && !isValidDate(args.endDate)) return mcpError('无效的结束日期');
        if (args.endDate && args.endDate < args.startDate) return mcpError('结束日期不能早于开始日期');
        if (args.description && args.description.length > 2000) return mcpError('描述不能超过2000个字符');
        if (args.startTime && !isValidTime(args.startTime)) return mcpError('无效的开始时间格式 (HH:mm)');
        if (args.endTime && !isValidTime(args.endTime)) return mcpError('无效的结束时间格式 (HH:mm)');

        const events = loadEvents();
        const event = {
          id: randomUUID(),
          title: trimmedTitle,
          description: args.description || '',
          startDate: args.startDate,
          endDate: args.endDate || undefined,
          startTime: args.startTime || undefined,
          endTime: args.endTime || undefined,
          isAllDay: args.isAllDay || false,
          color: normalizeHexColor(args.color),
          tagId: args.tagId || undefined,
          reminder: args.reminder ? { enabled: true, minutesBefore: args.reminderMinutes ?? 10, playSound: args.reminderPlaySound || false } : undefined,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        events.push(event);
        saveEvents(events);
        return mcpText(JSON.stringify(event, null, 2));
      }
      case 'update_event': {
        if (!args.eventId) return mcpError('eventId 必填');
        const events = loadEvents();
        const idx = events.findIndex(e => e.id === args.eventId);
        if (idx === -1) return mcpError(`事件 ${args.eventId} 未找到`);
        const existing = events[idx];
        const updated = {
          ...existing,
          ...(args.title !== undefined ? { title: args.title.trim() } : {}),
          ...(args.startDate !== undefined ? { startDate: args.startDate } : {}),
          ...(args.endDate !== undefined ? { endDate: args.endDate || undefined } : {}),
          ...(args.startTime !== undefined ? { startTime: args.startTime || undefined } : {}),
          ...(args.endTime !== undefined ? { endTime: args.endTime || undefined } : {}),
          ...(args.isAllDay !== undefined ? { isAllDay: args.isAllDay } : {}),
          ...(args.color !== undefined ? { color: normalizeHexColor(args.color) } : {}),
          ...(args.tagId !== undefined ? { tagId: args.tagId || undefined } : {}),
          ...(args.description !== undefined ? { description: args.description } : {}),
          ...(args.reminder !== undefined
            ? { reminder: args.reminder ? { enabled: true, minutesBefore: args.reminderMinutes ?? 10, playSound: args.reminderPlaySound || false } : undefined }
            : {}),
          updatedAt: new Date().toISOString(),
        };
        events[idx] = updated;
        saveEvents(events);
        return mcpText(JSON.stringify(updated, null, 2));
      }
      case 'delete_event': {
        if (!args.eventId) return mcpError('eventId 必填');
        let events = loadEvents();
        const before = events.length;
        events = events.filter(e => e.id !== args.eventId && e.seriesId !== args.eventId);
        if (events.length === before) return mcpError(`事件 ${args.eventId} 未找到`);
        saveEvents(events);
        return mcpText(`事件 ${args.eventId} 已删除`);
      }

      // ── Note tools ──
      case 'list_notes': {
        let notes = loadAllNotes();
        if (args.noteType) notes = notes.filter(n => n.noteType === args.noteType);
        return mcpText(JSON.stringify(notes.map(n => ({
          id: n.id, title: n.title, noteType: n.noteType, color: n.color,
          itemCount: Array.isArray(n.items) ? n.items.length : 0,
          isDocked: n.isDocked || false, createdAt: n.createdAt, updatedAt: n.updatedAt,
        })), null, 2));
      }
      case 'get_note': {
        if (!args.noteId) return mcpError('noteId 必填');
        const note = loadNote(args.noteId);
        if (!note) return mcpError(`便签 ${args.noteId} 未找到`);
        return mcpText(JSON.stringify(note, null, 2));
      }
      case 'create_note': {
        const noteType = args.noteType || 'independent';
        const id = 'note_' + randomUUID();
        const ts = new Date().toISOString();
        const colors = ['#047857', '#0D9488', '#2563EB', '#4F46E5', '#8B5CF6', '#D946EF', '#BE185D', '#F43F5E', '#DC2626', '#F97316', '#F59E0B', '#22C55E', '#64748B'];
        const note = {
          id,
          title: args.title || (noteType === 'daily' ? '每日待办' : '新便签'),
          color: normalizeHexColor(args.color) || colors[Math.floor(Math.random() * colors.length)],
          transparency: 0.88,
          items: [],
          fontFamily: 'Microsoft YaHei',
          fontSize: 14,
          isPinned: false,
          isArchived: false,
          noteType,
          ...(noteType === 'echo' && args.echoTagId ? { echoTagId: args.echoTagId, viewTagIds: [args.echoTagId] } : {}),
          createdAt: ts,
          updatedAt: ts,
        };
        saveNote(id, note);
        return mcpText(JSON.stringify(note, null, 2));
      }
      case 'update_note': {
        if (!args.noteId) return mcpError('noteId 必填');
        const existing = loadNote(args.noteId);
        if (!existing) return mcpError(`便签 ${args.noteId} 未找到`);
        const updated = {
          ...existing,
          ...(args.title !== undefined ? { title: args.title } : {}),
          ...(args.color !== undefined ? { color: normalizeHexColor(args.color) } : {}),
          ...(args.isPinned !== undefined ? { isPinned: args.isPinned } : {}),
          ...(args.isArchived !== undefined ? { isArchived: args.isArchived } : {}),
          updatedAt: new Date().toISOString(),
        };
        saveNote(args.noteId, updated);
        return mcpText(JSON.stringify(updated, null, 2));
      }
      case 'delete_note': {
        if (!args.noteId) return mcpError('noteId 必填');
        deleteNoteFile(args.noteId);
        return mcpText(`便签 ${args.noteId} 已删除`);
      }

      // ── Todo tools ──
      case 'add_todo_item': {
        if (!args.noteId) return mcpError('noteId 必填');
        if (!args.content || !args.content.trim()) return mcpError('待办内容不能为空');
        const note = loadNote(args.noteId);
        if (!note) return mcpError(`便签 ${args.noteId} 未找到`);
        const items = Array.isArray(note.items) ? note.items : [];
        const item = {
          id: randomUUID(),
          noteId: args.noteId,
          content: args.content.trim(),
          isCompleted: false,
          sortOrder: items.length,
          ...(args.todoDate ? { todoDate: args.todoDate } : {}),
        };
        note.items = [...items, item];
        saveNote(args.noteId, note);
        return mcpText(JSON.stringify(item, null, 2));
      }
      case 'toggle_todo_item': {
        if (!args.noteId) return mcpError('noteId 必填');
        if (!args.itemId) return mcpError('itemId 必填');
        const note = loadNote(args.noteId);
        if (!note) return mcpError(`便签 ${args.noteId} 未找到`);
        const items = Array.isArray(note.items) ? note.items : [];
        const itemIdx = items.findIndex(i => i.id === args.itemId);
        if (itemIdx === -1) return mcpError(`待办项 ${args.itemId} 未找到`);
        const item = items[itemIdx];
        items[itemIdx] = {
          ...item,
          isCompleted: !item.isCompleted,
          completedAt: !item.isCompleted ? new Date().toISOString() : undefined,
        };
        note.items = items;
        saveNote(args.noteId, note);
        return mcpText(JSON.stringify(items[itemIdx], null, 2));
      }

      // ── Tag tools ──
      case 'list_tags': {
        const tags = loadTags();
        return mcpText(JSON.stringify(tags, null, 2));
      }

      // ── Daily overview ──
      case 'get_daily_overview': {
        const date = args.date || new Date().toISOString().slice(0, 10);
        const events = loadEvents().filter(e => e.startDate <= date && (!e.endDate || e.endDate >= date));
        const notes = loadAllNotes();
        const dailyNotes = notes.filter(n => n.noteType === 'daily');
        const dailyItems = dailyNotes.flatMap(n => {
          if (!Array.isArray(n.items)) return [];
          return n.items
            .filter(i => !i.todoDate || i.todoDate === date)
            .map(i => ({ ...i, noteTitle: n.title, noteId: n.id }));
        });
        const overdue = dailyItems.filter(i => !i.isCompleted);
        const completed = dailyItems.filter(i => i.isCompleted);
        return mcpText(JSON.stringify({ date, events, todo: { overdue, completed } }, null, 2));
      }

      default:
        return mcpError(`未知工具: ${name}`);
    }
  } catch (e) {
    return mcpError(`${name} 执行失败: ${e.message}`);
  }
});

// ── Startup ──

export async function startServer(dataDir) {
  if (dataDir) {
    DATA_DIR = dataDir;
  }
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('OKNote MCP Server running on stdio');
    console.error(`Data directory: ${DATA_DIR}`);
  } catch (e) {
    console.error('MCP Server failed to start:', e.message);
    process.exit(1);
  }
}

// Auto-start when run directly via `node mcp-server.mjs`
startServer();
