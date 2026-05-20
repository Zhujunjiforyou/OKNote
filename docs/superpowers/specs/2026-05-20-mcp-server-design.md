# OKNote MCP Server 设计文档

## 1. 概述

为 OKNote 备忘录应用添加本地 MCP (Model Context Protocol) 服务器，使本地 AI Agent（Claude Desktop、Claude Code）能够通过 MCP 工具操作备忘录数据：创建/查询/更新/删除事件、便签、待办项和标签。

## 2. 架构

```
Claude Desktop / Claude Code
        │ stdio (MCP protocol)
        ▼
electron/mcp-server.mjs
  (@modelcontextprotocol/sdk)
        │
        ├── 直接读写 data/ 下的 JSON 文件
        │   ├── data/events.json
        │   ├── data/note_{id}.json
        │   ├── data/tags.json
        │   └── data/countdowns.json
        │
        └── 写入完成后，Electron 主进程通过 fs.watch
            感知文件变更 → 广播 events-changed /
            notes-changed → 所有窗口重载数据
```

### 2.1 选择方案：方式 2

MCP 服务器作为独立进程，直接读写 JSON 文件，通过 `fs.watch` 通知 Electron 重载数据。不经过 Electron IPC 转发，MCP 服务器不依赖 Electron 运行状态。

### 2.2 变更通知机制

| 组件 | 职责 |
|------|------|
| `electron/mcp-server.mjs` | MCP 服务器，负责读写 JSON 文件 |
| `electron/main.cjs` | 新增 `fs.watch` 监听 `data/` 目录变更，防抖后广播给所有窗口 |
| React 窗口 | 通过 `events-changed` / `notes-changed` / `tags-changed` IPC 回调重载数据 |

Electron 不运行时，MCP 服务器正常工作。Electron 下次启动时，自动从最新 JSON 文件加载数据。

## 3. 文件结构变更

```
electron/
├── main.cjs           # 新增 fs.watch 监听 data/ 目录
├── preload.cjs        # 不变
├── mcp-server.mjs     # 新增：MCP 服务器
└── userdata.js        # 新增：resolveUserDataDir() 共享逻辑
```

## 4. 数据目录解析

`electron/userdata.js` 从 `main.cjs` 提取 `resolveUserDataDir()` 逻辑，供 main.cjs 和 mcp-server.mjs 共享使用。

优先级：
1. `OKNOTE_DATA_DIR` 环境变量
2. 打包安装后 `user-data/` 同级目录
3. Electron 默认 `userData`

## 5. MCP Tools 定义

### 5.1 第一层（核心，先实现）

#### Event Tools

| 工具 | 描述 | 关键参数 |
|------|------|----------|
| `list_events` | 按日期范围/标签查询事件 | startDate?, endDate?, tagId?, query? |
| `get_event` | 获取单个事件完整详情 | eventId |
| `create_event` | 新建事件 | title, startDate, startTime?, endDate?, endTime?, isAllDay?, color?, tagId?, description?, recurrence?, reminder? |
| `update_event` | 更新事件 | eventId, title?, startDate?, ... |
| `delete_event` | 删除事件 | eventId |

#### Note Tools

| 工具 | 描述 | 关键参数 |
|------|------|----------|
| `list_notes` | 列出所有便签 | noteType? |
| `get_note` | 获取便签详情（含待办列表） | noteId |
| `create_note` | 新建便签 | noteType (independent/daily/echo), title?, color?, echoTagId? |
| `update_note` | 更新便签属性 | noteId, title?, color?, ... |
| `delete_note` | 删除便签 | noteId |

#### Todo Tools

| 工具 | 描述 | 关键参数 |
|------|------|----------|
| `add_todo_item` | 向便签添加待办项 | noteId, content, todoDate? |
| `toggle_todo_item` | 切换待办完成状态 | noteId, itemId |

#### Tag & Query Tools

| 工具 | 描述 | 关键参数 |
|------|------|----------|
| `list_tags` | 列出所有标签 | — |
| `get_daily_overview` | 获取某天的所有事件及未完成待办 | date |

### 5.2 第二层（后续迭代）

| 工具 | 描述 | 关键参数 |
|------|------|----------|
| `search` | 全文搜索事件标题和便签内容 | query |
| `update_todo_item` | 修改待办内容 | noteId, itemId, content |
| `delete_todo_item` | 删除待办项 | noteId, itemId |
| `create_tag` | 创建标签 | name, color |
| `delete_tag` | 删除标签 | tagId |

## 6. 参数校验规则

MCP 工具的参数校验需与 UI 侧（`EventForm.tsx`）一致：

- 事件标题：必填，最长 200 字符
- 开始日期：必填
- 结束日期：可选，但不能早于开始日期
- 循环结束日期：可选，但不能早于开始日期
- 描述：最长 2000 字符
- 便签标题：无强制要求（UI 使用"新便签"作为默认）
- 便签类型：枚举 `independent` / `daily` / `echo`

## 7. 用户配置方式

### Claude Desktop (claude_desktop_config.json)
```json
{
  "mcpServers": {
    "oknote": {
      "command": "node",
      "args": ["D:/path/to/OKNote/electron/mcp-server.mjs"]
    }
  }
}
```

### Claude Code (.claude/settings.json)
```json
{
  "mcpServers": {
    "oknote": {
      "command": "node",
      "args": ["D:/path/to/OKNote/electron/mcp-server.mjs"]
    }
  }
}
```

## 8. 边界情况

| 场景 | 处理方式 |
|------|----------|
| Electron 运行中 + MCP 同时写入 | fs.watch 防抖触发重载，保障最终一致性 |
| MCP 运行时 Electron 未启动 | 完全正常，文件独立读写 |
| 写冲突（并发写入同一文件） | 不涉及并发事务，最后写入者胜出 |
| 参数验证失败 | 返回清晰的错误信息，不写入非法数据 |

## 9. 变更通知防抖

```cjs
// main.cjs
let watchTimeout = null;
fs.watch(DATA_DIR, (eventType, filename) => {
  if (!filename) return;
  if (watchTimeout) clearTimeout(watchTimeout);
  watchTimeout = setTimeout(() => {
    if (filename === 'events.json') broadcastEventsChanged({ action: 'events-changed' });
    else if (filename.startsWith('note_')) notifyNotesChanged();
    else if (filename === 'tags.json') broadcastTagsChanged();
  }, 200);
});
```

## 10. 技术栈

| 层级 | 技术 |
|------|------|
| MCP 框架 | @modelcontextprotocol/sdk (Node.js) |
| 传输层 | StdioServerTransport |
| 语言 | JavaScript (ESM, .mjs) |
| 数据存取 | fs 直接读写 JSON |
| 文件监听 | fs.watch |
